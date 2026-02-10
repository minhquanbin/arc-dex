import { parseUnits, formatUnits, type Address } from "viem";

// ==========================================
// TYPES & INTERFACES
// ==========================================

export interface PaymentRecipient {
  address: Address;
  amount: string; // In USDC (e.g., "100.50")
  label?: string;
  id?: string;
}

export interface BatchPaymentSummary {
  totalRecipients: number;
  totalAmount: bigint;
  estimatedGas: bigint;
  errors: string[];
}

export interface PaymentHistory {
  id: string;
  timestamp: number;
  type: "batch" | "recurring" | "streaming";
  recipients: PaymentRecipient[];
  totalAmount: string;
  txHash: string;
  status: "pending" | "success" | "failed";
}

export interface ScheduledPayment {
  id: string;
  name: string;
  recipients: PaymentRecipient[];
  schedule: {
    frequency: "daily" | "weekly" | "biweekly" | "monthly";
    dayOfWeek?: number; // 0-6 for weekly
    dayOfMonth?: number; // 1-31 for monthly
    time: string; // "09:00"
  };
  nextRun: number; // timestamp
  isActive: boolean;
  createdAt: number;
}

// ==========================================
// CSV PARSING
// ==========================================

/**
 * Parse CSV content into payment recipients
 * Expected format: address,amount,label
 * Example: 0x123...,100.50,John Doe
 */
export function parseCSV(content: string): {
  recipients: PaymentRecipient[];
  errors: string[];
} {
  const recipients: PaymentRecipient[] = [];
  const errors: string[] = [];

  const lines = content.split("\n").filter((line) => line.trim());

  // Skip header if exists
  const startIndex = lines[0]?.toLowerCase().includes("address") ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",").map((p) => p.trim());

    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: Invalid format (need at least address,amount)`);
      continue;
    }

    const [address, amount, label] = parts;

    // Validate address
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      errors.push(`Line ${i + 1}: Invalid address "${address}"`);
      continue;
    }

    // Validate amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      errors.push(`Line ${i + 1}: Invalid amount "${amount}"`);
      continue;
    }

    recipients.push({
      address: address as Address,
      amount: amount,
      label: label || undefined,
      id: `${address}-${i}`,
    });
  }

  return { recipients, errors };
}

/**
 * Generate CSV template content
 */
export function generateCSVTemplate(): string {
  return `address,amount,label
0x1234567890123456789012345678901234567890,100.00,John Doe
0x0987654321098765432109876543210987654321,50.50,Jane Smith
0xabcdefabcdefabcdefabcdefabcdefabcdefabcd,75.25,Alice Johnson`;
}

/**
 * Export payment history to CSV
 */
export function exportHistoryToCSV(history: PaymentHistory[]): string {
  const header = "Timestamp,Type,Recipients,Amount,Status,TxHash\n";
  const rows = history.map((h) => {
    const date = new Date(h.timestamp).toISOString();
    return `${date},${h.type},${h.recipients.length},${h.totalAmount},${h.status},${h.txHash}`;
  });
  return header + rows.join("\n");
}

// ==========================================
// VALIDATION
// ==========================================

/**
 * Validate recipients list
 */
export function validateRecipients(
  recipients: PaymentRecipient[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (recipients.length === 0) {
    errors.push("No recipients provided");
    return { isValid: false, errors };
  }

  if (recipients.length > 500) {
    errors.push("Too many recipients (max 500 per batch)");
  }

  // Check for duplicate addresses
  const addressSet = new Set<string>();
  recipients.forEach((r, i) => {
    const addr = r.address.toLowerCase();
    if (addressSet.has(addr)) {
      errors.push(`Duplicate address at row ${i + 1}: ${r.address}`);
    }
    addressSet.add(addr);
  });

  // Validate each recipient
  recipients.forEach((r, i) => {
    if (!r.address.match(/^0x[a-fA-F0-9]{40}$/)) {
      errors.push(`Invalid address at row ${i + 1}: ${r.address}`);
    }

    const amount = parseFloat(r.amount);
    if (isNaN(amount) || amount <= 0) {
      errors.push(`Invalid amount at row ${i + 1}: ${r.amount}`);
    }

    if (amount > 1000000) {
      errors.push(`Amount too large at row ${i + 1}: ${r.amount} (max 1M USDC)`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ==========================================
// CALCULATIONS
// ==========================================

/**
 * Calculate total amount for batch payment
 */
export function calculateBatchTotal(recipients: PaymentRecipient[]): bigint {
  return recipients.reduce((sum, r) => {
    const amount = parseUnits(r.amount, 6); // USDC has 6 decimals
    return sum + amount;
  }, 0n);
}

/**
 * Estimate gas for batch payment
 * Very rough estimate: 50k gas per recipient
 */
export function estimateGas(recipientCount: number): bigint {
  const baseGas = 100000n; // Base transaction cost
  const perRecipientGas = 50000n;
  return baseGas + perRecipientGas * BigInt(recipientCount);
}

/**
 * Calculate payment summary
 */
export function calculatePaymentSummary(
  recipients: PaymentRecipient[]
): BatchPaymentSummary {
  const validation = validateRecipients(recipients);

  return {
    totalRecipients: recipients.length,
    totalAmount: calculateBatchTotal(recipients),
    estimatedGas: estimateGas(recipients.length),
    errors: validation.errors,
  };
}

// ==========================================
// STORAGE (LocalStorage)
// ==========================================

const STORAGE_KEYS = {
  HISTORY: "arc-payments-history",
  SCHEDULED: "arc-payments-scheduled",
  TEMPLATES: "arc-payments-templates",
};

/**
 * Save payment to history
 */
export function savePaymentHistory(payment: PaymentHistory): void {
  try {
    const existing = getPaymentHistory();
    existing.unshift(payment); // Add to beginning
    // Keep only last 100
    const limited = existing.slice(0, 100);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(limited));
  } catch (err) {
    console.error("Failed to save payment history:", err);
  }
}

/**
 * Get payment history
 */
export function getPaymentHistory(): PaymentHistory[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.HISTORY);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error("Failed to load payment history:", err);
    return [];
  }
}

/**
 * Clear payment history
 */
export function clearPaymentHistory(): void {
  localStorage.removeItem(STORAGE_KEYS.HISTORY);
}

/**
 * Save scheduled payment
 */
export function saveScheduledPayment(payment: ScheduledPayment): void {
  try {
    const existing = getScheduledPayments();
    const index = existing.findIndex((p) => p.id === payment.id);
    
    if (index >= 0) {
      existing[index] = payment;
    } else {
      existing.push(payment);
    }
    
    localStorage.setItem(STORAGE_KEYS.SCHEDULED, JSON.stringify(existing));
  } catch (err) {
    console.error("Failed to save scheduled payment:", err);
  }
}

/**
 * Get scheduled payments
 */
export function getScheduledPayments(): ScheduledPayment[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SCHEDULED);
    return data ? JSON.parse(data) : [];
  } catch (err) {
    console.error("Failed to load scheduled payments:", err);
    return [];
  }
}

/**
 * Delete scheduled payment
 */
export function deleteScheduledPayment(id: string): void {
  try {
    const existing = getScheduledPayments();
    const filtered = existing.filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEYS.SCHEDULED, JSON.stringify(filtered));
  } catch (err) {
    console.error("Failed to delete scheduled payment:", err);
  }
}

/**
 * Save recipient template
 */
export function saveTemplate(name: string, recipients: PaymentRecipient[]): void {
  try {
    const templates = getTemplates();
    templates[name] = recipients;
    localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(templates));
  } catch (err) {
    console.error("Failed to save template:", err);
  }
}

/**
 * Get all templates
 */
export function getTemplates(): Record<string, PaymentRecipient[]> {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.TEMPLATES);
    return data ? JSON.parse(data) : {};
  } catch (err) {
    console.error("Failed to load templates:", err);
    return {};
  }
}

// ==========================================
// FORMATTING
// ==========================================

/**
 * Format USDC amount (bigint) to readable string
 */
export function formatUSDC(amount: bigint): string {
  return formatUnits(amount, 6);
}

/**
 * Format address for display
 */
export function formatAddress(address: Address): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
