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

export function computeMaxFee(amountUsdc: string) {
  const amount = parseUnits(amountUsdc, 6);
  const maxFeeBps = BigInt(process.env.NEXT_PUBLIC_MAX_FEE_BPS || "2000");
  const capUsdc = process.env.NEXT_PUBLIC_MAX_FEE_USDC_CAP || "0";
  const cap = parseUnits(capUsdc, 6);

  // min fee theo docs forwarding (domain 0: 1.25, others: 0.2) sẽ check ở UI theo domain
  const fromPct = (amount * maxFeeBps) / 10000n;
  const maxFee = cap > 0n && fromPct > cap ? cap : fromPct;

  // contract yêu cầu maxFee < amount
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
] as const;

export function computeFeeUsdc() {
  const feeStr = process.env.NEXT_PUBLIC_FEE_USDC || "0.01";
  return parseUnits(feeStr, 6);
}

export function buildHookDataWithMemo(baseHookData: `0x${string}`, memo?: string) {
  const m = (memo ?? "").trim();
  if (!m) return baseHookData;

  const bytes = new TextEncoder().encode(m); // UTF-8
  if (bytes.length > 128) throw new Error("Memo tối đa 128 bytes (UTF-8).");

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return (baseHookData + hex) as `0x${string}`;
}