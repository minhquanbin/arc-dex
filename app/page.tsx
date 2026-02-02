"use client";

import { useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { DESTS } from "@/lib/chains";
import {
  ROUTER_ABI,
  addressToBytes32,
  buildHookDataWithMemo,
  computeFeeUsdc,
  computeMaxFee,
  ERC20_ABI,
  HOOK_DATA,
} from "@/lib/cctp";

type TabType = "swap" | "bridge" | "liquidity" | "payment" | "issuance";

export default function Home() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [tab, setTab] = useState<TabType>("bridge");
  const [destKey, setDestKey] = useState(DESTS[0].key);
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
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchError: any) {
        // Chain not added to MetaMask
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: chainIdHex,
              chainName: 'ARC Testnet',
              nativeCurrency: {
                name: 'USDC',
                symbol: 'USDC',
                decimals: 6,
              },
              rpcUrls: [process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.testnet.arc.network'],
              blockExplorerUrls: ['https://testnet.arcscan.app'],
            }],
          });
        } else {
          throw switchError;
        }
      }
    } catch (error: any) {
      console.error('Failed to switch network:', error);
      setStatus(`Error switching network: ${error?.message || 'Unknown error'}`);
    }
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

      const router = (process.env.NEXT_PUBLIC_ARC_ROUTER || "0x82657177d3b529E008cb766475F53CeFb0d95819") as `0x${string}`;
      const usdc = process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS as `0x${string}`;
      const minFinality = Number(process.env.NEXT_PUBLIC_MIN_FINALITY_THRESHOLD || "1000");

      if (!router || !usdc) {
        throw new Error("Contract addresses not configured");
      }

      const amountNum = parseFloat(amountUsdc);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error("Please enter a valid amount");
      }

      const { amount, maxFee } = computeMaxFee(amountUsdc);

      const fee = computeFeeUsdc();
      const totalToApprove = amount + fee;

      setStatus("Checking USDC allowance...");
      const allowance = await publicClient.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, router],
      });

      if (allowance < totalToApprove) {
        setStatus("Please approve USDC in your wallet...");
        const approveHash = await walletClient.writeContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [router, totalToApprove],
        });
        
        setStatus("Waiting for approval confirmation...");
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      const recipientAddr = (recipient || address).trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(recipientAddr)) {
        throw new Error("Recipient address không hợp lệ");
      }

      const hookData = buildHookDataWithMemo(HOOK_DATA, memo);

      setStatus("Please confirm the bridge transaction in your wallet...");
      const burnHash = await walletClient.writeContract({
        address: router,
        abi: ROUTER_ABI,
        functionName: "bridge",
        args: [
          amount,
          dest.domain,
          addressToBytes32(recipientAddr as `0x${string}`),
          maxFee,
          minFinality,
          hookData,
        ],
      });

      setStatus("Waiting for transaction confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: burnHash });
      
      setTxHash(burnHash);
      setStatus("Bridge transaction successful!");
      setAmountUsdc("");
      setMemo("");
    } catch (e: any) {
      console.error("Bridge error:", e);
      setStatus(`Error: ${e?.message || e?.shortMessage || "Transaction failed"}`);
    } finally {
      setLoading(false);
    }
  }

  const tabs: { key: TabType; label: string; icon: string; enabled: boolean }[] = [
    { key: "swap", label: "Swap", icon: "🔄", enabled: false },
    { key: "bridge", label: "Bridge", icon: "🌉", enabled: true },
    { key: "liquidity", label: "Liquidity", icon: "💧", enabled: false },
    { key: "payment", label: "Payment", icon: "💳", enabled: false },
    { key: "issuance", label: "Issuance", icon: "🏦", enabled: false },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg">
              <span className="text-2xl">🌐</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">ARC DEX</h1>
              <p className="text-sm text-gray-600">Bridge & Pay on Tempo Network</p>
            </div>
          </div>
          <ConnectButton />
        </div>

        {/* Wrong Network Warning */}
        {isWrongNetwork && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <span className="text-xl">⚠️</span>
              <div className="flex-1">
                <div className="font-semibold text-amber-900">Wrong Network</div>
                <div className="mt-1 text-sm text-amber-700">
                  Please switch to ARC Testnet (Chain ID: {expectedChainId})
                </div>
                <button
                  onClick={switchToARC}
                  className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition-colors"
                >
                  Switch to ARC Testnet
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Card */}
        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-xl">
          {/* Tabs */}
          <div className="border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50 px-6">
            <div className="flex gap-2">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => t.enabled && setTab(t.key)}
                  disabled={!t.enabled}
                  className={[
                    "relative px-6 py-4 text-sm font-semibold transition-all",
                    tab === t.key
                      ? "text-purple-700"
                      : t.enabled
                      ? "text-gray-600 hover:text-gray-900"
                      : "cursor-not-allowed text-gray-400",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-2">
                    <span>{t.icon}</span>
                    <span>{t.label}</span>
                  </div>
                  {tab === t.key && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 rounded-t-full bg-gradient-to-r from-purple-600 to-blue-600" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="p-8">
            {tab !== "bridge" ? (
              <div className="py-16 text-center">
                <div className="mb-4 text-6xl">🚧</div>
                <h3 className="mb-2 text-xl font-semibold text-gray-900">Coming Soon</h3>
                <p className="text-gray-600">This feature is under development</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Title */}
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-gray-900">Bridge Tokens</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    {isConnected
                      ? "Transfer USDC from ARC to other testnets"
                      : "Connect your wallet to start bridging stablecoins"}
                  </p>
                </div>

                {isConnected ? (
                  <>
                    {/* Bridge Form */}
                    <div className="space-y-4">
                      {/* Destination */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          Destination Chain
                        </label>
                        <select
                          value={destKey}
                          onChange={(e) => setDestKey(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200"
                        >
                          {DESTS.map((d) => (
                            <option key={d.key} value={d.key}>
                              {d.name} (Domain {d.domain})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Recipient */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          Recipient (wallet B)
                        </label>
                        <input
                          type="text"
                          value={recipient}
                          onChange={(e) => setRecipient(e.target.value)}
                          placeholder={address || "0x..."}
                          disabled={loading}
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                        />
                        <div className="mt-1 text-xs text-gray-500">
                          Để trống = gửi về ví đang connect.
                        </div>
                      </div>

                      {/* Memo */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          Memo (optional, max 128 bytes)
                        </label>
                        <input
                          type="text"
                          value={memo}
                          onChange={(e) => setMemo(e.target.value)}
                          placeholder="Nhập nội dung chuyển (tùy chọn)"
                          disabled={loading}
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                        />
                      </div>

                      {/* Amount */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          Amount
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={amountUsdc}
                            onChange={(e) => setAmountUsdc(e.target.value)}
                            placeholder="0.00"
                            disabled={loading}
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pr-16 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500">
                            USDC
                          </div>
                        </div>
                      </div>

                      {/* Info Box */}
                      <div className="rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 p-4">
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Service fee</span>
                            <span className="font-semibold text-gray-900">{process.env.NEXT_PUBLIC_FEE_USDC || "0.01"} USDC</span>
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
                            <span className="font-semibold text-gray-900">~2-5 minutes</span>
                          </div>
                        </div>
                      </div>

                      {/* Bridge Button */}
                      <button
                        onClick={onBridge}
                        disabled={loading || isWrongNetwork || !amountUsdc}
                        className={[
                          "w-full rounded-xl px-6 py-4 font-semibold text-white shadow-lg transition-all",
                          loading || isWrongNetwork || !amountUsdc
                            ? "cursor-not-allowed bg-gray-300"
                            : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 active:scale-[0.98]",
                        ].join(" ")}
                      >
                        {loading ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            <span>Processing...</span>
                          </div>
                        ) : isWrongNetwork ? (
                          "Wrong Network"
                        ) : (
                          "Bridge USDC"
                        )}
                      </button>

                      {/* Status Messages */}
                      {status && (
                        <div
                          className={[
                            "rounded-xl border p-4 text-sm",
                            status.includes("successful")
                              ? "border-green-200 bg-green-50 text-green-800"
                              : status.includes("Error")
                              ? "border-red-200 bg-red-50 text-red-800"
                              : "border-blue-200 bg-blue-50 text-blue-800",
                          ].join(" ")}
                        >
                          <div className="flex items-start gap-3">
                            {loading && (
                              <div className="mt-0.5 h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                            )}
                            <div className="flex-1">
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

                    {/* Footer Note */}
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="text-xs text-gray-600">
                        <div className="mb-2 font-semibold text-gray-700">📝 Important Notes:</div>
                        <ul className="ml-4 list-disc space-y-1">
                          <li>Powered by 1992evm</li>
                          <li>No destination gas tokens required</li>
                          <li>Transactions typically complete in 2-5 minutes</li>
                        </ul>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center">
                    <div className="mb-4 text-4xl">👛</div>
                    <p className="text-gray-600">Connect your wallet to get started</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-4 text-xs text-gray-500">
            <span>Powered by 1992evm</span>
            <span>•</span>
            <span>Testnet</span>
            <span>•</span>
            <a
              href="https://docs.circle.com/stablecoins/cctp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-600 hover:text-purple-700 underline"
            >
              🔗 Chainlink CCIP
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}