"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { parseUnits, formatUnits } from "viem";

const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
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

type SavedToken = {
  contractAddress: `0x${string}`;
  name?: string;
  symbol?: string;
  decimals?: number;
  deployTx?: string;
  timestamp?: string;
};

type LiquidityItem = {
  ts: number;
  token: `0x${string}`;
  pairToken: `0x${string}`;
  amountToken: string;
  amountPairToken: string;
  txHash: `0x${string}`;
};

const DEX_ROUTER_ABI = [
  {
    type: "function",
    name: "addLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "amountADesired", type: "uint256" },
      { name: "amountBDesired", type: "uint256" },
      { name: "amountAMin", type: "uint256" },
      { name: "amountBMin", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "amountA", type: "uint256" },
      { name: "amountB", type: "uint256" },
      { name: "liquidity", type: "uint256" },
    ],
  },
] as const;

function isAddress(v: string): v is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

export default function LiquidityTab() {
  const { address, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const expectedChainId = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 5042002);
  const isWrongNetwork = isConnected && chain?.id !== expectedChainId;

  const routerAddress = process.env.NEXT_PUBLIC_DEX_ROUTER as `0x${string}` | undefined;
  const defaultPairToken = ((process.env.NEXT_PUBLIC_ARC_USDC ||
    process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS) ||
    "0x3600000000000000000000000000000000000000") as `0x${string}`;

  const [savedTokens, setSavedTokens] = useState<SavedToken[]>([]);
  const [history, setHistory] = useState<LiquidityItem[]>([]);

  const [tokenAddress, setTokenAddress] = useState<string>("");
  const [pairTokenAddress, setPairTokenAddress] = useState<string>(defaultPairToken);
  const [amountToken, setAmountToken] = useState<string>("");
  const [amountPair, setAmountPair] = useState<string>("");
  const [slippagePct, setSlippagePct] = useState<string>("1");

  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("arc:savedStablecoins");
      const parsed = raw ? (JSON.parse(raw) as SavedToken[]) : [];
      setSavedTokens(Array.isArray(parsed) ? parsed : []);

      const hRaw = localStorage.getItem("arc:liquidityHistory");
      const hParsed = hRaw ? (JSON.parse(hRaw) as LiquidityItem[]) : [];
      setHistory(Array.isArray(hParsed) ? hParsed : []);

      const lastSelected = localStorage.getItem("arc:selectedStablecoin") || "";
      if (lastSelected && !tokenAddress) setTokenAddress(lastSelected);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("arc:liquidityHistory", JSON.stringify(history));
    } catch {
      // ignore
    }
  }, [history]);

  const selectedToken = useMemo(() => {
    if (!isAddress(tokenAddress)) return null;
    return (
      savedTokens.find((t) => t.contractAddress?.toLowerCase() === tokenAddress.toLowerCase()) || null
    );
  }, [savedTokens, tokenAddress]);

  const gradientButtonClass = (disabled: boolean, extra: string = "") =>
    [
      extra,
      "rounded-xl font-semibold text-white shadow-lg transition-all",
      disabled
        ? "cursor-not-allowed bg-gray-300"
        : "bg-gradient-to-r from-[#ff7582] to-[#725a7a] hover:from-[#ff5f70] hover:to-[#664f6e] active:scale-[0.98]",
    ]
      .filter(Boolean)
      .join(" ");

  async function readDecimals(addr: `0x${string}`): Promise<number> {
    const d = (await publicClient!.readContract({
      address: addr,
      abi: ERC20_ABI,
      functionName: "decimals",
    })) as number;
    return Number(d);
  }

  async function readSymbol(addr: `0x${string}`): Promise<string> {
    try {
      const s = (await publicClient!.readContract({
        address: addr,
        abi: ERC20_ABI,
        functionName: "symbol",
      })) as string;
      return s;
    } catch {
      return addr.slice(0, 6) + "…" + addr.slice(-4);
    }
  }

  async function approveIfNeeded(token: `0x${string}`, spender: `0x${string}`, amount: bigint) {
    const allowance = (await publicClient!.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [address as `0x${string}`, spender],
    })) as bigint;

    if (allowance >= amount) return;

    const hash = await walletClient!.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
    });

    setStatus(`Approve sent: ${hash}`);
    await publicClient!.waitForTransactionReceipt({ hash });
  }

  async function onAddLiquidity() {
    try {
      setStatus("");
      setLoading(true);

      if (!routerAddress) {
        throw new Error("Missing NEXT_PUBLIC_DEX_ROUTER in .env.local");
      }

      if (!isConnected || !address || !walletClient || !publicClient) {
        throw new Error("Please connect your wallet first");
      }

      if (isWrongNetwork) {
        throw new Error(`Please switch to ARC Testnet (Chain ID: ${expectedChainId})`);
      }

      if (!isAddress(tokenAddress)) throw new Error("Token address is invalid");
      if (!isAddress(pairTokenAddress)) throw new Error("Pair token address is invalid");
      if (!amountToken || Number(amountToken) <= 0) throw new Error("Enter token amount");
      if (!amountPair || Number(amountPair) <= 0) throw new Error("Enter pair token amount");

      const slip = Number(slippagePct);
      if (Number.isNaN(slip) || slip < 0 || slip > 50) {
        throw new Error("Slippage must be between 0-50%.");
      }

      setStatus("Reading token decimals...");
      const [decA, decB] = await Promise.all([readDecimals(tokenAddress), readDecimals(pairTokenAddress)]);

      const amtA = parseUnits(amountToken, decA);
      const amtB = parseUnits(amountPair, decB);

      const minA = (amtA * BigInt(Math.floor((100 - slip) * 100))) / 10000n;
      const minB = (amtB * BigInt(Math.floor((100 - slip) * 100))) / 10000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

      setStatus("Approving tokens (if needed)...");
      await approveIfNeeded(tokenAddress, routerAddress, amtA);
      await approveIfNeeded(pairTokenAddress, routerAddress, amtB);

      setStatus("Submitting addLiquidity transaction...");
      const txHash = await walletClient.writeContract({
        address: routerAddress,
        abi: DEX_ROUTER_ABI,
        functionName: "addLiquidity",
        args: [tokenAddress, pairTokenAddress, amtA, amtB, minA, minB, address, deadline],
      });

      setStatus(`Transaction sent: ${txHash}`);
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setHistory((prev) => [
        {
          ts: Date.now(),
          token: tokenAddress,
          pairToken: pairTokenAddress,
          amountToken,
          amountPairToken: amountPair,
          txHash,
        },
        ...prev,
      ]);

      setStatus("✅ Liquidity added");
    } catch (e: any) {
      setStatus(e?.shortMessage || e?.message || "Failed to add liquidity");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {!routerAddress && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
          Add Liquidity needs a DEX router address. Set <span className="font-mono">NEXT_PUBLIC_DEX_ROUTER</span>{" "}
          in <span className="font-mono">.env.local</span>.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left card: Add Liquidity */}
        <div className="rounded-2xl bg-white/80 p-6 shadow-xl backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Add liquidity</h2>
            <div className="text-xs text-gray-500">UniswapV2-style router</div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">Token</label>
              <select
                value={tokenAddress}
                onChange={(e) => {
                  setTokenAddress(e.target.value);
                  try {
                    localStorage.setItem("arc:selectedStablecoin", e.target.value);
                  } catch {
                    // ignore
                  }
                }}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm"
              >
                <option value="">Select token...</option>
                {savedTokens.map((t) => (
                  <option key={t.contractAddress} value={t.contractAddress}>
                    {(t.symbol || "TOKEN").toUpperCase()} — {t.contractAddress.slice(0, 6)}…{t.contractAddress.slice(-4)}
                  </option>
                ))}
              </select>
              {tokenAddress && !isAddress(tokenAddress) && (
                <div className="mt-1 text-xs text-red-600">Invalid token address</div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700">Token amount</label>
                <input
                  value={amountToken}
                  onChange={(e) => setAmountToken(e.target.value)}
                  placeholder="0.0"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700">Pair token amount</label>
                <input
                  value={amountPair}
                  onChange={(e) => setAmountPair(e.target.value)}
                  placeholder="0.0"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-700">Pair token address</label>
              <input
                value={pairTokenAddress}
                onChange={(e) => setPairTokenAddress(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm"
              />
              {pairTokenAddress && !isAddress(pairTokenAddress) && (
                <div className="mt-1 text-xs text-red-600">Invalid pair token address</div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700">Slippage (%)</label>
                <input
                  value={slippagePct}
                  onChange={(e) => setSlippagePct(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={onAddLiquidity}
                  disabled={loading || !routerAddress || !isConnected || isWrongNetwork}
                  className={gradientButtonClass(
                    loading || !routerAddress || !isConnected || isWrongNetwork,
                    "w-full px-4 py-3 text-sm"
                  )}
                >
                  {loading ? "Adding..." : "Add liquidity"}
                </button>
              </div>
            </div>

            {selectedToken && isAddress(pairTokenAddress) && publicClient && (
              <LiquidityHint token={selectedToken.contractAddress} pairToken={pairTokenAddress} />
            )}

            {!!status && (
              <pre className="whitespace-pre-wrap rounded-xl bg-gray-50 p-4 text-xs text-gray-700">
                {status}
              </pre>
            )}
          </div>
        </div>

        {/* Right card: List */}
        <div className="rounded-2xl bg-white/80 p-6 shadow-xl backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Tokens with liquidity</h2>
            <div className="text-xs text-gray-500">Saved locally</div>
          </div>

          {history.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
              No liquidity added yet.
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((h) => (
                <div key={h.ts} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900">
                        {h.token.slice(0, 6)}…{h.token.slice(-4)} / {h.pairToken.slice(0, 6)}…{h.pairToken.slice(-4)}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        {new Date(h.ts).toLocaleString()} — {h.amountToken} + {h.amountPairToken}
                      </div>
                    </div>
                    <div className="text-xs font-mono text-gray-500">{h.txHash.slice(0, 10)}…</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LiquidityHint({ token, pairToken }: { token: `0x${string}`; pairToken: `0x${string}` }) {
  const publicClient = usePublicClient();
  const [tokenSymbol, setTokenSymbol] = useState<string>("");
  const [pairSymbol, setPairSymbol] = useState<string>("");
  const [decA, setDecA] = useState<number>(18);
  const [decB, setDecB] = useState<number>(6);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const [sA, sB, dA, dB] = await Promise.all([
          publicClient!.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
          publicClient!.readContract({
            address: pairToken,
            abi: ERC20_ABI,
            functionName: "symbol",
          }) as Promise<string>,
          publicClient!.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
          publicClient!.readContract({
            address: pairToken,
            abi: ERC20_ABI,
            functionName: "decimals",
          }) as Promise<number>,
        ]);

        if (cancelled) return;
        setTokenSymbol(sA);
        setPairSymbol(sB);
        setDecA(Number(dA));
        setDecB(Number(dB));
      } catch {
        // ignore
      }
    }

    if (publicClient) run();
    return () => {
      cancelled = true;
    };
  }, [publicClient, token, pairToken]);

  const preview = useMemo(() => {
    const a = formatUnits(10n ** BigInt(decA), decA);
    const b = formatUnits(10n ** BigInt(decB), decB);
    return { a, b };
  }, [decA, decB]);

  if (!tokenSymbol || !pairSymbol) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-700">
      Pair: <span className="font-semibold">{tokenSymbol}</span> / <span className="font-semibold">{pairSymbol}</span>
      <div className="mt-1 text-gray-500">
        Decimals: {tokenSymbol}={decA}, {pairSymbol}={decB} (preview 1 unit: {preview.a} / {preview.b})
      </div>
    </div>
  );
}