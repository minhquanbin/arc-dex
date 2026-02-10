"use client";

import { useMemo, useState, useEffect } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { DESTS } from "@/lib/chains";
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
import { parseUnits } from "viem";

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

const FEE_RECEIVER = (process.env.NEXT_PUBLIC_FEE_COLLECTOR ||
  "0xA87Bd559fd6F2646225AcE941bA6648Ec1BAA9AF") as `0x${string}`;
const FEE_USDC = process.env.NEXT_PUBLIC_FEE_USDC || "0.01";

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

export default function BridgeTab() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [destKey, setDestKey] = useState(DESTS[0].key);
  const [destOpen, setDestOpen] = useState(false);
  const [amountUsdc, setAmountUsdc] = useState("");
  const [recipient, setRecipient] = useState<string>("");
  const [memo, setMemo] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string>("");

  const [history, setHistory] = useState<BridgeHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(0);

  // Load history từ localStorage khi component mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("bridge_history");
      if (saved) {
        const parsed = JSON.parse(saved);
        setHistory(parsed);
      }
    } catch (error) {
      console.error("Failed to load bridge history:", error);
    }
  }, []);

  // Save history vào localStorage mỗi khi history thay đổi
  useEffect(() => {
    try {
      if (history.length > 0) {
        localStorage.setItem("bridge_history", JSON.stringify(history));
      }
    } catch (error) {
      console.error("Failed to save bridge history:", error);
    }
  }, [history]);

  const dest = useMemo(() => DESTS.find((d) => d.key === destKey) || DESTS[0], [destKey]);

  const expectedChainId = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 5042002);
  const isWrongNetwork = isConnected && chain?.id !== expectedChainId;

  // Compute maxFee
  function computeMaxFee(amountUsdc: string, destinationDomain: number) {
    const amount = parseUnits(amountUsdc, 6);
    const minForwardFeeUsdc = destinationDomain === 0 ? "1.25" : "0.2";
    const minForwardFee = parseUnits(minForwardFeeUsdc, 6);
    const maxFeeBps = BigInt(process.env.NEXT_PUBLIC_MAX_FEE_BPS || "500");
    const maxFeeFromPct = (amount * maxFeeBps) / 10000n;
    let maxFeeToUse = maxFeeFromPct < minForwardFee ? minForwardFee : maxFeeFromPct;
    const maxFeeUsdcCapStr = process.env.NEXT_PUBLIC_MAX_FEE_USDC_CAP || "0";
    const maxFeeUsdcCap = parseUnits(maxFeeUsdcCapStr, 6);

    if (maxFeeUsdcCap > 0n && maxFeeToUse > maxFeeUsdcCap) {
      maxFeeToUse = maxFeeUsdcCap;
    }

    const maxFeeCap = amount - 1n;
    if (maxFeeToUse > maxFeeCap) {
      throw new Error(
        `Amount is too small for maxFee constraints. ` +
          `Amount: ${Number(amount) / 1e6} USDC, ` +
          `computed maxFee: ${Number(maxFeeToUse) / 1e6} USDC, ` +
          `minFee: ${Number(minForwardFee) / 1e6} USDC (domain ${destinationDomain})`
      );
    }

    return { amount, maxFee: maxFeeToUse };
  }

  async function onBridge() {
    try {
      setStatus("");
      setTxHash("");
      setLoading(true);

      if (!isConnected || !address || !walletClient || !publicClient) {
        throw new Error("Please connect your wallet first");
      }

      if (isWrongNetwork) {
        throw new Error(`Please switch to ARC Testnet (Chain ID: ${expectedChainId})`);
      }

      const router = (process.env.NEXT_PUBLIC_ARC_ROUTER ||
        "0xEc02A909701A8eB9C84B93b55B6d4A7ca215CFca") as `0x${string}`;
      let arcUsdc = ((process.env.NEXT_PUBLIC_ARC_USDC ||
        process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS) ||
        "0x3600000000000000000000000000000000000000") as `0x${string}`;
      const minFinality = Number(process.env.NEXT_PUBLIC_MIN_FINALITY_THRESHOLD || "1000");

      let feeCollector = FEE_RECEIVER;
      let feeAmount = parseUnits(FEE_USDC, 6);
      let tokenMessengerV2Addr: `0x${string}` | "" = "";
      let destinationCallerBytes32: `0x${string}` | "" = "";

      setStatus("Reading Router config...");
      try {
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

        arcUsdc = routerUsdc;
        feeCollector = routerFeeCollector;
        feeAmount = routerServiceFee;
        tokenMessengerV2Addr = routerTokenMessengerV2;
        destinationCallerBytes32 = routerDestCaller;

        setStatus(
          "Router config:\n" +
            `USDC: ${routerUsdc}\n` +
            `TokenMessengerV2: ${routerTokenMessengerV2}\n` +
            `FeeCollector: ${routerFeeCollector}\n` +
            `ServiceFee: ${Number(routerServiceFee) / 1e6} USDC`
        );
      } catch (readCfgErr: any) {
        console.error("Failed to read Router config:", readCfgErr);
        throw new Error(
          `Failed to read Router on-chain config. ` +
            `Details: ${readCfgErr?.shortMessage || readCfgErr?.message || "Unknown error"}`
        );
      }

      setStatus("Validating inputs...");
      validateAmount(amountUsdc);
      if (memo) validateMemo(memo);

      let amount: bigint, maxFee: bigint;
      try {
        ({ amount, maxFee } = computeMaxFee(amountUsdc, dest.domain));
      } catch (feeErr: any) {
        throw new Error(`Fee calculation error: ${feeErr.message}`);
      }

      setStatus("Reading minFee from TokenMessengerV2...");
      let minProtocolFee = 0n;
      try {
        const tokenMessenger = tokenMessengerV2Addr;
        minProtocolFee = (await publicClient.readContract({
          address: tokenMessenger,
          abi: TOKEN_MESSENGER_V2_FEE_ABI,
          functionName: "getMinFeeAmount",
          args: [amount],
        })) as bigint;

        if (minProtocolFee > maxFee) {
          const bufferedMinFee = (minProtocolFee * 110n) / 100n;
          const maxFeeCap = amount - 1n;
          maxFee = bufferedMinFee > maxFeeCap ? maxFeeCap : bufferedMinFee;
        }
      } catch (minFeeErr: any) {
        console.warn("Failed to read getMinFeeAmount:", minFeeErr);
      }

      if (maxFee >= amount) {
        throw new Error(
          `Invalid fee: maxFee (${Number(maxFee) / 1e6}) must be less than amount (${Number(amount) / 1e6}). ` +
            `Please increase the amount.`
        );
      }

      setStatus("Checking USDC balance...");
      const bal = await publicClient.readContract({
        address: arcUsdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });

      const totalNeed = amount + feeAmount;
      if (bal < totalNeed) {
        throw new Error(
          `Insufficient USDC balance.\n` +
            `Required: ${(Number(totalNeed) / 1e6).toFixed(6)} USDC\n` +
            `Available: ${(Number(bal) / 1e6).toFixed(6)} USDC`
        );
      }

      let recipientAddr: `0x${string}`;
      try {
        recipientAddr = recipient.trim() ? validateRecipient(recipient.trim()) : address;
      } catch (err: any) {
        throw new Error(`Invalid recipient: ${err.message}`);
      }

      const finalHookData = buildHookDataWithMemo(HOOK_DATA, memo);

      if (!tokenMessengerV2Addr || !destinationCallerBytes32) {
        throw new Error("Failed to read tokenMessengerV2/destinationCaller from Router.");
      }

      setStatus("Checking TokenMessengerV2 allowance...");
      const tmAllowance = (await publicClient.readContract({
        address: arcUsdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, tokenMessengerV2Addr],
      })) as bigint;

      if (tmAllowance < amount) {
        setStatus("Please approve USDC for TokenMessengerV2...");
        const approveTx = await walletClient.writeContract({
          address: arcUsdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [tokenMessengerV2Addr, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      setStatus("Sending service fee transfer...");
      const feeTx = await walletClient.writeContract({
        address: arcUsdc,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [feeCollector, feeAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: feeTx });

      setStatus("Sending burn+message transaction...");
      const burnTx = await walletClient.writeContract({
        address: tokenMessengerV2Addr,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurnWithHook",
        args: [
          amount,
          dest.domain,
          addressToBytes32(recipientAddr),
          arcUsdc,
          destinationCallerBytes32,
          maxFee,
          minFinality,
          finalHookData,
        ],
      });

      setTxHash(burnTx);
      setStatus("Waiting for burn+message confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: burnTx });

      if (receipt.status === "success") {
        setHistory((prev) => [
          {
            ts: Date.now(),
            from: address,
            to: recipientAddr,
            txHash: burnTx,
            memo: memo || undefined,
          },
          ...prev,
        ]);

        setStatus(
          `Success!\n\n` +
            `Amount: ${Number(amount) / 1e6} USDC\n` +
            `From: ARC Testnet\n` +
            `To: ${dest.name}\n` +
            `Recipient: ${recipientAddr}\n\n` +
            `Waiting for forwarding...`
        );
      } else {
        throw new Error("burn+message transaction reverted");
      }
    } catch (err: any) {
      console.error("Bridge error:", err);
      setStatus(`Error: ${err?.message || err?.shortMessage || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full py-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 items-stretch">
        {/* Left */}
        <div className="h-full rounded-2xl bg-white shadow-xl p-6 min-h-[70vh]">
          <div className="space-y-5">
            {/* Destination Chain */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Destination chain</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDestOpen((v) => !v)}
                  disabled={loading}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <img src={dest.iconPath} alt={dest.name} className="h-6 w-6 rounded-md" />
                    <span className="font-medium">{dest.name}</span>
                  </div>
                  <span className="text-gray-400">▾</span>
                </button>

                {destOpen && (
                  <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                    <div className="max-h-72 overflow-auto py-1">
                      {DESTS.map((d) => (
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
                          <img src={d.iconPath} alt={d.name} className="h-6 w-6 rounded-md" />
                          <span className="font-medium text-gray-900">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Recipient */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Recipient address</label>
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
              <label className="mb-2 block text-sm font-medium text-gray-700">Message</label>
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
                    {FEE_USDC}
                    <UsdcIcon className="h-4 w-4" />
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">From</span>
                  <span className="font-semibold text-gray-900">ARC Testnet</span>
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
            </div>

            {/* Bridge Button */}
            <button
              onClick={onBridge}
              disabled={loading || isWrongNetwork || !amountUsdc || parseFloat(amountUsdc) < 5}
              className={[
                "w-full rounded-xl px-6 py-4 font-semibold text-white shadow-lg transition-all",
                loading || isWrongNetwork || !amountUsdc || parseFloat(amountUsdc) < 5
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
              ) : (
                "Send USDC"
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
                        href={`https://testnet.arcscan.app/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900 underline"
                      >
                        View transaction →
                      </a>
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
                      href={`https://testnet.arcscan.app/tx/${h.txHash}`}
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