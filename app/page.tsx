"use client";

import { useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { DESTS } from "@/lib/chains";
import {
  addressToBytes32,
  computeMaxFee,
  DEST_CALLER_ZERO,
  ERC20_ABI,
  HOOK_DATA,
  TOKEN_MESSENGER_V2_ABI,
} from "@/lib/cctp";

export default function Home() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [tab, setTab] = useState<"bridge" | "swap" | "payment" | "deploy">("bridge");
  const [destKey, setDestKey] = useState(DESTS[0].key);
  const [amountUsdc, setAmountUsdc] = useState("2.00");
  const [status, setStatus] = useState<string>("");

  const dest = useMemo(() => DESTS.find((d) => d.key === destKey)!, [destKey]);

  async function onBridge() {
    try {
      setStatus("");
      if (!isConnected || !address || !walletClient || !publicClient) throw new Error("Vui lòng connect ví.");
      const tokenMessenger = process.env.NEXT_PUBLIC_ARC_TOKEN_MESSENGER_V2 as `0x${string}`;
      const usdc = process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS as `0x${string}`;
      const minFinality = Number(process.env.NEXT_PUBLIC_MIN_FINALITY_THRESHOLD || "1000");

      // tính fee (bạn có thể nâng cấp: enforce min fee theo domain ở đây)
      const { amount, maxFee } = computeMaxFee(amountUsdc);

      // 1) approve nếu thiếu allowance
      const allowance = await publicClient.readContract({
        address: usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, tokenMessenger],
      });

      if (allowance < amount) {
        setStatus("Approving USDC...");
        const approveHash = await walletClient.writeContract({
          address: usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [tokenMessenger, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // 2) burn (Forwarding Service)
      setStatus("Submitting burn tx on ARC...");
      const burnHash = await walletClient.writeContract({
        address: tokenMessenger,
        abi: TOKEN_MESSENGER_V2_ABI,
        functionName: "depositForBurnWithHook",
        args: [
          amount,
          dest.domain,
          addressToBytes32(address),
          usdc,
          DEST_CALLER_ZERO,
          maxFee,
          minFinality,
          HOOK_DATA,
        ],
      });

      setStatus(`Done. Tx: ${burnHash}`);
    } catch (e: any) {
      setStatus(e?.message || "Failed");
    }
  }

  return (
    <main className="min-h-screen text-white">
      <div className="mx-auto max-w-5xl px-5 py-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold">ARC dApp</div>
            <div className="text-white/60">Swap • Payment • Deploy Contract • Bridge</div>
          </div>
          <ConnectButton />
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-4">
          {(["bridge","swap","payment","deploy"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={[
                "rounded-2xl border px-4 py-3 text-left transition",
                "border-white/10 bg-white/5 hover:bg-white/10",
                tab === k ? "ring-1 ring-white/30" : "",
              ].join(" ")}
            >
              <div className="font-medium capitalize">{k}</div>
              <div className="text-sm text-white/60">
                {k === "bridge" ? "Live" : "Coming soon"}
              </div>
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-6">
          {tab !== "bridge" ? (
            <div className="text-white/70">Coming soon.</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-lg font-semibold">Bridge (ARC → Testnets)</div>
                <div className="text-sm text-white/60">
                  Forwarding Service (no destination gas)
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="md:col-span-2">
                  <div className="text-sm text-white/70">Destination</div>
                  <select
                    value={destKey}
                    onChange={(e) => setDestKey(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 outline-none"
                  >
                    {DESTS.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.name} (domain {d.domain})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="text-sm text-white/70">Amount (USDC)</div>
                  <input
                    value={amountUsdc}
                    onChange={(e) => setAmountUsdc(e.target.value)}
                    placeholder="2.00"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 outline-none"
                  />
                </div>
              </div>

              <button
                onClick={onBridge}
                className="mt-5 w-full rounded-2xl bg-gradient-to-r from-emerald-300 via-sky-400 to-violet-400 px-5 py-3 font-semibold text-black"
              >
                Bridge now
              </button>

              {status && <div className="mt-4 text-sm text-white/80">{status}</div>}

              <div className="mt-4 text-xs text-white/50">
                Note: Reverse direction (17 testnet → ARC) sẽ mở sau (Coming soon).
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}