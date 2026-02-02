import { parseUnits } from "viem";

// =====================================================
// ROUTER ABI - Main contract for bridge with fees
// =====================================================
export const ROUTER_ABI = [
  {
    type: "function",
    name: "bridge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenMessengerV2",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "feeCollector",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "BridgeInitiated",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "serviceFee", type: "uint256", indexed: false },
      { name: "destinationDomain", type: "uint32", indexed: false },
      { name: "nonce", type: "uint64", indexed: false },
      { name: "memo", type: "string", indexed: false },
    ],
  },
] as const;

// =====================================================
// ERC20 ABI
// =====================================================
export const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
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

// =====================================================
// HELPER FUNCTIONS
// =====================================================

/**
 * Convert Ethereum address to bytes32 format
 */
export function addressToBytes32(address: `0x${string}`) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as `0x${string}`;
}

/**
 * Compute maxFee based on Circle's requirements
 * - Domain 0 (Ethereum): min 1.25 USDC
 * - Other domains: min 0.2 USDC
 * - maxFee must be < amount (contract requirement)
 */
export function computeMaxFee(amountUsdc: string, destinationDomain: number) {
  const amount = parseUnits(amountUsdc, 6);

  // Circle forwarding service base fee
  const minForwardFeeUsdc = destinationDomain === 0 ? "1.25" : "0.2";
  const minForwardFee = parseUnits(minForwardFeeUsdc, 6);

  // maxFee as percentage of amount (basis points)
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

/**
 * Compute service fee (0.01 USDC per transaction)
 */
export function computeServiceFee(): bigint {
  const feeUsdc = process.env.NEXT_PUBLIC_FEE_USDC || "0.01";
  return parseUnits(feeUsdc, 6);
}

/**
 * Build hookData with memo
 * Format: cctp-forward header (32 bytes) + UTF-8 memo (max 128 bytes)
 */
export function buildHookDataWithMemo(baseHookData: string, memo: string): `0x${string}` {
  if (!memo || memo.trim() === "") {
    return baseHookData as `0x${string}`;
  }

  // Encode memo as UTF-8 hex
  const encoder = new TextEncoder();
  const memoBytes = encoder.encode(memo.trim());

  // Limit memo to 128 bytes
  const maxMemoLength = 128;
  const truncatedMemo = memoBytes.slice(0, maxMemoLength);

  // Convert to hex
  const memoHex = Array.from(truncatedMemo)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Combine: base hookData (32 bytes) + memo
  return `${baseHookData}${memoHex}` as `0x${string}`;
}

// =====================================================
// CONSTANTS
// =====================================================

/**
 * Base hookData for Circle CCTP forwarding
 */
export const HOOK_DATA = "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;

/**
 * Zero address in bytes32 format (for destinationCaller)
 */
export const DEST_CALLER_ZERO = addressToBytes32("0x0000000000000000000000000000000000000000");

// =====================================================
// VALIDATION FUNCTIONS
// =====================================================

/**
 * Validate recipient address
 */
export function validateRecipient(address: string): `0x${string}` {
  const cleaned = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(cleaned)) {
    throw new Error("Địa chỉ recipient không hợp lệ. Phải là địa chỉ Ethereum 42 ký tự (0x...)");
  }
  return cleaned as `0x${string}`;
}

/**
 * Validate amount
 */
export function validateAmount(amountStr: string): number {
  const num = parseFloat(amountStr);
  if (isNaN(num) || num <= 0) {
    throw new Error("Amount phải là số dương lớn hơn 0");
  }
  // Minimum based on Circle's forwarding fee + service fee
  if (num < 0.5) {
    throw new Error("Amount tối thiểu 0.5 USDC");
  }
  return num;
}

/**
 * Validate memo length
 */
export function validateMemo(memo: string): void {
  if (!memo) return;
  
  const encoder = new TextEncoder();
  const memoBytes = encoder.encode(memo);
  
  if (memoBytes.length > 128) {
    throw new Error(`Memo quá dài (${memoBytes.length} bytes). Tối đa 128 bytes.`);
  }
}