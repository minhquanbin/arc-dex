"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { parseUnits, type Address } from "viem";
import { formatAddress, formatUSDC } from "@/lib/payments";

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

const INVOICE_MARKETPLACE_ABI = [
  {
    type: "function",
    name: "listInvoice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "invoiceId", type: "bytes32" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelListing",
    stateMutability: "nonpayable",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "buyInvoice",
    stateMutability: "nonpayable",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "listings",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [
      { name: "invoiceId", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "token", type: "address" },
      { name: "price", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint64" },
      { name: "soldAt", type: "uint64" },
      { name: "buyer", type: "address" },
    ],
  },
  {
    type: "function",
    name: "totalListingIds",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getListingIds",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
  {
    type: "event",
    name: "InvoiceListed",
    inputs: [
      { name: "invoiceId", type: "bytes32", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
] as const;

const INVOICE_REGISTRY_ABI = [
  {
    type: "function",
    name: "invoices",
    stateMutability: "view",
    inputs: [{ name: "invoiceId", type: "bytes32" }],
    outputs: [
      { name: "vendor", type: "address" },
      { name: "beneficiary", type: "address" },
      { name: "payer", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "dueDate", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "createdAt", type: "uint64" },
      { name: "paidAt", type: "uint64" },
      { name: "metadataHash", type: "bytes32" },
    ],
  },
] as const;

type ListingRow = {
  invoiceId: `0x${string}`;
  seller: Address;
  token: Address;
  price: bigint;
  status: number; // 0 None, 1 Active, 2 Cancelled, 3 Sold
  createdAt: bigint;
  soldAt: bigint;
  buyer: Address;
};

type InvoiceInfo = {
  status: number; // 0 None, 1 Created, 2 Cancelled, 3 Paid
  paidAt: bigint;
};

function listingStatusLabel(status: number): string {
  if (status === 1) return "ACTIVE";
  if (status === 2) return "CANCELLED";
  if (status === 3) return "SOLD";
  return "NONE";
}

function paymentStatusLabel(invoiceStatus: number): "UNPAID" | "PAID" | "UNKNOWN" {
  if (invoiceStatus === 1) return "UNPAID";
  if (invoiceStatus === 3) return "PAID";
  return "UNKNOWN";
}

// FIX #1: Xóa khai báo trùng lặp — giữ lại đúng 1 hàm paymentStatusIcon
function paymentStatusIcon(invoiceStatus: number): { src: string; alt: string } | null {
  if (invoiceStatus === 1) return { src: "/chain-icons/invoice_unpaid.svg", alt: "Unpaid" };
  if (invoiceStatus === 3) return { src: "/chain-icons/invoice_paid.svg", alt: "Paid" };
  return null;
}

export default function InvoiceMarketplaceTab() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const isBusy = isPending || isConfirming;

  const INVOICE_MARKETPLACE_ADDRESS = (process.env.NEXT_PUBLIC_ARC_INVOICE_MARKETPLACE ||
    "0x0000000000000000000000000000000000000000") as Address;

  const INVOICE_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_ARC_INVOICE_REGISTRY ||
    "0x0000000000000000000000000000000000000000") as Address;

  const USDC_ADDRESS = ((process.env.NEXT_PUBLIC_ARC_USDC || process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS) ||
    "0x3600000000000000000000000000000000000000") as Address;

  const isConfigured =
    INVOICE_MARKETPLACE_ADDRESS !== ("0x0000000000000000000000000000000000000000" as Address);

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, INVOICE_MARKETPLACE_ADDRESS] : undefined,
    query: { enabled: Boolean(address) && isConfigured },
  });
  const allowance = (allowanceData as bigint | undefined) ?? 0n;

  const [txStatus, setTxStatus] = useState("");
  const [lastError, setLastError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [listInvoiceId, setListInvoiceId] = useState("");
  const [listPrice, setListPrice] = useState("");

  const [items, setItems] = useState<ListingRow[]>([]);
  const [invoiceInfoById, setInvoiceInfoById] = useState<Record<string, InvoiceInfo>>({});

  const storageKey = useMemo(() => {
    const chainId = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 5042002);
    return `arc:invoice-marketplace:knownIds:${chainId}:${INVOICE_MARKETPLACE_ADDRESS.toLowerCase()}`;
  }, [INVOICE_MARKETPLACE_ADDRESS]);

  function getCachedIds(): string[] {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      return Array.isArray(parsed) ? Array.from(new Set(parsed.map((x) => String(x).toLowerCase()))) : [];
    } catch {
      return [];
    }
  }

  function mergeAndCacheIds(incoming: string[]) {
    const merged = Array.from(new Set([...getCachedIds(), ...incoming.map((x) => x.toLowerCase())]));
    try {
      localStorage.setItem(storageKey, JSON.stringify(merged));
    } catch {
      // ignore
    }
    return merged;
  }

  useEffect(() => {
    if (!isConfirmed) return;
    refetchAllowance();
  }, [isConfirmed, refetchAllowance]);

  async function refreshFromChain() {
    if (!publicClient || !isConfigured) return;
    setIsLoading(true);
    setLastError("");

    try {
      // 1) Try on-chain index first
      try {
        const total = (await publicClient.readContract({
          address: INVOICE_MARKETPLACE_ADDRESS,
          abi: INVOICE_MARKETPLACE_ABI,
          functionName: "totalListingIds",
          args: [],
        })) as unknown as bigint;

        const pageSize = 200n;
        const idsFromIndex: string[] = [];
        for (let offset = 0n; offset < total; offset += pageSize) {
          const page = (await publicClient.readContract({
            address: INVOICE_MARKETPLACE_ADDRESS,
            abi: INVOICE_MARKETPLACE_ABI,
            functionName: "getListingIds",
            args: [offset, pageSize],
          })) as unknown as readonly string[];
          for (const id of page) idsFromIndex.push(String(id).toLowerCase());
        }

        const allIds = mergeAndCacheIds(idsFromIndex);
        await loadDetails(allIds);
        return;
      } catch {
        // fallback to event scan
      }

      // 2) Fallback: scan InvoiceListed events in chunks from block 0
      const latest = await publicClient.getBlockNumber();
      const chunkSize = 50_000n;

      const eventDef = INVOICE_MARKETPLACE_ABI.find(
        (x) => (x as any).type === "event" && (x as any).name === "InvoiceListed"
      ) as any;

      const idsFromChain: string[] = [];
      for (let from = 0n; from <= latest; from += chunkSize) {
        const to = from + chunkSize - 1n > latest ? latest : from + chunkSize - 1n;
        try {
          const logs = await publicClient.getLogs({
            address: INVOICE_MARKETPLACE_ADDRESS,
            event: eventDef,
            fromBlock: from,
            toBlock: to,
          });
          for (const log of logs) {
            const invoiceId = (log as any).args?.invoiceId as string | undefined;
            if (invoiceId) idsFromChain.push(invoiceId.toLowerCase());
          }
        } catch {
          // skip failed chunk, continue
        }
      }

      const allIds = mergeAndCacheIds(idsFromChain);
      await loadDetails(allIds);
    } catch (e: any) {
      console.warn("[InvoiceMarketplaceTab] getLogs failed:", e);
      const cachedIds = getCachedIds();
      if (cachedIds.length > 0) await loadDetails(cachedIds);
      setLastError("Could not fetch latest listings from chain. Showing cached data.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDetails(ids: string[]) {
    if (!publicClient || !isConfigured || ids.length === 0) return;
    const next: ListingRow[] = [];

    for (const id of ids) {
      try {
        const row = (await publicClient.readContract({
          address: INVOICE_MARKETPLACE_ADDRESS,
          abi: INVOICE_MARKETPLACE_ABI,
          functionName: "listings",
          args: [id as `0x${string}`],
        })) as unknown as readonly [string, Address, Address, bigint, number, bigint, bigint, Address];

        const statusNum = Number(row[4]);
        if (statusNum === 0) continue;

        next.push({
          invoiceId: (row[0] as `0x${string}`) || (id as `0x${string}`),
          seller: row[1],
          token: row[2],
          price: row[3],
          status: statusNum,
          createdAt: row[5],
          soldAt: row[6],
          buyer: row[7],
        });
      } catch {
        // ignore invalid ids
      }
    }

    setItems(next.sort((a, b) => Number(b.createdAt - a.createdAt)));

    // Load invoice payment status for SOLD items
    if (
      publicClient &&
      INVOICE_REGISTRY_ADDRESS !== ("0x0000000000000000000000000000000000000000" as Address)
    ) {
      const sold = next.filter((x) => x.status === 3);
      const updates: Record<string, InvoiceInfo> = {};
      for (const l of sold) {
        const key = l.invoiceId.toLowerCase();
        try {
          const inv = (await publicClient.readContract({
            address: INVOICE_REGISTRY_ADDRESS,
            abi: INVOICE_REGISTRY_ABI,
            functionName: "invoices",
            args: [l.invoiceId],
          })) as unknown as readonly [
            Address, Address, Address, Address,
            bigint, bigint, number, bigint, bigint, `0x${string}`,
          ];
          updates[key] = { status: Number(inv[6]), paidAt: inv[8] };
        } catch {
          // ignore
        }
      }
      if (Object.keys(updates).length > 0) {
        setInvoiceInfoById((prev) => ({ ...prev, ...updates }));
      }
    }
  }

  useEffect(() => {
    if (!publicClient || !isConfigured) return;
    refreshFromChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, isConfigured, isConfirmed]);

  async function onListInvoice() {
    try {
      setLastError("");
      setTxStatus("");
      if (!isConnected || !address) throw new Error("Connect wallet first");
      if (!isConfigured) throw new Error("InvoiceMarketplace not configured (NEXT_PUBLIC_ARC_INVOICE_MARKETPLACE).");

      const id = listInvoiceId.trim();
      if (!id.startsWith("0x") || id.length !== 66) throw new Error("invoiceId must be 0x + 64 hex chars (bytes32).");
      if (!listPrice || Number(listPrice) <= 0) throw new Error("Price must be > 0");

      const price = parseUnits(listPrice, 6);
      setTxStatus("Listing invoice...");
      await writeContract({
        address: INVOICE_MARKETPLACE_ADDRESS,
        abi: INVOICE_MARKETPLACE_ABI,
        functionName: "listInvoice",
        args: [id as `0x${string}`, price],
      });

      mergeAndCacheIds([id]);
      setTxStatus("Submitted. Waiting confirmation...");
    } catch (e: any) {
      setLastError(e?.message || "List invoice failed");
      setTxStatus("");
    }
  }

  async function onApprove(required: bigint) {
    try {
      setLastError("");
      if (!isConnected || !address) throw new Error("Connect wallet first");
      if (!isConfigured) throw new Error("InvoiceMarketplace not configured");

      setTxStatus(`Approving ${formatUSDC(required)} USDC allowance...`);
      await writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [INVOICE_MARKETPLACE_ADDRESS, required],
      });
    } catch (e: any) {
      setLastError(e?.message || "Approve failed");
      setTxStatus("");
    }
  }

  async function onBuyInvoice(invoiceId: `0x${string}`) {
    try {
      setLastError("");
      if (!isConnected || !address) throw new Error("Connect wallet first");
      if (!isConfigured) throw new Error("InvoiceMarketplace not configured");

      setTxStatus("Buying invoice...");
      await writeContract({
        address: INVOICE_MARKETPLACE_ADDRESS,
        abi: INVOICE_MARKETPLACE_ABI,
        functionName: "buyInvoice",
        args: [invoiceId],
      });
    } catch (e: any) {
      setLastError(e?.message || "Buy invoice failed");
    } finally {
      setTxStatus("");
    }
  }

  async function onCancel(invoiceId: `0x${string}`) {
    try {
      setLastError("");
      if (!isConnected || !address) throw new Error("Connect wallet first");
      if (!isConfigured) throw new Error("InvoiceMarketplace not configured");

      setTxStatus("Cancelling listing...");
      await writeContract({
        address: INVOICE_MARKETPLACE_ADDRESS,
        abi: INVOICE_MARKETPLACE_ABI,
        functionName: "cancelListing",
        args: [invoiceId],
      });
    } catch (e: any) {
      setLastError(e?.message || "Cancel listing failed");
    } finally {
      setTxStatus("");
    }
  }

  const myLower = (address || "").toLowerCase();
  const activeListings = items.filter((x) => x.status === 1);
  // FIX #2: Guard bằng address trước khi filter, tránh lọc sai khi wallet chưa connect
  const myListings = address ? items.filter((x) => x.seller.toLowerCase() === myLower && x.status !== 0) : [];
  const myPurchases = address ? items.filter((x) => x.buyer.toLowerCase() === myLower && x.status === 3) : [];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <img src="/chain-icons/invoice.svg" alt="Marketplace" className="h-8 w-8" />
          <h1 className="text-3xl font-bold">Invoice Marketplace</h1>
        </div>
        <p className="text-sm text-gray-600">
          List invoices at a discount and let buyers purchase the right to receive the future payment.
        </p>
      </div>

      {!isConfigured && (
        <div className="rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
          <div className="text-sm text-orange-800 font-semibold">Missing configuration</div>
          <div className="mt-1 text-sm text-orange-700">
            Set <code className="px-1 py-0.5 bg-white rounded">NEXT_PUBLIC_ARC_INVOICE_MARKETPLACE</code> to the deployed
            marketplace contract address.
          </div>
        </div>
      )}

      {/* List an invoice */}
      <div className="arc-card-light p-5 space-y-4 border-2 border-[#ff7582]/40 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-gray-900">List an invoice</h2>
          <button
            onClick={refreshFromChain}
            disabled={!isConfigured || !publicClient || isLoading}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-60"
          >
            {isLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">Invoice ID (bytes32)</label>
            <input
              value={listInvoiceId}
              onChange={(e) => setListInvoiceId(e.target.value)}
              placeholder="0x..."
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-700">Price (USDC)</label>
            <input
              value={listPrice}
              onChange={(e) => setListPrice(e.target.value)}
              placeholder="850.00"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>

        <button
          onClick={onListInvoice}
          disabled={!isConfigured || isBusy}
          className="rounded-xl bg-[#ff7582] px-4 py-2 text-sm font-semibold text-white shadow hover:bg-[#ff5f70] disabled:opacity-60"
        >
          {isBusy ? "Processing..." : "List invoice"}
        </button>

        {txHash && (
          <div className="text-xs text-gray-600">
            Tx: <code className="px-1 py-0.5 bg-white rounded">{txHash}</code>
          </div>
        )}
      </div>

      {/* All active listings */}
      <div className="arc-card-light p-5 space-y-4 border-2 border-gray-200 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Active listings</h2>
          <div className="text-xs text-gray-500">
            {isLoading ? "Loading..." : `${activeListings.length} items`}
          </div>
        </div>

        {isLoading ? (
          <div className="py-6 text-center text-sm text-gray-500">Fetching listings from chain...</div>
        ) : activeListings.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-600">
            No active listings yet. Click <span className="font-semibold">Refresh</span> to fetch from chain.
          </div>
        ) : (
          <div className="space-y-3">
            {activeListings.map((l) => {
              const isSeller = isConnected && l.seller.toLowerCase() === myLower;
              const needsApproval = allowance < l.price;
              return (
                <div key={l.invoiceId} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-gray-500">Invoice ID</div>
                      <div className="font-mono text-xs break-all">{l.invoiceId}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isSeller && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#ff7582]/10 text-[#ff7582] border border-[#ff7582]/30">
                          Your listing
                        </span>
                      )}
                      <div className="text-xs font-semibold px-2 py-1 rounded-full border border-gray-200 bg-gray-50">
                        {listingStatusLabel(l.status)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-gray-500">Seller</div>
                      <div className="font-semibold">{formatAddress(l.seller)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Price</div>
                      <div className="font-semibold text-[#725a7a]">{formatUSDC(l.price)} USDC</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Token</div>
                      <div className="font-semibold">{formatAddress(l.token)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Listed at</div>
                      <div className="font-semibold">
                        {l.createdAt > 0n
                          ? new Date(Number(l.createdAt) * 1000).toISOString().slice(0, 10)
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-[11px] text-gray-500">
                      Allowance: <span className="font-mono">{formatUSDC(allowance)} USDC</span>
                      {!isSeller && (needsApproval ? " (needs approval)" : " ✓ ok")}
                    </div>
                    <div className="flex items-center gap-2">
                      {isSeller ? (
                        <button
                          onClick={() => onCancel(l.invoiceId)}
                          disabled={isBusy}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60"
                        >
                          Cancel listing
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => onApprove(l.price)}
                            disabled={!isConnected || !needsApproval || isBusy}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60"
                            title={needsApproval ? `Approve ${formatUSDC(l.price)} USDC` : "Allowance sufficient"}
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => onBuyInvoice(l.invoiceId)}
                            disabled={!isConnected || needsApproval || isBusy}
                            className="rounded-lg bg-[#725a7a] px-3 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-60"
                            title={needsApproval ? "Approve USDC first" : "Buy this invoice"}
                          >
                            Buy
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* My listings history */}
      {myListings.length > 0 && (
        <div className="arc-card-light p-5 space-y-4 border-2 border-gray-200 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">My listings</h2>
            <div className="text-xs text-gray-500">{myListings.length} items</div>
          </div>
          <div className="space-y-3">
            {myListings.map((l) => (
              <div key={l.invoiceId} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-gray-500">Invoice ID</div>
                    <div className="font-mono text-xs break-all">{l.invoiceId}</div>
                  </div>
                  <div className={`text-xs font-semibold px-2 py-1 rounded-full border ${
                    l.status === 1 ? "border-green-200 bg-green-50 text-green-700" :
                    l.status === 3 ? "border-blue-200 bg-blue-50 text-blue-700" :
                    "border-gray-200 bg-gray-50 text-gray-600"
                  }`}>
                    {listingStatusLabel(l.status)}
                  </div>
                </div>
                <div className="mt-3 grid md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Price</div>
                    <div className="font-semibold">{formatUSDC(l.price)} USDC</div>
                  </div>
                  {l.status === 3 && l.buyer && l.buyer !== "0x0000000000000000000000000000000000000000" && (
                    <div>
                      <div className="text-xs text-gray-500">Sold to</div>
                      <div className="font-semibold">{formatAddress(l.buyer)}</div>
                    </div>
                  )}
                  {l.soldAt > 0n && (
                    <div>
                      <div className="text-xs text-gray-500">Sold at</div>
                      <div className="font-semibold">
                        {new Date(Number(l.soldAt) * 1000).toISOString().slice(0, 10)}
                      </div>
                    </div>
                  )}
                  {invoiceInfoById[l.invoiceId.toLowerCase()]?.paidAt > 0n && (
                    <div>
                      <div className="text-xs text-gray-500">Paid at</div>
                      <div className="font-semibold">
                        {new Date(Number(invoiceInfoById[l.invoiceId.toLowerCase()]!.paidAt) * 1000)
                          .toISOString()
                          .slice(0, 10)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My purchases history */}
      {myPurchases.length > 0 && (
        <div className="arc-card-light p-5 space-y-4 border-2 border-gray-200 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">My purchases</h2>
            <div className="text-xs text-gray-500">{myPurchases.length} items</div>
          </div>
          <div className="space-y-3">
            {myPurchases.map((l) => (
              <div key={l.invoiceId} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-gray-500">Invoice ID</div>
                    <div className="font-mono text-xs break-all">{l.invoiceId}</div>
                  </div>
                  {/* FIX #3: Xóa dấu ">" thừa xuất hiện sau thẻ </div> đóng trong JSX */}
                  {(() => {
                    const inv = invoiceInfoById[l.invoiceId.toLowerCase()];
                    const icon = inv ? paymentStatusIcon(inv.status) : null;
                    const label = inv ? paymentStatusLabel(inv.status) : "UNKNOWN";
                    const klass =
                      label === "PAID"
                        ? "border-green-200 bg-green-50 text-green-700"
                        : label === "UNPAID"
                          ? "border-orange-200 bg-orange-50 text-orange-700"
                          : "border-gray-200 bg-gray-50 text-gray-600";
                    return (
                      <div className={`flex items-center gap-2 text-xs font-semibold px-2 py-1 rounded-full border ${klass}`}>
                        {icon && <img src={icon.src} alt={icon.alt} className="h-4 w-4" />}
                        <span>{label}</span>
                      </div>
                    );
                  })()}
                </div>

                <div className="mt-3 grid md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Paid (price)</div>
                    <div className="font-semibold">{formatUSDC(l.price)} USDC</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Seller</div>
                    <div className="font-semibold">{formatAddress(l.seller)}</div>
                  </div>
                  {l.soldAt > 0n && (
                    <div>
                      <div className="text-xs text-gray-500">Bought at</div>
                      <div className="font-semibold">
                        {new Date(Number(l.soldAt) * 1000).toISOString().slice(0, 10)}
                      </div>
                    </div>
                  )}
                  {invoiceInfoById[l.invoiceId.toLowerCase()]?.paidAt > 0n && (
                    <div>
                      <div className="text-xs text-gray-500">Paid at</div>
                      <div className="font-semibold">
                        {new Date(Number(invoiceInfoById[l.invoiceId.toLowerCase()]!.paidAt) * 1000)
                          .toISOString()
                          .slice(0, 10)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(lastError || txStatus || isConfirmed) && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm space-y-1">
          {lastError && <div className="text-red-600">{lastError}</div>}
          {txStatus && <div className="text-gray-700">{txStatus}</div>}
          {isConfirmed && <div className="text-green-700">Confirmed.</div>}
        </div>
      )}
    </div>
  );
}