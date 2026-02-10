"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { parseUnits, type Address } from "viem";
import {
  type ActiveStream,
  STREAMING_ABI,
  STREAMING_DURATIONS,
  calculateClaimable,
  calculateStreamProgress,
  formatTimeRemaining,
  salaryToStream,
} from "@/lib/streaming";
import { formatAddress, formatUSDC } from "@/lib/payments";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const STREAM_COUNT_ABI = [
  {
    type: "function",
    name: "streamCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function StreamingPayment() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const isBusy = isPending || isConfirming;

  const [streams, setStreams] = useState<ActiveStream[]>([]);
  const [currentTime, setCurrentTime] = useState(Math.floor(Date.now() / 1000));
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [lastError, setLastError] = useState<string>("");

  // Form state
  const [recipientAddress, setRecipientAddress] = useState("");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [duration, setDuration] = useState<number>(STREAMING_DURATIONS.MONTHLY);
  const [startDate, setStartDate] = useState<string>("");
  const [startTime, setStartTime] = useState<string>("");

  const STREAMING_PAYMENTS_ADDRESS = (process.env.NEXT_PUBLIC_ARC_STREAMING_PAYMENTS ||
    "0x0000000000000000000000000000000000000000") as Address;

  const USDC_ADDRESS = ((process.env.NEXT_PUBLIC_ARC_USDC || process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS) ||
    "0x3600000000000000000000000000000000000000") as Address;

  const isConfigured =
    STREAMING_PAYMENTS_ADDRESS !== ("0x0000000000000000000000000000000000000000" as Address);

  const [pendingCreate, setPendingCreate] = useState<{
    recipient: Address;
    total: bigint;
    startDay: bigint;
    startTimeSeconds: number;
    end: bigint;
  } | null>(null);

  // Update time every second for real-time display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const calculateStreamInfo = () => {
    if (!salaryAmount) return null;
    const { ratePerSecond, ratePerHour, ratePerDay } = salaryToStream(salaryAmount);
    return {
      ratePerSecond,
      ratePerHour: parseFloat(ratePerHour).toFixed(2),
      ratePerDay: parseFloat(ratePerDay).toFixed(2),
      totalSeconds: duration,
      totalDays: duration / 86400,
    };
  };

  const streamInfo = calculateStreamInfo();

  const myStreamIds = useMemo(() => {
    const raw = localStorage.getItem("arc:streaming:myStreamIds") || "[]";
    const ids = safeJsonParse<number[]>(raw, []).filter((x) => Number.isFinite(x) && x > 0);
    return Array.from(new Set(ids));
  }, [isConfirmed]);

  async function refreshMyStreams() {
    if (!publicClient || !address || !isConfigured) return;
    try {
      // Prefer on-chain indexes; fall back to localStorage ids.
      const [senderIds, recipientIds] = (await Promise.all([
        publicClient.readContract({
          address: STREAMING_PAYMENTS_ADDRESS,
          abi: STREAMING_ABI,
          functionName: "getStreamsBySender",
          args: [address],
        }) as Promise<bigint[]>,
        publicClient.readContract({
          address: STREAMING_PAYMENTS_ADDRESS,
          abi: STREAMING_ABI,
          functionName: "getStreamsByRecipient",
          args: [address],
        }) as Promise<bigint[]>,
      ]).catch(() => [[], []])) as [bigint[], bigint[]];

      const merged = new Set<string>([
        ...senderIds.map((x) => x.toString()),
        ...recipientIds.map((x) => x.toString()),
        ...myStreamIds.map((x) => String(x)),
      ]);

      const next: ActiveStream[] = [];

      for (const idStr of merged) {
        const id = BigInt(idStr);
        const s = (await publicClient.readContract({
          address: STREAMING_PAYMENTS_ADDRESS,
          abi: STREAMING_ABI,
          functionName: "streams",
          args: [id],
        })) as [
          Address,
          Address,
          Address,
          bigint,
          bigint,
          bigint,
          bigint,
          boolean,
        ];

        const sender = s[0];
        const recipient = s[1];
        const start = Number(s[3]);
        const end = Number(s[4]);
        const total = s[5];
        const claimed = s[6];
        const canceled = s[7];

        const viewerLower = address.toLowerCase();
        if (sender.toLowerCase() !== viewerLower && recipient.toLowerCase() !== viewerLower) continue;

        const now = Math.floor(Date.now() / 1000);
        const done = claimed >= total || now >= end;
        const status: ActiveStream["status"] = canceled ? "cancelled" : done ? "completed" : "active";

        const durationSec = Math.max(1, end - start);
        const ratePerSecond = total / BigInt(durationSec);

        next.push({
          id: id.toString(),
          recipient,
          sender,
          ratePerSecond,
          startTime: start,
          endTime: end,
          totalAmount: total,
          claimedAmount: claimed,
          status,
        });
      }

      setStreams(next);
    } catch (e) {
      console.warn("Failed to refresh streams", e);
    }
  }

  useEffect(() => {
    refreshMyStreams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConfigured, isConfirmed]);

  // After approval confirms, create the stream.
  useEffect(() => {
    if (!pendingCreate) return;
    if (!isConfirmed) return;
    if (!isConfigured) return;

    setStatus("Creating stream...");
    writeContract({
      address: STREAMING_PAYMENTS_ADDRESS,
      abi: STREAMING_ABI,
      functionName: "createStream",
      args: [
        USDC_ADDRESS,
        pendingCreate.recipient,
        pendingCreate.total,
        pendingCreate.startDay,
        pendingCreate.startTimeSeconds,
        pendingCreate.end,
      ],
    });
    setPendingCreate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed]);

  // After a tx confirms, persist streamCount as the new stream id (best-effort).
  useEffect(() => {
    if (!isConfirmed) return;
    if (!publicClient || !address || !isConfigured) return;

    (async () => {
      try {
        const count = (await publicClient.readContract({
          address: STREAMING_PAYMENTS_ADDRESS,
          abi: STREAM_COUNT_ABI,
          functionName: "streamCount",
        })) as bigint;
        const idNum = Number(count);
        if (!Number.isFinite(idNum) || idNum <= 0) return;

        const raw = localStorage.getItem("arc:streaming:myStreamIds") || "[]";
        const ids = new Set<number>(safeJsonParse<number[]>(raw, []).filter((x) => Number.isFinite(x) && x > 0));
        ids.add(idNum);
        localStorage.setItem("arc:streaming:myStreamIds", JSON.stringify(Array.from(ids)));

        setStatus(`Stream updated (latest ID ${idNum}).`);
        refreshMyStreams();
      } catch (e) {
        console.warn("Failed to persist stream id", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed, isConfigured, address]);

  const handleCreateStream = () => {
    try {
      setLastError("");
      setStatus("");

      if (!address) throw new Error("Please connect your wallet first");
      if (!isConfigured) throw new Error("StreamingPayments contract not configured (NEXT_PUBLIC_ARC_STREAMING_PAYMENTS).");
      if (!recipientAddress || !salaryAmount) throw new Error("Please fill in all fields");
      if (!recipientAddress.startsWith("0x") || recipientAddress.length !== 42) {
        throw new Error("Recipient address must be a valid 0x address (42 chars).");
      }

      // Require start date/time in the user's local timezone.
      if (!startDate) throw new Error("Please select a start date.");
      if (!startTime) throw new Error("Please select a start time.");

      const recipient = recipientAddress as Address;
      const total = parseUnits(salaryAmount, 6);

      // Build start timestamp from local date + time (same pattern as RecurringPayment.computeFirstRunUnix()).
      const [yyyy, mmDate, dd] = startDate.split("-").map(Number);
      const [hh, mmTime] = startTime.split(":").map(Number);
      const startLocal = new Date();
      startLocal.setFullYear(yyyy, (mmDate || 1) - 1, dd || 1);
      startLocal.setHours(hh || 0, mmTime || 0, 0, 0);

      const startTs = Math.floor(startLocal.getTime() / 1000);
      if (!Number.isFinite(startTs) || startTs <= 0) {
        throw new Error("Start date/time is invalid.");
      }

      const now = Math.floor(Date.now() / 1000);
      if (startTs < now) {
        throw new Error("Start time must be in the future.");
      }

      // Convert unix startTs into (startDay at 00:00:00 UTC) + (seconds since midnight UTC),
      // because the contract's computeStart() is UTC-based.
      const startDayNumber = startTs - (startTs % 86400);
      const startTimeSeconds = startTs % 86400;
      const startDay = BigInt(startDayNumber);

      const end = BigInt(startTs + duration);

      setPendingCreate({ recipient, total, startDay, startTimeSeconds, end });
      setStatus("Approving USDC...");
      writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [STREAMING_PAYMENTS_ADDRESS, total],
      });

      setShowCreateForm(false);
      setStatus("Approval submitted. Waiting for confirmation...");
    } catch (e: any) {
      setLastError(e?.message || "Failed to create stream");
    }
  };

  const handleClaim = (streamId: string) => {
    const stream = streams.find((s) => s.id === streamId);
    if (!stream) return;

    const claimable = calculateClaimable(stream, currentTime);
    if (claimable === 0n) {
      setStatus("Nothing to claim yet.");
      return;
    }

    setLastError("");
    setStatus(`Claiming ${formatUSDC(claimable)} USDC...`);
    writeContract({
      address: STREAMING_PAYMENTS_ADDRESS,
      abi: STREAMING_ABI,
      functionName: "claim",
      args: [BigInt(streamId)],
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Streaming Payments</h2>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-gradient-to-r from-[#ff7582] to-[#725a7a] hover:opacity-90 rounded-lg font-medium transition-opacity"
        >
          {showCreateForm ? "Cancel" : "New Stream"}
        </button>
      </div>

      {status && <div className="text-sm text-gray-500">{status}</div>}
      {lastError && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-700">{lastError}</p>
        </div>
      )}

      {showCreateForm && (
        <div className="arc-card-light p-6 space-y-4">
          <h3 className="text-lg font-medium">Create Payment Stream</h3>

          <div>
            <label className="block text-sm font-medium mb-2">Recipient Address</label>
            <input
              type="text"
              placeholder="0x..."
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              className="w-full px-4 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Total Amount (USDC)</label>
            <input
              type="number"
              placeholder="3000"
              step="0.01"
              value={salaryAmount}
              onChange={(e) => setSalaryAmount(e.target.value)}
              className="w-full px-4 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Duration</label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full px-4 py-2"
            >
              <option value={STREAMING_DURATIONS.DAILY}>1 Day</option>
              <option value={STREAMING_DURATIONS.WEEKLY}>1 Week</option>
              <option value={STREAMING_DURATIONS.MONTHLY}>1 Month</option>
              <option value={STREAMING_DURATIONS.QUARTERLY}>3 Months</option>
              <option value={STREAMING_DURATIONS.YEARLY}>1 Year</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Start time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-4 py-2"
              />
            </div>
          </div>

          {streamInfo && (
            <div className="p-4 bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-lg border border-blue-500/20">
              <p className="text-sm font-medium mb-2">Stream Preview</p>
              <div className="space-y-1 text-sm">
                <p className="flex justify-between">
                  <span className="text-gray-400">Per second:</span>
                  <span className="font-mono">${(Number(streamInfo.ratePerSecond) / 1e6).toFixed(6)}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-gray-400">Per hour:</span>
                  <span className="font-mono">${streamInfo.ratePerHour}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-gray-400">Per day:</span>
                  <span className="font-mono">${streamInfo.ratePerDay}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-gray-400">Total days:</span>
                  <span className="font-mono">{streamInfo.totalDays.toFixed(1)}</span>
                </p>
              </div>
            </div>
          )}

          <button
            onClick={handleCreateStream}
            disabled={!recipientAddress || !salaryAmount || isBusy}
            className="w-full py-3 bg-gradient-to-r from-[#ff7582] to-[#725a7a] hover:opacity-90 rounded-lg font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? "Confirming..." : "Approve & Create"}
          </button>
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-lg font-medium">Active Streams</h3>

        {streams.length === 0 ? (
          <div className="arc-card p-12 text-center">
            <p className="text-gray-500">No streams found (create one to see it here).</p>
          </div>
        ) : (
          <div className="space-y-4">
            {streams.map((stream) => {
              const claimable = calculateClaimable(stream, currentTime);
              const progress = calculateStreamProgress(stream);
              const remaining = stream.endTime ? formatTimeRemaining(stream.endTime) : "Ongoing";
              const isRecipient =
                !!address && stream.recipient.toLowerCase() === address.toLowerCase();

              return (
                <div key={stream.id} className="arc-card p-6 bg-gradient-to-br from-[#ff7582]/10 to-[#725a7a]/10">
                  <div className="flex items-start justify-between mb-4">
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500">
                        Sender: <span className="font-mono">{formatAddress(stream.sender)}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        Recipient: <span className="font-mono">{formatAddress(stream.recipient)}</span>
                      </p>
                      <p className="text-sm font-medium">Stream #{stream.id}</p>
                    </div>
                    <span className="px-3 py-1 bg-white/60 text-gray-700 text-sm rounded-full">
                      {stream.status}
                    </span>
                  </div>

                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-gray-500">Progress</span>
                      <span className="font-medium">{progress.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-black/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[#ff7582] to-[#725a7a] transition-all duration-1000"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                    <div className="p-3 bg-white/60 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Total Amount</p>
                      <p className="font-semibold">{formatUSDC(stream.totalAmount)} USDC</p>
                    </div>
                    <div className="p-3 bg-white/60 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Claimed</p>
                      <p className="font-semibold">{formatUSDC(stream.claimedAmount)} USDC</p>
                    </div>
                    <div className="p-3 bg-white/60 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Available</p>
                      <p className="font-semibold">{formatUSDC(claimable)} USDC</p>
                    </div>
                    <div className="p-3 bg-white/60 rounded-lg">
                      <p className="text-xs text-gray-500 mb-1">Time Remaining</p>
                      <p className="font-semibold">{remaining}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleClaim(stream.id)}
                    disabled={!isRecipient || isBusy || claimable === 0n}
                    className="w-full py-3 bg-gradient-to-r from-[#ff7582] to-[#725a7a] hover:opacity-90 rounded-lg font-medium transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!isRecipient ? "Only recipient can claim" : ""}
                  >
                    {claimable === 0n ? "Nothing to Claim" : `Claim ${formatUSDC(claimable)} USDC`}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
