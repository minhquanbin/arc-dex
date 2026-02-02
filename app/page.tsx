"use client";

import { useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { DESTS } from "@/lib/chains";
import {
  ERC20_ABI,
  ROUTER_ABI,
  HOOK_DATA,
  addressToBytes32,
  buildHookDataWithMemo,
  computeServiceFee,
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

type TabType = "swap" | "bridge" | "liquidity" | "payment" | "issuance";

export default function Home() {
  // Font: Space Grotesk (upload local woff2 to /public/fonts/ if you want the real font file)
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [tab, setTab] = useState<TabType>("bridge");
  const [destKey, setDestKey] = useState(DESTS[0].key);
  const [destOpen, setDestOpen] = useState(false);
  const [amountUsdc, setAmountUsdc] = useState("");
  const [recipient, setRecipient] = useState<string>("");
  const [memo, setMemo] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string>("");

  const dest = useMemo(() => DESTS.find((d) => d.key === destKey) || DESTS[0], [destKey]);

  const expectedChainId = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 5042002);
  const isWrongNetwork = isConnected && chain?.id !== expectedChainId;

  async function switchToARC() {
    try {
      if (!window.ethereum) return;

      const chainIdHex = `0x${expectedChainId.toString(16)}`;

      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: chainIdHex,
                chainName: "ARC Testnet",
                nativeCurrency: {
                  name: "USDC",
                  symbol: "USDC",
                  decimals: 6,
                },
                rpcUrls: [process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.network"],
                blockExplorerUrls: ["https://testnet.arcscan.app"],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }
    } catch (error: any) {
      console.error("Failed to switch network:", error);
      setStatus(`Network switch failed: ${error?.message || "Unknown error"}`);
    }
  }

  // ✅ Compute maxFee giống auto-bridge (line 211-236)
  function computeMaxFee(amountUsdc: string, destinationDomain: number) {
    const amount = parseUnits(amountUsdc, 6);

    // Circle forwarding service base fee
    const minForwardFeeUsdc = destinationDomain === 0 ? "1.25" : "0.2";
    const minForwardFee = parseUnits(minForwardFeeUsdc, 6);

    // maxFee as percentage of amount (basis points) - giống auto-bridge
    const maxFeeBps = BigInt(process.env.NEXT_PUBLIC_MAX_FEE_BPS || "500"); // 5%
    const maxFeeFromPct = (amount * maxFeeBps) / 10000n;

    // Ensure we at least cover the minimum forwarding fee
    let maxFeeToUse = maxFeeFromPct < minForwardFee ? minForwardFee : maxFeeFromPct;

    // Optional hard cap (0 means disabled)
    const maxFeeUsdcCapStr = process.env.NEXT_PUBLIC_MAX_FEE_USDC_CAP || "0";
    const maxFeeUsdcCap = parseUnits(maxFeeUsdcCapStr, 6);

    if (maxFeeUsdcCap > 0n && maxFeeToUse > maxFeeUsdcCap) {
      maxFeeToUse = maxFeeUsdcCap;
    }

    // Final cap: must be strictly less than amount (contract requirement)
    const maxFeeCap = amount - 1n; // 1 base unit = 0.000001 USDC
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

      // ✅ Router contract (1 tx: thu phí + bridge)
      const router = (process.env.NEXT_PUBLIC_ARC_ROUTER ||
        "0xEc02A909701A8eB9C84B93b55B6d4A7ca215CFca") as `0x${string}`;
      let arcUsdc = ((process.env.NEXT_PUBLIC_ARC_USDC ||
        process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS) ||
        "0x3600000000000000000000000000000000000000") as `0x${string}`;
      const minFinality = Number(process.env.NEXT_PUBLIC_MIN_FINALITY_THRESHOLD || "1000");

      // Defaults from env (fallback if router getters fail)
      let feeCollector = FEE_RECEIVER;
      let feeAmount = computeServiceFee();
      let tokenMessengerV2Addr: `0x${string}` | "" = "";
      let destinationCallerBytes32: `0x${string}` | "" = "";

      console.log("📝 Starting bridge with Router:", router);
      console.log("💰 USDC address (env/default):", arcUsdc);

      // ✅ Read config from Router on-chain to avoid env mismatch
      // If this fails, we can't trust balance/allowance checks and the tx may silently revert.
      setStatus("Reading Router config (usdc/serviceFee/feeCollector/destinationCaller)...");
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

        console.log("✅ Router USDC (on-chain):", routerUsdc);
        console.log("✅ Router feeCollector (on-chain):", routerFeeCollector);
        console.log("✅ Router serviceFee (on-chain):", Number(routerServiceFee) / 1e6, "USDC");
        console.log("✅ Router destinationCaller (on-chain):", routerDestCaller);

        // Always trust router values
        arcUsdc = routerUsdc;
        feeCollector = routerFeeCollector;
        feeAmount = routerServiceFee;
        tokenMessengerV2Addr = routerTokenMessengerV2;
        destinationCallerBytes32 = routerDestCaller;

        // Show the critical config in UI too (so you can screenshot it)
        setStatus(
          "Router config:\n" +
            `Router: ${router}\n` +
            `USDC (burnToken): ${routerUsdc}\n` +
            `TokenMessengerV2: ${routerTokenMessengerV2}\n` +
            `FeeCollector: ${routerFeeCollector}\n` +
            `ServiceFee: ${Number(routerServiceFee) / 1e6} USDC\n` +
            `DestinationCaller: ${routerDestCaller}`
        );

        // If env feeCollector differs, warn (but still proceed with router value)
        if (feeCollector.toLowerCase() !== FEE_RECEIVER.toLowerCase()) {
          console.warn(
            `⚠️ feeCollector mismatch. env=${FEE_RECEIVER} / router=${feeCollector}. DApp will use router value.`
          );
        }
      } catch (readCfgErr: any) {
        console.error("Failed to read Router config:", readCfgErr);
        throw new Error(
          `Failed to read Router on-chain config (usdc/serviceFee/feeCollector/destinationCaller). ` +
            `Details: ${readCfgErr?.shortMessage || readCfgErr?.message || "Unknown error"}`
        );
      }

      // ✅ Step 1: Validate inputs
      setStatus("Validating inputs...");

      validateAmount(amountUsdc);
      if (memo) validateMemo(memo);

      // Compute fees
      let amount: bigint, maxFee: bigint;
      try {
        ({ amount, maxFee } = computeMaxFee(amountUsdc, dest.domain));
      } catch (feeErr: any) {
        throw new Error(`Fee calculation error: ${feeErr.message}`);
      }

      // ✅ Circle rule: maxFee must be >= TokenMessengerV2.getMinFeeAmount(amount) (or burn reverts)
      // We read tokenMessengerV2 from router to avoid hardcoding.
      setStatus("Reading minFee from TokenMessengerV2...");
      let minProtocolFee = 0n;
      try {
        const tokenMessenger = (await publicClient.readContract({
          address: router,
          abi: ROUTER_ABI,
          functionName: "tokenMessengerV2",
        })) as `0x${string}`;

        minProtocolFee = (await publicClient.readContract({
          address: tokenMessenger,
          abi: TOKEN_MESSENGER_V2_FEE_ABI,
          functionName: "getMinFeeAmount",
          args: [amount],
        })) as bigint;

        if (minProtocolFee > maxFee) {
          // Add buffer so the forwarding relayer has headroom when destination gas spikes.
          // Still must satisfy contract rule: maxFee < amount.
          const bufferedMinFee = (minProtocolFee * 110n) / 100n; // +10%
          console.warn(
            `maxFee (${Number(maxFee) / 1e6}) < minProtocolFee (${Number(minProtocolFee) / 1e6}). ` +
              `Bumping maxFee to ${Number(bufferedMinFee) / 1e6} (+10%).`
          );

          const maxFeeCap = amount - 1n;
          maxFee = bufferedMinFee > maxFeeCap ? maxFeeCap : bufferedMinFee;
        }
      } catch (minFeeErr: any) {
        console.warn("Failed to read getMinFeeAmount, continuing with current maxFee:", minFeeErr);
      }

      console.log("💰 Amounts:", {
        amount: Number(amount) / 1e6,
        maxFee: Number(maxFee) / 1e6,
        minProtocolFee: Number(minProtocolFee) / 1e6,
        serviceFee: Number(feeAmount) / 1e6,
      });

      // ✅ CRITICAL: Verify maxFee < amount
      if (maxFee >= amount) {
        throw new Error(
          `Invalid fee: maxFee (${Number(maxFee) / 1e6}) must be less than amount (${Number(amount) / 1e6}). ` +
            `Please increase the amount.`
        );
      }

      // ✅ Step 2: Check balance (amount + service fee)
      setStatus("Checking USDC balance...");
      const bal = await publicClient.readContract({
        address: arcUsdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });

      console.log("💵 Balance:", Number(bal) / 1e6, "USDC");

      const totalNeed = amount + feeAmount;
      if (bal < totalNeed) {
        throw new Error(
          `Insufficient USDC balance.\n` +
            `Required: ${(Number(totalNeed) / 1e6).toFixed(6)} USDC (bridge + service fee)\n` +
            `Available: ${(Number(bal) / 1e6).toFixed(6)} USDC\n` +
            `Service fee: ${Number(feeAmount) / 1e6} USDC → ${feeCollector}`
        );
      }

      // ✅ Step 3: Validate recipient
      let recipientAddr: `0x${string}`;
      try {
        recipientAddr = recipient.trim() ? validateRecipient(recipient.trim()) : address;
      } catch (err: any) {
        throw new Error(`Invalid recipient: ${err.message}`);
      }

      // ✅ Step 4: Build hookData (memo-only bytes)
      const finalHookData = buildHookDataWithMemo(HOOK_DATA, memo);

      // ✅ Step 5: Always use 3-step flow
      // 1) transfer service fee
      // 2) approve TokenMessengerV2 for bridge amount
      // 3) burn+message (direct)
      if (!tokenMessengerV2Addr || !destinationCallerBytes32) {
        throw new Error("Failed to read tokenMessengerV2/destinationCaller from Router (required for 3-step flow)." );
      }

      setStatus("3-step mode: (1) fee transfer (2) approve TokenMessengerV2 (3) burn+message...");

      // (Optional) check allowance for TokenMessengerV2
      setStatus("Checking TokenMessengerV2 allowance...");
      const tmAllowance = (await publicClient.readContract({
        address: arcUsdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, tokenMessengerV2Addr],
      })) as bigint;

      if (tmAllowance < amount) {
        setStatus("Please approve USDC for TokenMessengerV2 in your wallet...");
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
    <main className="arc-app min-h-screen">
      <div className="container mx-auto max-w-3xl px-4 py-6">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/arc-logo.svg" alt="ARC" className="h-10 w-10" />
            <h1 className="bg-gradient-to-r from-emerald-500 via-sky-500 to-indigo-500 bg-clip-text text-4xl font-bold text-transparent">
              Arc Bridge
            </h1>
          </div>
          <ConnectButton />
        </div>

        {/* Wrong Network Banner */}
        {isWrongNetwork && (
          <div className="mb-6 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
            <div className="flex items-start gap-3">
              <div className="text-2xl">!</div>
              <div className="flex-1">
                <div className="font-semibold text-orange-900">Wrong network</div>
                <div className="mt-1 text-sm text-orange-700">Please switch to ARC Testnet (Chain ID: {expectedChainId})</div>
                <button
                  onClick={switchToARC}
                  className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                >
                  Switch to ARC Testnet
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Card */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-xl">
          {/* Tabs */}
          <div className="border-b border-gray-200 bg-gray-50">
            <div className="flex">
              {(["bridge", "swap", "liquidity", "payment", "issuance"] as TabType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  disabled={t !== "bridge"}
                  className={[
                    "flex-1 px-6 py-4 text-sm font-semibold transition-all",
                    tab === t
                      ? "border-b-2 border-purple-600 bg-white text-purple-600"
                      : t === "bridge"
                      ? "text-gray-600 hover:bg-gray-100"
                      : "cursor-not-allowed text-gray-400",
                  ].join(" ")}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                  {t !== "bridge" && <span className="ml-2 text-xs">(Soon)</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="p-5">
            {tab === "bridge" && (
              <div className="space-y-6">
                {isConnected ? (
                  <>
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
                              <img
                                src={dest.iconPath}
                                alt={dest.name}
                                className="h-6 w-6 rounded-md"
                              />
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
                                    <img
                                      src={d.iconPath}
                                      alt={d.name}
                                      className="h-6 w-6 rounded-md"
                                    />
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
                            <img src="/usdc.svg" alt="USDC" className="h-6 w-6" />
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">Suggested minimum: 5 USDC</div>
                      </div>

                      {/* Info Box */}
                      <div className="rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 p-4">
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Bridge amount</span>
                            <span className="flex items-center gap-2 font-semibold text-gray-900">
                              {amountUsdc || "0"}
                              <img src="/usdc.svg" alt="USDC" className="h-4 w-4" />
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Service fee</span>
                            <span className="flex items-center gap-2 font-semibold text-gray-900">
                              {FEE_USDC}
                              <img src="/usdc.svg" alt="USDC" className="h-4 w-4" />
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
                            : "bg-gradient-to-r from-emerald-500 via-sky-500 to-indigo-500 hover:from-emerald-600 hover:via-sky-600 hover:to-indigo-600 active:scale-[0.98]",
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
                          "Bridge USDC"
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

                    {/* Donate */}
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="text-xs text-gray-600">Donate: 0xA87Bd559fd6F2646225AcE941bA6648Ec1BAA9AF</div>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center">
                    <div className="mb-4 text-4xl">Wallet</div>
                    <p className="text-gray-600">Connect your wallet to start</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <div className="text-xs text-gray-500">Powered by 1992evm</div>
          <div className="mt-1 text-[11px] text-gray-400">
            Chain logos are sourced from Chainlink Docs and Codex Docs.
          </div>
        </div>
      </div>

      <style jsx global>{`
        :root {
          --arc-c1: #24d6b5;
          --arc-c2: #5ab8ff;
          --arc-c3: #7c5cff;
        }

        .arc-app {
          font-family: "Space Grotesk", Arial, sans-serif;
          background:
            radial-gradient(900px 500px at 15% 10%, rgba(36, 214, 181, 0.20), transparent 60%),
            radial-gradient(800px 420px at 85% 20%, rgba(90, 184, 255, 0.22), transparent 60%),
            radial-gradient(900px 520px at 55% 95%, rgba(124, 92, 255, 0.18), transparent 60%),
            linear-gradient(135deg, rgba(255, 255, 255, 1) 0%, rgba(245, 250, 255, 1) 45%, rgba(248, 245, 255, 1) 100%);
        }

        /* Optional: if you upload a real Space Grotesk woff2 to /public/fonts/, this will load it locally */
        @font-face {
          font-family: "Space Grotesk";
          src: url("/fonts/SpaceGrotesk-VariableFont_wght.woff2") format("woff2");
          font-weight: 300 700;
          font-style: normal;
          font-display: swap;
        }
      `}</style>
    </main>
  );
}