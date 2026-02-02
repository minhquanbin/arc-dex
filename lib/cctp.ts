import { parseUnits } from "viem";

export function addressToBytes32(address: `0x${string}`) {
  return (`0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`) as `0x${string}`;
}

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

// ✅ FIX: Tính maxFee đảm bảo LUÔN LUÔN maxFee < amount
export function computeMaxFee(amountUsdc: string, destinationDomain?: number) {
  const amount = parseUnits(amountUsdc, 6);

  // Circle forwarding service base fee
  const baseFeeUsdc = destinationDomain === 0 ? "1.25" : "0.2"; // Ethereum = $1.25, others = $0.20
  const baseFee = parseUnits(baseFeeUsdc, 6);

  // Buffer 10% (1000 bps) theo Circle docs recommendation
  const bufferBps = BigInt(process.env.NEXT_PUBLIC_FORWARD_FEE_BUFFER_BPS || "1000");
  let maxFee = (baseFee * (10000n + bufferBps)) / 10000n;

  // Optional hard cap
  const capUsdc = process.env.NEXT_PUBLIC_MAX_FEE_USDC_CAP || "0";
  const cap = parseUnits(capUsdc, 6);
  if (cap > 0n && maxFee > cap) maxFee = cap;

  // ⚠️ CRITICAL FIX: Contract yêu cầu maxFee < amount (STRICT inequality)
  // Nếu maxFee >= amount, giảm maxFee xuống còn 50% của amount
  if (maxFee >= amount) {
    console.warn(`⚠️ maxFee (${Number(maxFee) / 1e6}) >= amount (${Number(amount) / 1e6}), tự động giảm maxFee`);
    maxFee = amount / 2n; // Safe: luôn đảm bảo maxFee < amount
  }

  // Double check safety
  if (maxFee >= amount) {
    throw new Error(
      `Lỗi nghiêm trọng: maxFee (${Number(maxFee) / 1e6} USDC) >= amount (${Number(amount) / 1e6} USDC). ` +
      `Contract yêu cầu maxFee < amount. Vui lòng tăng amount.`
    );
  }

  return { amount, maxFee };
}

export const HOOK_DATA =
  "0x636374702d666f72776172640000000000000000000000000000000000000000" as const; // cctp-forward + version/len

export const DEST_CALLER_ZERO = addressToBytes32("0x0000000000000000000000000000000000000000");

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
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenMessengerV2", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feeCollector", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

export function computeFeeUsdc() {
  const feeStr = process.env.NEXT_PUBLIC_FEE_USDC || "0.01";
  return parseUnits(feeStr, 6);
}

export function buildHookDataWithMemo(baseHookData: `0x${string}`, memo?: string) {
  // NOTE: Forwarding hook "cctp-forward" thường kỳ vọng hookData fixed-size 32 bytes.
  // Nếu append thêm bytes có thể làm TokenMessengerV2 revert. Mặc định: KHÔNG append memo.
  const enabled = (process.env.NEXT_PUBLIC_ENABLE_HOOK_MEMO || "").toLowerCase() === "true";
  if (!enabled) return baseHookData;

  const m = (memo ?? "").trim();
  if (!m) return baseHookData;

  const bytes = new TextEncoder().encode(m);
  if (bytes.length > 128) throw new Error("Memo tối đa 128 bytes (UTF-8).");

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return (baseHookData + hex) as `0x${string}`;
}

// Validate recipient address
export function validateRecipient(address: string): `0x${string}` {
  const cleaned = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(cleaned)) {
    throw new Error("Địa chỉ recipient không hợp lệ. Phải là địa chỉ Ethereum 42 ký tự (0x...)");
  }
  return cleaned as `0x${string}`;
}

// ✅ FIX: Validate amount - giảm minimum xuống 0.5 USDC
export function validateAmount(amountStr: string): number {
  const num = parseFloat(amountStr);
  if (isNaN(num) || num <= 0) {
    throw new Error("Amount phải là số dương lớn hơn 0");
  }
  // Giảm minimum từ 1.5 → 0.5 USDC vì maxFee đã được fix tự động
  if (num < 0.5) {
    throw new Error("Amount tối thiểu 0.5 USDC");
  }
  return num;
}