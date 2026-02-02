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

export function computeMaxFee(amountUsdc: string, destinationDomain?: number) {
  const amount = parseUnits(amountUsdc, 6);

  // Forwarding Service fee (Circle docs): Ethereum $1.25, all other chains $0.20.
  const baseFeeUsdc = destinationDomain === 0 ? "1.25" : "0.2";
  const baseFee = parseUnits(baseFeeUsdc, 6);

  // buffer mặc định 10% (1000 bps). Có thể override bằng NEXT_PUBLIC_FORWARD_FEE_BUFFER_BPS.
  const bufferBps = BigInt(process.env.NEXT_PUBLIC_FORWARD_FEE_BUFFER_BPS || "1000");
  let maxFee = (baseFee * (10000n + bufferBps)) / 10000n;

  // Optional hard cap (0 means disabled)
  const capUsdc = process.env.NEXT_PUBLIC_MAX_FEE_USDC_CAP || "0";
  const cap = parseUnits(capUsdc, 6);
  if (cap > 0n && maxFee > cap) maxFee = cap;

  // Contract yêu cầu maxFee < amount
  if (maxFee >= amount) throw new Error("Amount quá nhỏ so với maxFee.");
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
  // Bật thử nghiệm bằng NEXT_PUBLIC_ENABLE_HOOK_MEMO=true nếu bạn chắc chắn hook cho phép.
  const enabled = (process.env.NEXT_PUBLIC_ENABLE_HOOK_MEMO || "").toLowerCase() === "true";
  if (!enabled) return baseHookData;

  const m = (memo ?? "").trim();
  if (!m) return baseHookData;

  const bytes = new TextEncoder().encode(m); // UTF-8
  if (bytes.length > 128) throw new Error("Memo tối đa 128 bytes (UTF-8).");

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return (baseHookData + hex) as `0x${string}`;
}