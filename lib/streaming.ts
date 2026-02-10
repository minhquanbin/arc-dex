import { type Address, parseUnits } from "viem";

// ==========================================
// TYPES
// ==========================================

export interface StreamConfig {
  recipient: Address;
  ratePerSecond: bigint; // Amount in smallest unit (e.g., USDC with 6 decimals)
  startTime: number; // Unix timestamp
  endTime?: number; // Optional end time
  totalAmount: bigint;
}

export interface ActiveStream {
  id: string;
  recipient: Address;
  sender: Address;
  ratePerSecond: bigint;
  startTime: number;
  endTime?: number;
  totalAmount: bigint;
  claimedAmount: bigint;
  status: "active" | "paused" | "completed" | "cancelled";
}

// ==========================================
// CALCULATIONS
// ==========================================

/**
 * Calculate streaming rate per second
 * @param totalAmount Total amount to stream (e.g., "3000" USDC)
 * @param durationSeconds Duration in seconds
 * @returns Rate per second in smallest unit (6 decimals for USDC)
 */
export function calculateStreamRate(
  totalAmount: string,
  durationSeconds: number
): bigint {
  const amountWei = parseUnits(totalAmount, 6); // USDC has 6 decimals
  return amountWei / BigInt(durationSeconds);
}

/**
 * Calculate claimable amount for a stream
 * @param stream Active stream
 * @param currentTime Current Unix timestamp
 * @returns Claimable amount in smallest unit
 */
export function calculateClaimable(
  stream: ActiveStream,
  currentTime: number
): bigint {
  const now = currentTime;
  const start = stream.startTime;
  const end = stream.endTime || now;

  // Stream hasn't started yet
  if (now < start) return 0n;

  // Calculate elapsed time
  const elapsed = Math.min(now - start, end - start);
  
  // Total earned so far
  const totalEarned = stream.ratePerSecond * BigInt(elapsed);
  
  // Claimable = earned - already claimed
  const claimable = totalEarned - stream.claimedAmount;
  
  // Cap at remaining amount
  const remaining = stream.totalAmount - stream.claimedAmount;
  
  return claimable > remaining ? remaining : claimable;
}

/**
 * Calculate streaming progress percentage
 */
export function calculateStreamProgress(stream: ActiveStream): number {
  if (!stream.endTime) return 0;
  
  const now = Date.now() / 1000;
  const duration = stream.endTime - stream.startTime;
  const elapsed = now - stream.startTime;
  
  const progress = (elapsed / duration) * 100;
  return Math.min(Math.max(progress, 0), 100);
}

/**
 * Convert salary to streaming parameters
 * @param salaryPerMonth Monthly salary (e.g., "3000" USDC)
 * @returns Stream configuration
 */
export function salaryToStream(salaryPerMonth: string): {
  ratePerSecond: bigint;
  ratePerHour: string;
  ratePerDay: string;
} {
  const secondsPerMonth = 30 * 24 * 60 * 60; // ~30 days
  const ratePerSecond = calculateStreamRate(salaryPerMonth, secondsPerMonth);
  
  const ratePerHour = (ratePerSecond * BigInt(3600)) / BigInt(1e6);
  const ratePerDay = (ratePerSecond * BigInt(86400)) / BigInt(1e6);
  
  return {
    ratePerSecond,
    ratePerHour: ratePerHour.toString(),
    ratePerDay: ratePerDay.toString(),
  };
}

/**
 * Format time remaining
 */
export function formatTimeRemaining(endTime: number): string {
  const now = Date.now() / 1000;
  const remaining = Math.max(0, endTime - now);
  
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ==========================================
// SMART CONTRACT ABIs (Simplified)
// ==========================================

/**
 * Streaming Payment Contract ABI
 * This is a simplified version - in production, use full ABI from compiled contract
 */
export const STREAMING_ABI = [
  {
    type: "function",
    name: "createStream",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "total", type: "uint256" },
      { name: "startDay", type: "uint64" },
      { name: "startTimeSeconds", type: "uint32" },
      { name: "end", type: "uint64" },
    ],
    outputs: [{ name: "streamId", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "streamId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "streamId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{ name: "streamId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "streams",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "sender", type: "address" },
      { name: "recipient", type: "address" },
      { name: "token", type: "address" },
      { name: "start", type: "uint64" },
      { name: "end", type: "uint64" },
      { name: "total", type: "uint256" },
      { name: "claimed", type: "uint256" },
      { name: "canceled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getStreamsBySender",
    stateMutability: "view",
    inputs: [{ name: "sender", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getStreamsByRecipient",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "event",
    name: "StreamCreated",
    inputs: [
      { name: "streamId", type: "uint256", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StreamClaimed",
    inputs: [
      { name: "streamId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

// ==========================================
// VESTING HELPERS
// ==========================================

/**
 * Create vesting schedule
 */
export function createVestingSchedule(
  totalTokens: string,
  cliffMonths: number,
  vestingMonths: number
): {
  cliffEnd: number;
  vestingEnd: number;
  tokensAtCliff: bigint;
  monthlyRelease: bigint;
} {
  const total = parseUnits(totalTokens, 6); // Assuming 6 decimals
  const now = Math.floor(Date.now() / 1000);
  
  const cliffEnd = now + cliffMonths * 30 * 24 * 60 * 60;
  const vestingEnd = now + vestingMonths * 30 * 24 * 60 * 60;
  
  // Typically 25% at cliff, rest vests linearly
  const tokensAtCliff = total / 4n;
  const remainingMonths = vestingMonths - cliffMonths;
  const monthlyRelease = remainingMonths > 0 
    ? (total - tokensAtCliff) / BigInt(remainingMonths)
    : 0n;
  
  return {
    cliffEnd,
    vestingEnd,
    tokensAtCliff,
    monthlyRelease,
  };
}

// ==========================================
// DEMO/MOCK DATA
// ==========================================

/**
 * Generate demo stream for testing
 */
export function generateDemoStream(recipient: Address): ActiveStream {
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - 7 * 24 * 60 * 60; // Started 7 days ago
  const endTime = now + 23 * 24 * 60 * 60; // Ends in 23 days
  
  const totalAmount = parseUnits("3000", 6); // $3000
  const duration = endTime - startTime;
  const ratePerSecond = totalAmount / BigInt(duration);
  
  const elapsed = now - startTime;
  const claimedAmount = (ratePerSecond * BigInt(elapsed)) / 2n; // Claimed half
  
  return {
    id: "demo-stream-1",
    recipient,
    sender: "0x0000000000000000000000000000000000000000" as Address,
    ratePerSecond,
    startTime,
    endTime,
    totalAmount,
    claimedAmount,
    status: "active",
  };
}

/**
 * Get common streaming durations
 */
export const STREAMING_DURATIONS = {
  HOURLY: 3600,
  DAILY: 86400,
  WEEKLY: 604800,
  MONTHLY: 2592000, // 30 days
  QUARTERLY: 7776000, // 90 days
  YEARLY: 31536000, // 365 days
} as const;

/**
 * Get common vesting schedules
 */
export const VESTING_TEMPLATES = {
  STANDARD: { cliff: 12, vesting: 48 }, // 1 year cliff, 4 year vest
  ADVISOR: { cliff: 0, vesting: 24 }, // No cliff, 2 year vest
  INVESTOR: { cliff: 6, vesting: 24 }, // 6 month cliff, 2 year vest
  EMPLOYEE: { cliff: 12, vesting: 36 }, // 1 year cliff, 3 year vest
} as const;
