"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { parseUnits } from "viem";

import { ARC_CHAIN, OTHER_EVM_CHAINS, type EvmChainConfig } from "@/lib/chains";
import {
  ERC20_ABI,
  ROUTER_ABI,
  HOOK_DATA,
  addressToBytes32,
  buildHookDataWithMemo,
  validateRecipient,
  validateAmount,
  validateMemo,
} from "@/lib/cctp";

const TOKEN_MESSENGER_V2_FEE_ABI = [
  {
    type: "function",
    name: "getMinFeeAmount",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const TOKEN_MESSENGER_V2_ABI = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

const DEFAULT_FEE_RECEIVER = "0xA87Bd559fd6F2646225AcE941bA6648Ec1BAA9AF" as const;

const FEE_RECEIVER = (process.env.NEXT_PUBLIC_FEE_COLLECTOR ||
  DEFAULT_FEE_RECEIVER) as `0x${string}`;
const FEE_USDC = process.env.NEXT_PUBLIC_FEE_USDC || "0.01";

type Direction = "ARC_TO_OTHER" | "OTHER_TO_ARC";

type BridgeHistoryItem = {
  ts: number;
  from: `0x${string}`;
  to: `0x${string}`;
  txHash: `0x${string}`;
  memo?: string;
};

function UsdcIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="48"
      height="48"
      fill="none"
      viewBox="0 0 120 120"
      className={className}
      aria-label="USDC"
      role="img"
      focusable="false"
    >
      <path
        fill="#0B53BF"
        d="M60 120c33.137 0 60-26.863 60-60S93.137 0 60 0 0 26.863 0 60s26.863 60 60 60"
      ></path>
      <path
        fill="#fff"
        d="M70.8 16.313v7.725C86.211 28.688 97.498 43.013 97.498 60s-11.287 31.313-26.7 35.963v7.725C90.45 98.888 105 81.15 105 60s-14.55-38.887-34.2-43.687M22.499 60c0-16.987 11.287-31.312 26.7-35.962v-7.725c-19.65 4.8-34.2 22.537-34.2 43.687s14.55 38.888 34.2 43.688v-7.725C33.786 91.35 22.499 76.988 22.499 60"
      ></path>
      <path
        fill="#fff"
        d="M76.124 68.363c0-15.338-24.037-9.038-24.037-17.513 0-3.037 2.437-4.987 7.087-4.987 5.55 0 7.463 2.7 8.063 6.337h7.65c-.683-6.826-4.6-11.137-11.138-12.42v-6.03h-7.5v5.814c-7.161.912-11.662 5.083-11.662 11.286 0 15.413 24.075 9.638 24.075 17.963 0 3.15-3.038 5.25-8.176 5.25-6.712 0-8.924-2.963-9.75-7.05h-7.462c.483 7.477 5.094 12.157 12.975 13.324v5.913h7.5v-5.834c7.692-.994 12.375-5.468 12.375-12.053"
      ></path>
    </svg>
  );
}

function getDestLabel(c: EvmChainConfig) {
  return c.name;
}

export default function BridgeTab() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const enabledOtherChains = OTHER_EVM_CHAINS;
  const enabledOtherChainKeys = enabledOtherChains.map((c) => c.key).join(", ");

  const [direction, setDirection] = useState<Direction>("ARC_TO_OTHER");

  const [sourceKey, setSourceKey] = useState<EvmChainConfig["key"]>(
    enabledOtherChains[0]?.key || "ETH_SEPOLIA"
  );
  const [sourceOpen, setSourceOpen] = useState(false);

  const [destKey, setDestKey] = useState<EvmChainConfig["key"]>(
    enabledOtherChains[0]?.key || "ETH_SEPOLIA"
  );
  const [destOpen, setDestOpen] = useState(false);

  const [amountUsdc, setAmountUsdc] = useState("");
  const [recipient, setRecipient] = useState<string>("");
  const [memo, setMemo] = useState<string>("");

  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string>("");
  const [feeTxHash, setFeeTxHash] = useState<string>("");

  const [history, setHistory] = useState<BridgeHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(0);

  const otherChainsByKey = useMemo(() => {
    const m = new Map<string, EvmChainConfig>();
    for (const c of enabledOtherChains) m.set(c.key, c);
    return m;
  }, [enabledOtherChains]);

  const source = useMemo<EvmChainConfig>(() => {
    if (direction === "ARC_TO_OTHER") return ARC_CHAIN;
    return otherChainsByKey.get(String(sourceKey)) || ARC_CHAIN;
  }, [direction, otherChainsByKey, sourceKey]);

  const dest = useMemo<EvmChainConfig>(() => {
    if (direction === "OTHER_TO_ARC") return ARC_CHAIN;
    return otherChainsByKey.get(String(destKey)) || ARC_CHAIN;
  }, [direction, otherChainsByKey, destKey]);

  const hasOtherChains = enabledOtherChains.length > 0;

  const isWrongNetwork = isConnected && chain?.id !== source.chainId;

  useEffect(() => {
    // direction flips also affect what options are valid
    if (direction === "ARC_TO_OTHER") {
      if (enabledOtherChains.length > 0) setDestKey(enabledOtherChains[0].key);
    } else {
      if (enabledOtherChains.length > 0) setSourceKey(enabledOtherChains[0].key);
      setDestKey("ARC_TESTNET");
    }
    setDestOpen(false);
    setSourceOpen(false);
  }, [direction, enabledOtherChains]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bridge_history");
      if (saved) setHistory(JSON.parse(saved));
    } catch (error) {
      console.error("Failed to load bridge history:", error);
    }
  }, []);

  // Save history
  useEffect(() => {
    try {
      if (history.length > 0) localStorage.setItem("bridge_history", JSON.stringify(history));
    } catch (error) {
      console.error("Failed to save bridge history:", error);
    }
  }, [history]);

  async function switchToChain(target: EvmChainConfig) {
    if (!window.ethereum) throw new Error("No injected wallet found (window.ethereum).");
    const chainIdHex = `0x${target.chainId.toString(16)}`;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (switchError: any) {
      if (switchError?.code !== 4902) throw switchError;
      if (!target.rpcUrl) throw new Error(`Missing RPC URL for ${target.name}.`);

      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: target.name,
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: [target.rpcUrl],
            blockExplorerUrls: target.explorerUrl ? [target.explorerUrl] : undefined,
          },
        ],
      });
    }
  }

  function computeMaxFee(amountUsdcStr: string, destinationDomain: number) {
    const amount = parseUnits(amountUsdcStr, 6);

    // Existing heuristic (kept)
    const minForwardFeeUsdc = destinationDomain === 0 ? "1.25" : "0.2";
    const minForwardFee = parseUnits(minForwardFeeUsdc, 6);

    const maxFeeBps = BigInt(process.env.NEXT_PUBLIC_MAX_FEE_BPS || "500");
    const maxFeeFromPct = (amount * maxFeeBps) / 10000n;

    let maxFeeToUse = maxFeeFromPct < minForwardFee ? minForwardFee : maxFeeFromPct;

    const maxFeeUsdcCapStr = process.env.NEXT_PUBLIC_MAX_FEE_USDC_CAP || "0";
    const maxFeeUsdcCap = parseUnits(maxFeeUsdcCapStr, 6);
    if (maxFeeUsdcCap > 0n && maxFeeToUse > maxFeeUsdcCap) maxFeeToUse = maxFeeUsdcCap;

    // Must be strictly less than amount
    const maxFeeCap = amount - 1n;
    if (maxFeeToUse > maxFeeCap) {
      throw new Error(
        `Amount is too small for maxFee constraints. Amount: ${Number(amount) / 1e6} USDC`
      );
    }

    return { amount, maxFee: maxFeeToUse };
  }

  async function onBridge() {
    try {
      setStatus("");
      setTxHash("");
      setFeeTxHash("");
      setLoading(true);

      if (!isConnected || !address || !walletClient || !publicClient) {
        throw new Error("Please connect your wallet first");
      }

      if (isWrongNetwork) {
        throw new Error(`Please switch to ${source.name} (Chain ID: ${source.chainId})`);
      }

      setStatus("Validating inputs...");
      validateAmount(amountUsdc);
      if (memo) validateMemo(memo);

      let recipientAddr: `0x${string}`;
      recipientAddr = recipient.trim() ? validateRecipient(recipient.trim()) : address;

      const minFinality = Number(process.env.NEXT_PUBLIC_MIN_FINALITY_THRESHOLD || "1000");
      const finalHookData = buildHookDataWithMemo(HOOK_DATA, memo);

      // Resolve CCTP addresses for the current *source chain*
      let usdc: `0x${string}`;
      let tokenMessengerV2Addr: `0x${string}`;
      let destinationCallerBytes32: `0x${string}`;

      // Service fee (ARC only, current design)
      let feeCollector = FEE_RECEIVER;
      let feeAmount = parseUnits(FEE_USDC, 6);

      if (direction === "ARC_TO_OTHER") {
        const router = (process.env.NEXT_PUBLIC_ARC_ROUTER ||
          "0xEc02A909701A8eB9C84B93b55B6d4A7ca215CFca") as `0x${string}`;

        setStatus("Reading Router config...");
        const [routerUsdc, routerFeeCollector, routerServiceFee, routerDestCaller, routerTokenMessengerV2] =
          await Promise.all([
            publicClient.readContract({
              address: router,
              abi: ROUTER_ABI,
              functionName: "usdc",
            }) as Promise<`0x${string}`>,
            publicClient.readContract({
              address: router,
              abi: ROUTER_ABI,
              functionName: "feeCollector",
            }) as Promise<`0x${string}`>,
            publicClient.readContract({
              address: router,
              abi: ROUTER_ABI,
              functionName: "serviceFee",
            }) as Promise<bigint>,
            publicClient.readContract({
              address: router,
              abi: ROUTER_ABI,
              functionName: "destinationCaller",
            }) as Promise<`0x${string}`>,
            publicClient.readContract({
              address: router,
              abi: ROUTER_ABI,
              functionName: "tokenMessengerV2",
            }) as Promise<`0x${string}`>,
          ]);

        usdc = routerUsdc;
        tokenMessengerV2Addr = routerTokenMessengerV2;
        destinationCallerBytes32 = routerDestCaller;
        feeCollector = routerFeeCollector;
        feeAmount = routerServiceFee;
      } else {
        if (!source.usdc) throw new Error(`Missing ${source.key} USDC env var.`);
        if (!source.tokenMessengerV2)
          throw new Error(`Missing ${source.key} TOKEN_MESSENGER_V2 env var.`);

        usdc = source.usdc;
        tokenMessengerV2Addr = source.tokenMessengerV2;
        destinationCallerBytes32 = addressToBytes32(
          "0x0000000000000000000000000000000000000000"
        );
        feeAmount = 0n;
      }

      let amount: bigint, maxFee: bigint;
      ({ amount, maxFee } = computeMaxFee(amountUsdc, dest.domain));

      setStatus("Reading minFee from TokenMessengerV2...");
      try {
        const minProtocolFee = (await publicClient.readContract({
          address: tokenMessengerV2Addr,
          abi: TOKEN_MESSENGER_V2_FEE_ABI,
          functionName: "getMinFeeAmount",
          args: [amount],
        })) as bigint;

        if (minProtocolFee > maxFee) {
          const bufferedMinFee = (minProtocolFee * 110n) / 100n;
          const maxFeeCap = amount - 1n;
          maxFee = bufferedMinFee > maxFeeCap ? maxFeeCap : bufferedMinFee;
        }
      } catch (err) {
        console.warn("Failed to read getMinFeeAmount:", err);
      }

      if (maxFee >= amount) {
        throw new Error(
          `Invalid fee: maxFee (${Number(maxFee) / 1e6}) must be less than amount (${Number(amount) / 1e6}).`
        );
      }

      setStatus("Checking USDC balance...");
      const bal = (await publicClient.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;

      const totalNeed = amount + feeAmount;
      if (bal < totalNeed) {
        throw new Error(
          `Insufficient USDC balance.\nRequired: ${(Number(totalNeed) / 1e6).toFixed(6)} USDC\nAvailable: ${(Number(bal) / 1e6).toFixed(6)} USDC`
        );
      }

      setStatus("Checking TokenMessengerV2 allowance...");
      const tmAllowance = (await publicClient.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, tokenMessengerV2Addr],
      })) as bigint;

      if (tmAllowance < amount) {
        setStatus("Please approve USDC for TokenMessengerV2...");
        const approveTx = await walletClient.writeContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [tokenMessengerV2Addr, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      if (feeAmount > 0n) {
        setStatus("Sending service fee transfer...");
        const feeTx = await walletClient.writeContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [feeCollector, feeAmount],
        });
        setFeeTxHash(feeTx);
        await publicClient.waitForTransactionReceipt({ hash: feeTx });
      }

      setStatus("Sending burn+message transaction...");
      const burnTx = await walletClient.writeContract({
        address: tokenMessengerV2Addr,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurnWithHook",
        args: [
          amount,
          dest.domain,
          addressToBytes32(recipientAddr),
          usdc,
          destinationCallerBytes32,
          maxFee,
          minFinality,
          finalHookData,
        ],
      });

      setTxHash(burnTx);
      setStatus("Waiting for burn+message confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: burnTx });

      if (receipt.status !== "success") throw new Error("burn+message transaction reverted");

      setHistory((prev) => [
        { ts: Date.now(), from: address, to: recipientAddr, txHash: burnTx, memo: memo || undefined },
        ...prev,
      ]);

      setStatus(
        `Success!\n\nAmount: ${Number(amount) / 1e6} USDC\nFrom: ${source.name}\nTo: ${dest.name}\nRecipient: ${recipientAddr}\n\nWaiting for forwarding...`
      );
    } catch (err: any) {
      console.error("Bridge error:", err);
      setStatus(`Error: ${err?.message || err?.shortMessage || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  const bridgeButtonDisabled =
    loading ||
    !isConnected ||
    isWrongNetwork ||
    !amountUsdc ||
    parseFloat(amountUsdc) < 5 ||
    (direction === "OTHER_TO_ARC" && enabledOtherChains.length === 0);

  return (
    <div className="w-full py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-stretch">
        {/* Left */}
        <div className="h-full rounded-2xl bg-white shadow-xl p-6 min-h-[70vh]">
          <div className="space-y-5">
            {/* Direction */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Bridge direction
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setDirection("ARC_TO_OTHER")}
                  className={[
                    "flex-1 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm",
                    direction === "ARC_TO_OTHER"
                      ? "border-transparent bg-gradient-to-r from-[#ff7582] to-[#725a7a] text-white"
                      : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
                  ].join(" ")}
                >
                  ARC → Other
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setDirection("OTHER_TO_ARC")}
                  className={[
                    "flex-1 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm",
                    direction === "OTHER_TO_ARC"
                      ? "border-transparent bg-gradient-to-r from-[#ff7582] to-[#725a7a] text-white"
                      : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
                    enabledOtherChains.length === 0 ? "opacity-50" : "",
                  ].join(" ")}
                >
                  Other → ARC
                </button>
              </div>
              {enabledOtherChains.length === 0 && (
                <div className="mt-1 text-xs text-gray-500">
                  Other → ARC will be enabled once at least one source chain is configured via Vercel Env Vars.
                </div>
              )}
              {enabledOtherChains.length > 0 && (
                <div className="mt-1 text-[11px] text-gray-400">
                  Enabled destination chains: {enabledOtherChainKeys}
                </div>
              )}
              {enabledOtherChains.length > 0 && (
                <div className="mt-1 text-[11px] text-gray-400">
                  Enabled destination chains: {enabledOtherChainKeys}
                </div>
              )}
            </div>

            {/* Source Chain (OTHER -> ARC) */}
            {direction === "OTHER_TO_ARC" && (
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Source chain
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSourceOpen((v) => !v)}
                    disabled={loading}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                  >
                    <div className="flex items-center gap-3">
                      {source.iconPath && (
                        <img
                          src={source.iconPath}
                          alt={source.name}
                          className="h-6 w-6 rounded-md"
                        />
                      )}
                      <span className="font-medium">{source.name}</span>
                    </div>
                    <span className="text-gray-400">▾</span>
                  </button>

                  {sourceOpen && hasOtherChains && (
                    <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                      <div className="max-h-72 overflow-auto py-1">
                        {enabledOtherChains.map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => {
                              setSourceKey(c.key);
                              setSourceOpen(false);
                            }}
                            className={[
                              "flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50",
                              c.key === sourceKey ? "bg-gray-50" : "",
                            ].join(" ")}
                          >
                            {c.iconPath && (
                              <img
                                src={c.iconPath}
                                alt={c.name}
                                className="h-6 w-6 rounded-md"
                              />
                            )}
                            <span className="font-medium text-gray-900">
                              {getDestLabel(c)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {!hasOtherChains && (
                  <div className="mt-1 text-xs text-gray-500">
                    No source chains enabled. Double-check your Vercel Env Vars names (e.g.{" "}
                    <code className="rounded bg-white/70 px-1">
                      NEXT_PUBLIC_BASE_SEPOLIA_CHAIN_ID
                    </code>
                    ).
                  </div>
                )}

                <button
                  type="button"
                  disabled={loading || !isConnected}
                  onClick={() => switchToChain(source)}
                  className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                >
                  Switch wallet to {source.name}
                </button>
              </div>
            )}

            {/* Destination Chain */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Destination chain
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDestOpen((v) => !v)}
                  disabled={loading || direction === "OTHER_TO_ARC" || !hasOtherChains}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                >
                  <div className="flex items-center gap-3">
                    {dest.iconPath && (
                      <img
                        src={dest.iconPath}
                        alt={dest.name}
                        className="h-6 w-6 rounded-md"
                      />
                    )}
                    <span className="font-medium">{dest.name}</span>
                  </div>
                  <span className="text-gray-400">▾</span>
                </button>

                {destOpen && direction === "ARC_TO_OTHER" && hasOtherChains && (
                  <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                    <div className="max-h-72 overflow-auto py-1">
                      {enabledOtherChains.map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => {
                            setDestKey(d.key);
                            setDestOpen(false);
                          }}
                          className={[
                            "flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-gray-50",
                            d.key === destKey ? "bg-gray-50" : "",
                          ].join(" ")}
                        >
                          {d.iconPath && (
                            <img
                              src={d.iconPath}
                              alt={d.name}
                              className="h-6 w-6 rounded-md"
                            />
                          )}
                          <span className="font-medium text-gray-900">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {direction === "ARC_TO_OTHER" && !hasOtherChains && (
                <div className="mt-1 text-xs text-gray-500">
                  No destination chains enabled. Uncomment at least one chain config in{" "}
                  <code className="rounded bg-white/70 px-1">.env.local</code>.
                </div>
              )}
            </div>

            {/* Recipient */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Recipient address
              </label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={address || "0x..."}
                disabled={loading}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
            </div>

            {/* Memo */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Message
              </label>
              <input
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Leave a message"
                disabled={loading}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
            </div>

            {/* Amount */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Amount</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="5"
                  value={amountUsdc}
                  onChange={(e) => setAmountUsdc(e.target.value)}
                  placeholder="Minimum 5 USDC"
                  disabled={loading}
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pr-16 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <UsdcIcon className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-1 text-xs text-gray-500">Suggested minimum: 5 USDC</div>
            </div>

            {/* Info Box */}
            <div className="rounded-xl bg-gradient-to-r from-[#fff0f2] to-[#f3eef6] p-5">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Bridge amount</span>
                  <span className="flex items-center gap-2 font-semibold text-gray-900">
                    {amountUsdc || "0"}
                    <UsdcIcon className="h-4 w-4" />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Service fee</span>
                  <span className="flex items-center gap-2 font-semibold text-gray-900">
                    {direction === "ARC_TO_OTHER" ? FEE_USDC : "0"}
                    <UsdcIcon className="h-4 w-4" />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">From</span>
                  <span className="font-semibold text-gray-900">{source.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">To</span>
                  <span className="font-semibold text-gray-900">{dest.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Estimated time</span>
                  <span className="font-semibold text-gray-900">~5s - 2min</span>
                </div>
              </div>
              {direction === "ARC_TO_OTHER" && !hasOtherChains && (
                <div className="mt-1 text-xs text-gray-500">
                  No destination chains enabled. Uncomment at least one chain config in{" "}
                  <code className="rounded bg-white/70 px-1">.env.local</code>.
                </div>
              )}
            </div>

            {/* Bridge Button */}
            <button
              onClick={onBridge}
              disabled={bridgeButtonDisabled}
              className={[
                "w-full rounded-xl px-6 py-4 font-semibold text-white shadow-lg transition-all",
                bridgeButtonDisabled
                  ? "cursor-not-allowed bg-gray-300"
                  : "bg-gradient-to-r from-[#ff7582] to-[#725a7a] hover:from-[#ff5f70] hover:to-[#664f6e] active:scale-[0.98]",
              ].join(" ")}
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Processing...</span>
                </div>
              ) : isWrongNetwork ? (
                "Wrong network"
              ) : !isConnected ? (
                "Connect wallet"
              ) : direction === "ARC_TO_OTHER" ? (
                "Send USDC"
              ) : (
                "Bridge to ARC"
              )}
            </button>

            {/* Status Messages */}
            {status && (
              <div
                className={[
                  "rounded-xl border p-4 text-sm",
                  status.toLowerCase().includes("success")
                    ? "border-green-200 bg-green-50 text-green-800"
                    : status.toLowerCase().includes("error")
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-blue-200 bg-blue-50 text-blue-800",
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  {loading && (
                    <div className="mt-0.5 h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  )}
                  <div className="flex-1 whitespace-pre-line">
                    {status}
                    {txHash && (
                      <a
                        href={`${source.explorerUrl || "https://testnet.arcscan.app"}/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900 underline"
                      >
                        View transaction →
                      </a>
                    )}
                    {feeTxHash && (
                      <div className="mt-2 text-xs text-gray-700">
                        Fee TX:{" "}
                        <a
                          href={`${source.explorerUrl || "https://testnet.arcscan.app"}/tx/${feeTxHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold underline"
                        >
                          view
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right */}
        <div className="h-full rounded-2xl bg-white shadow-xl p-6 min-h-[70vh]">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">Bridge history</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                disabled={historyPage === 0}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setHistoryPage((p) => p + 1)}
                disabled={(historyPage + 1) * 10 >= history.length}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>

          {history.length === 0 ? (
            <div className="text-sm text-gray-500">No transactions yet.</div>
          ) : (
            <div className="space-y-2">
              {history.slice(historyPage * 10, historyPage * 10 + 10).map((h) => (
                <div key={`${h.txHash}-${h.ts}`} className="rounded-lg bg-gray-50 p-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-gray-600">{new Date(h.ts).toLocaleString()}</div>
                    <a
                      href={`${source.explorerUrl || "https://testnet.arcscan.app"}/tx/${h.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-[#725a7a] underline"
                    >
                      TX
                    </a>
                  </div>
                  <div className="mt-1 text-sm text-gray-900">
                    <span className="font-semibold">
                      {h.from.slice(0, 6)}…{h.from.slice(-4)}
                    </span>
                    <span className="mx-2 text-gray-400">→</span>
                    <span className="font-semibold">
                      {h.to.slice(0, 6)}…{h.to.slice(-4)}
                    </span>
                  </div>
                  {h.memo && <div className="mt-1 text-xs text-gray-600">Message: {h.memo}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
