"use client";

import { useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { DESTS } from "@/lib/chains";
import {
  ERC20_ABI,
  addressToBytes32,
  validateRecipient,
  validateAmount,
  validateMemo,
} from "@/lib/cctp";
import { concatHex, parseUnits, stringToHex } from "viem";

// ✅ TokenMessengerV2 ABI - gọi trực tiếp như auto-bridge
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

const HOOK_DATA = "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;
const DEST_CALLER_ZERO = addressToBytes32("0x0000000000000000000000000000000000000000");

const FEE_RECEIVER = "0xA87Bd559fd6F2646225AcE941bA6648Ec1BAA9AF" as const;
const FEE_USDC = "0.01" as const;

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
      setStatus(`Lỗi chuyển mạng: ${error?.message || "Unknown error"}`);
    }
  }

  // ✅ Compute maxFee giống auto-bridge (line 211-236)
  function computeMaxFee(amountUsdc: string, destinationDomain: number) {
    const amount = parseUnits(amountUsdc, 6);

    // Circle forwarding service base fee
    const minForwardFeeUsdc = destinationDomain === 0 ? "1.25" : "0.2";
    const minForwardFee = parseUnits(minForwardFeeUsdc, 6);

    // maxFee as percentage of amount (basis points) - giống auto-bridge
    const maxFeeBps = BigInt(process.env.NEXT_PUBLIC_MAX_FEE_BPS || "2000"); // 20%
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
        `Amount quá nhỏ cho maxFee. ` +
          `Amount: ${Number(amount) / 1e6} USDC, ` +
          `maxFee cần: ${Number(maxFeeToUse) / 1e6} USDC, ` +
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
        throw new Error("Vui lòng kết nối ví trước");
      }

      if (isWrongNetwork) {
        throw new Error(`Vui lòng chuyển sang ARC Testnet (Chain ID: ${expectedChainId})`);
      }

      // ✅ Sử dụng TokenMessengerV2 trực tiếp - giống auto-bridge
      const tokenMessenger = (process.env.NEXT_PUBLIC_ARC_TOKEN_MESSENGER_V2 || 
        "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA") as `0x${string}`;
      const arcUsdc = (process.env.NEXT_PUBLIC_ARC_USDC || 
        "0x3600000000000000000000000000000000000000") as `0x${string}`;
      const minFinality = Number(process.env.NEXT_PUBLIC_MIN_FINALITY_THRESHOLD || "1000");

      console.log("📝 Starting bridge with TokenMessengerV2:", tokenMessenger);
      console.log("💰 USDC address:", arcUsdc);

      // ✅ Step 1: Validate inputs
      setStatus("Đang validate thông tin...");

      validateAmount(amountUsdc);
      if (memo) validateMemo(memo);

      const feeAmount = parseUnits(FEE_USDC, 6);

      // Compute fees
      let amount: bigint, maxFee: bigint;
      try {
        ({ amount, maxFee } = computeMaxFee(amountUsdc, dest.domain));
      } catch (feeErr: any) {
        throw new Error(`Lỗi tính phí: ${feeErr.message}`);
      }

      console.log("💰 Amounts:", {
        amount: Number(amount) / 1e6,
        maxFee: Number(maxFee) / 1e6,
        serviceFee: Number(feeAmount) / 1e6,
      });

      // ✅ CRITICAL: Verify maxFee < amount
      if (maxFee >= amount) {
        throw new Error(
          `Lỗi tính toán: maxFee (${Number(maxFee) / 1e6}) phải nhỏ hơn amount (${Number(amount) / 1e6}). ` +
            `Vui lòng tăng amount hoặc liên hệ support.`
        );
      }

      // ✅ Step 2: Check balance (amount + service fee)
      setStatus("Đang kiểm tra số dư USDC...");
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
          `Số dư USDC không đủ.\n` +
            `Cần: ${(Number(totalNeed) / 1e6).toFixed(6)} USDC (bridge + phí dịch vụ)\n` +
            `Có: ${(Number(bal) / 1e6).toFixed(6)} USDC\n` +
            `Phí dịch vụ: ${Number(feeAmount) / 1e6} USDC → ${FEE_RECEIVER}`
        );
      }

      // ✅ Step 3: Thu phí dịch vụ 0.01 USDC (1 tx ERC20 transfer)
      setStatus(`Đang thu phí dịch vụ ${FEE_USDC} USDC...`);
      const feeHash = await walletClient.writeContract({
        address: arcUsdc,
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [FEE_RECEIVER, feeAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: feeHash });

      // ✅ Step 4: Check và approve nếu cần
      setStatus("Đang kiểm tra allowance...");
      const allowance = await publicClient.readContract({
        address: arcUsdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, tokenMessenger],
      });

      console.log("✅ Allowance:", Number(allowance) / 1e6, "USDC");

      if (allowance < amount) {
        setStatus("Vui lòng approve USDC trong ví...");
        const approveHash = await walletClient.writeContract({
          address: arcUsdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [tokenMessenger, amount],
        });

        setStatus("Đang chờ xác nhận approve...");
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        console.log("✅ Approved:", approveHash);
      }

      // ✅ Step 5: Validate recipient
      let recipientAddr: `0x${string}`;
      try {
        recipientAddr = recipient.trim() ? validateRecipient(recipient.trim()) : address;
      } catch (err: any) {
        throw new Error(`Recipient không hợp lệ: ${err.message}`);
      }

      // ✅ Step 6: Bridge - GỌI TRỰC TIẾP TokenMessengerV2
      setStatus("Đang gửi giao dịch bridge...");

      // Build hookData (memo sẽ được nhúng vào hookData; xử lý on-chain ở chain đích cần hook/receiver tương ứng)
      const finalHookData = memo ? concatHex([HOOK_DATA, stringToHex(memo)]) : HOOK_DATA;

      const hash = await walletClient.writeContract({
        address: tokenMessenger,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurnWithHook",
        args: [
          amount,
          dest.domain,
          addressToBytes32(recipientAddr),
          arcUsdc,
          DEST_CALLER_ZERO,
          maxFee,
          minFinality,
          finalHookData,
        ],
      });

      setTxHash(hash);
      console.log("🚀 Bridge tx:", hash);

      setStatus("Đang chờ xác nhận giao dịch...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === "success") {
        setStatus(
          `✅ Bridge thành công!\n\n` +
            `Số lượng: ${Number(amount) / 1e6} USDC\n` +
            `Từ: ARC Testnet\n` +
            `Đến: ${dest.name}\n` +
            `Recipient: ${recipientAddr}\n\n` +
            `⏳ Chờ 2-5 phút để Circle Forwarding Service xử lý...`
        );
      } else {
        throw new Error("Giao dịch bị revert");
      }
    } catch (err: any) {
      console.error("Bridge error:", err);
      setStatus(`❌ Lỗi: ${err?.message || err?.shortMessage || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-pink-50">
      <div className="container mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-4xl font-bold text-transparent">
              ARC Bridge dApp
            </h1>
            <p className="mt-2 text-gray-600">Circle CCTP + Forwarding Service (Direct TokenMessengerV2)</p>
          </div>
          <ConnectButton />
        </div>

        {/* Wrong Network Banner */}
        {isWrongNetwork && (
          <div className="mb-6 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
            <div className="flex items-start gap-3">
              <div className="text-2xl">⚠️</div>
              <div className="flex-1">
                <div className="font-semibold text-orange-900">Sai mạng</div>
                <div className="mt-1 text-sm text-orange-700">
                  Vui lòng chuyển sang ARC Testnet (Chain ID: {expectedChainId})
                </div>
                <button
                  onClick={switchToARC}
                  className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                >
                  Chuyển sang ARC Testnet
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
          <div className="p-8">
            {tab === "bridge" && (
              <div className="space-y-6">
                {isConnected ? (
                  <>
                    <div className="space-y-5">
                      {/* Destination Chain */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          Chain đích
                        </label>
                        <select
                          value={destKey}
                          onChange={(e) => setDestKey(e.target.value)}
                          disabled={loading}
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
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
                          Địa chỉ nhận (tùy chọn)
                        </label>
                        <input
                          type="text"
                          value={recipient}
                          onChange={(e) => setRecipient(e.target.value)}
                          placeholder={address || "0x..."}
                          disabled={loading}
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                        />
                        <div className="mt-1 text-xs text-gray-500">Để trống = gửi về ví hiện tại</div>
                      </div>

                      {/* Memo */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Memo (on-chain)</label>
                        <input
                          type="text"
                          value={memo}
                          onChange={(e) => setMemo(e.target.value)}
                          placeholder="Nhập nội dung (sẽ nhúng vào hookData)"
                          disabled={loading}
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                        />
                        <div className="mt-1 text-xs text-gray-500">
                          Memo được encode vào <code className="rounded bg-gray-100 px-1">hookData</code>; để xử lý ở chain đích cần
                          contract/hook receiver tương ứng.
                        </div>
                      </div>

                      {/* Amount */}
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">Số lượng</label>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.01"
                            min="0.5"
                            value={amountUsdc}
                            onChange={(e) => setAmountUsdc(e.target.value)}
                            placeholder="Tối thiểu 0.5 USDC"
                            disabled={loading}
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pr-16 text-gray-900 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-200 disabled:cursor-not-allowed disabled:bg-gray-100"
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500">
                            USDC
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">Tối thiểu 0.5 USDC</div>
                      </div>

                      {/* Info Box */}
                      <div className="rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 p-4">
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Số tiền bridge</span>
                            <span className="font-semibold text-gray-900">{amountUsdc || "0"} USDC</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Phí dịch vụ</span>
                            <span className="font-semibold text-gray-900">{FEE_USDC} USDC</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Từ</span>
                            <span className="font-semibold text-gray-900">ARC Testnet</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Đến</span>
                            <span className="font-semibold text-gray-900">{dest.name}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Thời gian ước tính</span>
                            <span className="font-semibold text-gray-900">~2-5 phút</span>
                          </div>
                        </div>
                      </div>

                      {/* Bridge Button */}
                      <button
                        onClick={onBridge}
                        disabled={loading || isWrongNetwork || !amountUsdc || parseFloat(amountUsdc) < 0.5}
                        className={[
                          "w-full rounded-xl px-6 py-4 font-semibold text-white shadow-lg transition-all",
                          loading || isWrongNetwork || !amountUsdc || parseFloat(amountUsdc) < 0.5
                            ? "cursor-not-allowed bg-gray-300"
                            : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 active:scale-[0.98]",
                        ].join(" ")}
                      >
                        {loading ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                            <span>Đang xử lý...</span>
                          </div>
                        ) : isWrongNetwork ? (
                          "Sai mạng"
                        ) : (
                          "Bridge USDC"
                        )}
                      </button>

                      {/* Status Messages */}
                      {status && (
                        <div
                          className={[
                            "rounded-xl border p-4 text-sm",
                            status.includes("thành công") || status.includes("✅")
                              ? "border-green-200 bg-green-50 text-green-800"
                              : status.includes("Lỗi") || status.includes("❌")
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
                                  Xem giao dịch →
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
                        <div className="mb-2 font-semibold text-gray-700">📝 Lưu ý quan trọng:</div>
                        <ul className="ml-4 list-disc space-y-1">
                          <li>Thu phí dịch vụ {FEE_USDC} USDC/lệnh → {FEE_RECEIVER}</li>
                          <li>Gọi trực tiếp TokenMessengerV2 (giống auto-bridge script)</li>
                          <li>Memo được nhúng vào hookData (để xử lý on-chain ở chain đích cần hook/receiver tương ứng)</li>
                          <li>Không cần gas token ở chain đích (Circle Forwarding Service)</li>
                          <li>Giao dịch hoàn tất trong 2-5 phút</li>
                          <li>Số lượng tối thiểu: 0.5 USDC</li>
                        </ul>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center">
                    <div className="mb-4 text-4xl">👛</div>
                    <p className="text-gray-600">Kết nối ví để bắt đầu</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-4 text-xs text-gray-500">
            <span>Powered by Circle CCTP + TokenMessengerV2 (Direct)</span>
            <span>•</span>
            <span>Testnet</span>
            <span>•</span>
            <a
              href="https://docs.circle.com/stablecoins/cctp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-600 hover:text-purple-700 underline"
            >
              📚 Tài liệu
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}