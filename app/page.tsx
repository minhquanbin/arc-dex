"use client";

import { useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { DESTS } from "@/lib/chains";
import {
  addressToBytes32,
  computeMaxFee,
  DEST_CALLER_ZERO,
  ERC20_ABI,
  HOOK_DATA,
  TOKEN_MESSENGER_V2_ABI,
} from "@/lib/cctp";

type TabType = "bridge" | "swap" | "payment" | "deploy";

export default function Home() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [tab, setTab] = useState<TabType>("bridge");
  const [destKey, setDestKey] = useState(DESTS[0].key);
  const [amountUsdc, setAmountUsdc] = useState("2.00");
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string>("");

  const dest = useMemo(() => DESTS.find((d) => d.key === destKey)!, [destKey]);

  const expectedChainId = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 12345);
  const isWrongNetwork = isConnected && chain?.id !== expectedChainId;

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

      const tokenMessenger = process.env.NEXT_PUBLIC_ARC_TOKEN_MESSENGER_V2 as `0x${string}`;
      const usdc = process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS as `0x${string}`;
      const minFinality = Number(process.env.NEXT_PUBLIC_MIN_FINALITY_THRESHOLD || "1000");

      // Validate amount
      const amountNum = parseFloat(amountUsdc);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error("Please enter a valid amount");
      }

      // Compute fee
      const { amount, maxFee } = computeMaxFee(amountUsdc);

      // 1) Check and approve USDC
      setStatus("Checking USDC allowance...");
      const allowance = await publicClient.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, tokenMessenger],
      });

      if (allowance < amount) {
        setStatus("Please approve USDC in your wallet...");
        const approveHash = await walletClient.writeContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [tokenMessenger, amount],
        });
        
        setStatus("Waiting for approval confirmation...");
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // 2) Execute bridge transaction
      setStatus("Please confirm the bridge transaction in your wallet...");
      const burnHash = await walletClient.writeContract({
        address: tokenMessenger,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurnWithHook",
        args: [
          amount,
          dest.domain,
          addressToBytes32(address),
          usdc,
          DEST_CALLER_ZERO,
          maxFee,
          minFinality,
          HOOK_DATA,
        ],
      });

      setStatus("Waiting for transaction confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: burnHash });
      
      setTxHash(burnHash);
      setStatus("✅ Bridge transaction successful!");
    } catch (e: any) {
      console.error("Bridge error:", e);
      setStatus(`❌ Error: ${e?.message || e?.shortMessage || "Transaction failed"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(76,29,149,0.1),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(59,130,246,0.1),transparent_50%)]" />
      
      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              ARC dApp
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Cross-chain bridge powered by CCTP
            </p>
          </div>
          <ConnectButton />
        </div>

        {/* Wrong Network Warning */}
        {isWrongNetwork && (
          <div className="mt-6 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4">
            <div className="flex items-start gap-3">
              <div className="text-2xl">⚠️</div>
              <div className="flex-1">
                <div className="font-semibold text-yellow-200">Wrong Network</div>
                <div className="mt-1 text-sm text-yellow-300/80">
                  Please switch to ARC Testnet (Chain ID: {expectedChainId}) in your wallet
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["bridge", "swap", "payment", "deploy"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              disabled={k !== "bridge"}
              className={[
                "group relative rounded-2xl border p-4 text-left transition-all duration-200",
                tab === k
                  ? "border-blue-500/50 bg-blue-500/10 shadow-lg shadow-blue-500/20"
                  : "border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900/80",
                k !== "bridge" && "cursor-not-allowed opacity-50",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="font-semibold text-white capitalize">{k}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {k === "bridge" ? "Live" : "Coming soon"}
                  </div>
                </div>
                {k === "bridge" && (
                  <div className="h-2 w-2 rounded-full bg-green-400 shadow-lg shadow-green-400/50" />
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/50 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          {tab !== "bridge" ? (
            <div className="py-12 text-center">
              <div className="text-6xl mb-4">🚧</div>
              <div className="text-xl font-semibold text-white">Coming Soon</div>
              <div className="mt-2 text-slate-400">This feature is under development</div>
            </div>
          ) : (
            <>
              {/* Bridge Header */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white">Bridge USDC</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Transfer USDC from ARC to other testnets
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Forwarding Service
                </div>
              </div>

              {/* Form */}
              <div className="mt-8 space-y-5">
                {/* Destination */}
                <div>
                  <label className="block text-sm font-medium text-slate-300">
                    Destination Chain
                  </label>
                  <select
                    value={destKey}
                    onChange={(e) => setDestKey(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 text-white outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  >
                    {DESTS.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.name} (Domain {d.domain})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-slate-300">
                    Amount (USDC)
                  </label>
                  <div className="relative mt-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={amountUsdc}
                      onChange={(e) => setAmountUsdc(e.target.value)}
                      placeholder="2.00"
                      disabled={loading}
                      className="w-full rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3 pr-16 text-white outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                      USDC
                    </div>
                  </div>
                </div>

                {/* Bridge Info */}
                <div className="rounded-xl border border-slate-800 bg-slate-800/30 p-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">From:</span>
                      <span className="font-medium text-white">ARC Testnet</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">To:</span>
                      <span className="font-medium text-white">{dest.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Estimated time:</span>
                      <span className="font-medium text-white">~2-5 minutes</span>
                    </div>
                  </div>
                </div>

                {/* Bridge Button */}
                <button
                  onClick={onBridge}
                  disabled={!isConnected || loading || isWrongNetwork}
                  className={[
                    "w-full rounded-xl px-6 py-4 font-semibold text-white transition-all duration-200",
                    !isConnected || loading || isWrongNetwork
                      ? "cursor-not-allowed bg-slate-700 opacity-50"
                      : "bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-500 hover:via-purple-500 hover:to-pink-500 shadow-lg shadow-purple-500/25",
                  ].join(" ")}
                >
                  {!isConnected
                    ? "Connect Wallet to Bridge"
                    : isWrongNetwork
                    ? "Wrong Network"
                    : loading
                    ? "Processing..."
                    : "Bridge USDC"}
                </button>

                {/* Status Messages */}
                {status && (
                  <div
                    className={[
                      "rounded-xl border p-4 text-sm",
                      status.includes("✅")
                        ? "border-green-500/20 bg-green-500/10 text-green-300"
                        : status.includes("❌")
                        ? "border-red-500/20 bg-red-500/10 text-red-300"
                        : "border-blue-500/20 bg-blue-500/10 text-blue-300",
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-3">
                      {loading && (
                        <div className="mt-0.5 h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                      )}
                      <div className="flex-1">{status}</div>
                    </div>
                    {txHash && (
                      <a
                        href={`https://explorer.testnet.arc.network/tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-green-400 hover:text-green-300 underline"
                      >
                        View transaction →
                      </a>
                    )}
                  </div>
                )}

                {/* Note */}
                <div className="rounded-xl border border-slate-800 bg-slate-800/20 p-4">
                  <div className="text-xs text-slate-400">
                    <div className="font-medium text-slate-300 mb-1">📝 Note:</div>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Transactions use CCTP's Forwarding Service</li>
                      <li>No destination gas tokens required</li>
                      <li>Reverse bridging (testnet → ARC) coming soon</li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-slate-500">
          <p>Powered by Circle's CCTP • Built on ARC Testnet</p>
        </div>
      </div>
    </main>
  );
}