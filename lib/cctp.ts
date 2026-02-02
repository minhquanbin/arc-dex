import { parseUnits } from "viem";

export function addressToBytes32(address: `0x${string}`) {
  return (`0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`) as `0x${string}`;
}

// ✅ Use TokenMessengerV2 ABI (from working auto script)
export const TOKEN_MESSENGER_V2_ABI = [
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
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

export const ERC20_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [
    { name: "owner", type: "address" }, { name: "spender", type: "address" }
  ], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [
    { name: "owner", type: "address" }
  ], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [
    { name: "spender", type: "address" }, { name: "amount", type: "uint256" }
  ], outputs: [{ name: "", type: "bool" }] },
] as const;

// ✅ Exact logic from working auto script
export function computeMaxFee(amountUsdc: string, destinationDomain: number) {
  const amount = parseUnits(amountUsdc, 6);

  // Circle forwarding service base fee (from docs)
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

export const HOOK_DATA =
  "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;

export const DEST_CALLER_ZERO = addressToBytes32("0x0000000000000000000000000000000000000000");

// Validate recipient address
export function validateRecipient(address: string): `0x${string}` {
  const cleaned = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(cleaned)) {
    throw new Error("Địa chỉ recipient không hợp lệ. Phải là địa chỉ Ethereum 42 ký tự (0x...)");
  }
  return cleaned as `0x${string}`;
}

// Validate amount
export function validateAmount(amountStr: string): number {
  const num = parseFloat(amountStr);
  if (isNaN(num) || num <= 0) {
    throw new Error("Amount phải là số dương lớn hơn 0");
  }
  // Minimum based on Circle's forwarding fee
  if (num < 0.5) {
    throw new Error("Amount tối thiểu 0.5 USDC");
  }
  return num;
}