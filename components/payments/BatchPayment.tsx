"use client";

import { useEffect, useRef, useState } from "react";
import {
  useAccount,
  useBalance,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { parseUnits, type Address } from "viem";
import {
  type PaymentRecipient,
  parseCSV,
  validateRecipients,
  calculatePaymentSummary,
  generateCSVTemplate,
  savePaymentHistory,
  formatUSDC,
  formatAddress,
  generateId,
  saveTemplate,
  getTemplates,
} from "@/lib/payments";

const ERC20_ABI = [
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
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const BATCH_PAYMENTS_ABI = [
  {
    type: "function",
    name: "batchTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

export default function BatchPayment() {
  const { address } = useAccount();
  const [recipients, setRecipients] = useState<PaymentRecipient[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentRecipientIndex, setCurrentRecipientIndex] = useState(0);
  
  // Manual entry state
  const [manualAddress, setManualAddress] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  
  // UI state
  const [activeTab, setActiveTab] = useState<"csv" | "manual">("csv");
  const [showSuccess, setShowSuccess] = useState(false);
  const [successTxHash, setSuccessTxHash] = useState("");
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // USDC contract address (from env)
  const USDC_ADDRESS = (process.env.NEXT_PUBLIC_ARC_USDC ||
    "0x3600000000000000000000000000000000000000") as Address;

  const BATCH_PAYMENTS_ADDRESS = (process.env.NEXT_PUBLIC_ARC_BATCH_PAYMENTS ||
    "0x0000000000000000000000000000000000000000") as Address;

  // Get USDC balance
  const { data: usdcBalance } = useBalance({
    address,
    token: USDC_ADDRESS,
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && BATCH_PAYMENTS_ADDRESS ? [address, BATCH_PAYMENTS_ADDRESS] : undefined,
    query: {
      enabled:
        Boolean(address) &&
        Boolean(BATCH_PAYMENTS_ADDRESS) &&
        BATCH_PAYMENTS_ADDRESS !==
          ("0x0000000000000000000000000000000000000000" as Address),
    },
  });

  // Write contract hook
  const { writeContract, data: txHash, isPending } = useWriteContract();

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    if (!isConfirmed) return;
    refetchAllowance();
  }, [isConfirmed, refetchAllowance]);

  useEffect(() => {
    if (!isConfirmed) return;
    refetchAllowance();
  }, [isConfirmed, refetchAllowance]);

  // ==========================================
  // CSV HANDLERS
  // ==========================================

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const { recipients: parsed, errors: parseErrors } = parseCSV(content);
      
      setRecipients(parsed);
      setErrors(parseErrors);
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const template = generateCSVTemplate();
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payment-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ==========================================
  // MANUAL ENTRY HANDLERS
  // ==========================================

  const handleAddRecipient = () => {
    if (!manualAddress || !manualAmount) {
      setErrors(["Address and amount are required"]);
      return;
    }

    const newRecipient: PaymentRecipient = {
      address: manualAddress as Address,
      amount: manualAmount,
      label: manualLabel || undefined,
      id: generateId(),
    };

    const updated = [...recipients, newRecipient];
    const validation = validateRecipients(updated);
    
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setRecipients(updated);
    setErrors([]);
    
    // Clear form
    setManualAddress("");
    setManualAmount("");
    setManualLabel("");
  };

  const handleRemoveRecipient = (id: string) => {
    setRecipients(recipients.filter((r) => r.id !== id));
  };

  const handleClearAll = () => {
    setRecipients([]);
    setErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // ==========================================
  // TEMPLATE HANDLERS
  // ==========================================

  const handleSaveTemplate = () => {
    const name = prompt("Enter template name:");
    if (!name) return;
    
    saveTemplate(name, recipients);
    alert(`Template "${name}" saved!`);
  };

  const handleLoadTemplate = () => {
    const templates = getTemplates();
    const names = Object.keys(templates);
    
    if (names.length === 0) {
      alert("No templates saved yet");
      return;
    }
    
    const name = prompt(`Available templates:\n${names.join("\n")}\n\nEnter name to load:`);
    if (!name || !templates[name]) return;
    
    setRecipients(templates[name]);
  };

  // ==========================================
  // PAYMENT EXECUTION
  // ==========================================

  const handleApprove = async () => {
    const summary = calculatePaymentSummary(recipients);

    if (
      BATCH_PAYMENTS_ADDRESS ===
      ("0x0000000000000000000000000000000000000000" as Address)
    ) {
      setErrors([
        "BatchPayments contract not configured. Set NEXT_PUBLIC_ARC_BATCH_PAYMENTS in .env.local",
      ]);
      return;
    }

    await writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [BATCH_PAYMENTS_ADDRESS, summary.totalAmount],
    });
  };

  const handleExecutePayment = async () => {
    if (recipients.length === 0) {
      setErrors(["No recipients to pay"]);
      return;
    }

    const summary = calculatePaymentSummary(recipients);
    if (summary.errors.length > 0) {
      setErrors(summary.errors);
      return;
    }

    if (
      BATCH_PAYMENTS_ADDRESS ===
      ("0x0000000000000000000000000000000000000000" as Address)
    ) {
      setErrors([
        "BatchPayments contract not configured. Set NEXT_PUBLIC_ARC_BATCH_PAYMENTS in .env.local",
      ]);
      return;
    }

    // Check balance
    if (usdcBalance && summary.totalAmount > usdcBalance.value) {
      setErrors([
        `Insufficient balance. Need ${formatUSDC(summary.totalAmount)} USDC`,
      ]);
      return;
    }

    const allowanceBigInt = (allowance as bigint | undefined) ?? 0n;
    if (allowanceBigInt < summary.totalAmount) {
      setErrors([
        `Approval required. Current allowance: ${formatUSDC(allowanceBigInt)} USDC`,
      ]);
      return;
    }

    setIsProcessing(true);
    setCurrentRecipientIndex(0);

    try {
      const recipientsAddrs = recipients.map((r) => r.address);
      const amounts = recipients.map((r) => parseUnits(r.amount, 6));

      await writeContract({
        address: BATCH_PAYMENTS_ADDRESS,
        abi: BATCH_PAYMENTS_ABI,
        functionName: "batchTransferFrom",
        args: [USDC_ADDRESS, recipientsAddrs, amounts],
      });

      // Save to history
      savePaymentHistory({
        id: generateId(),
        timestamp: Date.now(),
        type: "batch",
        recipients,
        totalAmount: formatUSDC(summary.totalAmount),
        txHash: txHash || "pending",
        status: "success",
      });

      setShowSuccess(true);
      setSuccessTxHash(txHash || "");

      setTimeout(() => {
        handleClearAll();
        setShowSuccess(false);
      }, 5000);
    } catch (err: any) {
      setErrors([`Payment failed: ${err.message}`]);
    } finally {
      setIsProcessing(false);
      setCurrentRecipientIndex(0);
    }
  };

  // ==========================================
  // RENDER
  // ==========================================

  const summary = recipients.length > 0 ? calculatePaymentSummary(recipients) : null;
  const isBatchPaymentsConfigured =
    BATCH_PAYMENTS_ADDRESS !==
    ("0x0000000000000000000000000000000000000000" as Address);

  return (
    <div className="space-y-6">
      {/* Success Message */}
      {showSuccess && (
        <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <div className="flex items-center gap-2">
            <div>
              <p className="font-medium text-green-400">Batch payment successful!</p>
              {successTxHash && (
                <p className="text-sm text-gray-400 mt-1">
                  Tx: {formatAddress(successTxHash as Address)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Input Method Tabs */}
      <div className="flex gap-4 border-b border-white/10">
        <button
          onClick={() => setActiveTab("csv")}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === "csv"
              ? "text-[#ff7582] border-b-2 border-[#ff7582]"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Upload CSV
        </button>
        <button
          onClick={() => setActiveTab("manual")}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === "manual"
              ? "text-[#ff7582] border-b-2 border-[#ff7582]"
              : "text-gray-400 hover:text-white"
          }`}
        >
          Manual Entry
        </button>
      </div>

      {/* CSV Upload Tab */}
      {activeTab === "csv" && (
        <div className="space-y-4">
          <div className="arc-card p-6 border-2 border-dashed border-white/20 hover:border-[#ff7582]/50 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              id="csv-upload"
            />
            <label
              htmlFor="csv-upload"
              className="flex flex-col items-center justify-center cursor-pointer"
            >
              <img src="/chain-icons/browser.svg" alt="Upload" className="h-12 w-12 mb-2" />
              <p className="text-lg font-medium">Drop CSV file or click to upload</p>
              <p className="text-sm text-gray-400 mt-2">
                Format: address, amount, label
              </p>
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleDownloadTemplate}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm"
            >
              Download Template
            </button>
            <button
              onClick={handleLoadTemplate}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm"
            >
              Load Template
            </button>
            {recipients.length > 0 && (
              <button
                onClick={handleSaveTemplate}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm"
              >
                Save as Template
              </button>
            )}
          </div>
        </div>
      )}

      {/* Manual Entry Tab */}
      {activeTab === "manual" && (
        <div className="space-y-4">
          <div className="arc-card-light p-6 grid gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Recipient Address</label>
              <input
                type="text"
                placeholder="0x..."
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                className="w-full px-4 py-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Amount (USDC)</label>
                <input
                  type="number"
                  placeholder="100.00"
                  step="0.01"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  className="w-full px-4 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Label (Optional)</label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={manualLabel}
                  onChange={(e) => setManualLabel(e.target.value)}
                  className="w-full px-4 py-2"
                />
              </div>
            </div>

            <button
              onClick={handleAddRecipient}
              className="w-full py-3 bg-gradient-to-r from-[#ff7582] to-[#725a7a] hover:opacity-90 rounded-lg font-medium transition-opacity"
            >
              ➕ Add Recipient
            </button>
          </div>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="font-medium text-red-400 mb-2">⚠️ Errors:</p>
          <ul className="space-y-1 text-sm">
            {errors.map((err, i) => (
              <li key={i} className="text-red-300">
                • {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recipients List */}
      {recipients.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Recipients ({recipients.length})</h3>
            <button
              onClick={handleClearAll}
              className="text-sm text-red-400 hover:text-red-300"
            >
              Clear All
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-2 pr-2">
            {recipients.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
              >
                <div className="flex-1">
                  <p className="font-medium font-mono text-sm">
                    {formatAddress(r.address)}
                  </p>
                  {r.label && (
                    <p className="text-xs text-gray-400 mt-1">{r.label}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-medium">{r.amount} USDC</p>
                  <button
                    onClick={() => handleRemoveRecipient(r.id!)}
                    className="text-red-400 hover:text-red-300 text-sm"
                    aria-label="Remove recipient"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary & Execute */}
      {summary && summary.totalRecipients > 0 && (
        <div className="space-y-4">
          <div className="arc-card p-6 bg-gradient-to-br from-[#ff7582]/10 to-[#725a7a]/10">
            <h3 className="text-lg font-medium mb-4">Payment Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Recipients:</span>
                <span className="font-medium">{summary.totalRecipients}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Amount:</span>
                <span className="font-medium">{formatUSDC(summary.totalAmount)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Your Balance:</span>
                <span className="font-medium">
                  {usdcBalance ? `${formatUSDC(usdcBalance.value)} USDC` : "..."}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Estimated Gas:</span>
                <span className="font-medium">~{summary.estimatedGas.toString()}</span>
              </div>
            </div>
          </div>          {!isBatchPaymentsConfigured && (
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-sm text-yellow-300">
                <strong>BatchPayments contract not configured.</strong> Deploy
                <code className="px-1">contracts/BatchPayments.sol</code> to ARC,
                then set <code className="px-1">NEXT_PUBLIC_ARC_BATCH_PAYMENTS</code>
                in <code className="px-1">arc-dex-v2/.env.local</code>.
              </p>
            </div>
          )}

          {((allowance as bigint | undefined) ?? 0n) < summary.totalAmount && (
            <button
              onClick={handleApprove}
              disabled={
                !isBatchPaymentsConfigured ||
                isPending ||
                isConfirming ||
                summary.errors.length > 0
              }
              className="w-full py-3 bg-white/10 hover:bg-gray-200/20 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending || isConfirming ? "Confirming..." : "Approve"}
            </button>
          )}

          <button
            onClick={handleExecutePayment}
            disabled={
              !isBatchPaymentsConfigured ||
              isProcessing ||
              isPending ||
              isConfirming ||
              summary.errors.length > 0 ||
              ((allowance as bigint | undefined) ?? 0n) < summary.totalAmount
            }
            className="w-full py-4 bg-gradient-to-r from-[#ff7582] to-[#725a7a] hover:opacity-90 rounded-lg font-medium text-lg transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing
              ? "Processing..."
              : isPending || isConfirming
              ? "Confirming..."
              : "Pay"}
          </button>
        </div>
      )}
    </div>
  );
}