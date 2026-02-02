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
  // Minimum based on Circle's forwarding fee
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