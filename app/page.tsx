"use client";

import { useId, useState, useEffect } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import BridgeTab from "@/components/tabs/BridgeTab";
import IssuanceTab from "@/components/tabs/IssuanceTab";
import PaymentsTab from "@/components/tabs/PaymentsTab";
import InvoicesTab from "@/components/tabs/InvoicesTab";

type TabType = "swap" | "bridge" | "invoices" | "payment" | "issuance";


function ArcLogoIcon({ className }: { className?: string }) {
  const gid0 = useId();
  const gid1 = useId();

  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="ARC"
      role="img"
    >
      <rect width="32" height="32" rx="4" fill={`url(#${gid0})`} />
      <path
        d="M15.9993 8C18.2886 8 20.3236 9.98314 21.7298 13.5848C22.4611 15.4577 22.999 17.6834 23.318 20.1045C23.3467 20.3204 23.3708 20.5404 23.396 20.7594C23.4042 20.7727 23.4088 20.7855 23.4073 20.7958C23.4073 20.7958 23.5944 21.9661 23.6344 23.9995H23.6134C23.3355 23.7713 20.0579 21.1963 14.6249 21.942C14.707 21.0225 14.8198 20.1281 14.9654 19.2706C14.9731 19.227 14.9813 19.1845 14.989 19.1409C17.1199 19.0768 18.9851 19.324 20.4154 19.6486C20.4102 19.6147 20.4056 19.5799 20.4 19.546C20.1061 17.7152 19.6723 16.0392 19.1128 14.6069C18.1984 12.2648 17.005 10.8098 15.9993 10.8098C14.9937 10.8098 13.8003 12.2653 12.8859 14.6069C12.6643 15.1736 12.4628 15.7777 12.2823 16.4146C12.0284 17.3075 11.8151 18.2649 11.6443 19.2706C11.392 20.7563 11.2346 22.3492 11.1766 24H8.36523C8.49498 20.083 9.15911 16.4274 10.2689 13.5848C11.6751 9.98314 13.7105 8 15.9993 8Z"
        fill={`url(#${gid1})`}
      />
      <defs>
        <linearGradient id={gid0} x1="16" y1="0" x2="16" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0.475962" stopColor="#021431" />
          <stop offset="1" stopColor="#20456B" />
        </linearGradient>
        <linearGradient id={gid1} x1="14.5524" y1="8" x2="18.1727" y2="36.9107" gradientUnits="userSpaceOnUse">
          <stop offset="0.288462" stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function UsdcIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="48"
      height="48"
      fill="none"
      viewBox="0 0 120 120"
      className={className}
      aria-label="USDC"
      role="img"
      focusable="false"
    >
      <path
        fill="#0B53BF"
        d="M60 120c33.137 0 60-26.863 60-60S93.137 0 60 0 0 26.863 0 60s26.863 60 60 60"
      ></path>
      <path
        fill="#fff"
        d="M70.8 16.313v7.725C86.211 28.688 97.498 43.013 97.498 60s-11.287 31.313-26.7 35.963v7.725C90.45 98.888 105 81.15 105 60s-14.55-38.887-34.2-43.687M22.499 60c0-16.987 11.287-31.312 26.7-35.962v-7.725c-19.65 4.8-34.2 22.537-34.2 43.687s14.55 38.888 34.2 43.688v-7.725C33.786 91.35 22.499 76.988 22.499 60"
      ></path>
      <path
        fill="#fff"
        d="M76.124 68.363c0-15.338-24.037-9.038-24.037-17.513 0-3.037 2.437-4.987 7.087-4.987 5.55 0 7.463 2.7 8.063 6.337h7.65c-.683-6.826-4.6-11.137-11.138-12.42v-6.03h-7.5v5.814c-7.161.912-11.662 5.083-11.662 11.286 0 15.413 24.075 9.638 24.075 17.963 0 3.15-3.038 5.25-8.176 5.25-6.712 0-8.924-2.963-9.75-7.05h-7.462c.483 7.477 5.094 12.157 12.975 13.324v5.913h7.5v-5.834c7.692-.994 12.375-5.468 12.375-12.053"
      ></path>
    </svg>
  );
}

export default function Home() {
  const { address, isConnected, chain } = useAccount();
  const [tab, setTab] = useState<TabType>("bridge");

  const expectedChainId = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 5042002);
  const isWrongNetwork = isConnected && chain?.id !== expectedChainId;

  async function switchToARC() {
    try {
      if (!window.ethereum) return;

      const chainIdHex = `0x${expectedChainId.toString(16)}`;

      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: chainIdHex,
                chainName: "ARC Testnet",
                nativeCurrency: {
                  name: "USDC",
                  symbol: "USDC",
                  decimals: 6,
                },
                rpcUrls: [process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.network"],
                blockExplorerUrls: ["https://testnet.arcscan.app"],
              },
            ],
          });
        } else {
          throw switchError;
        }
      }
    } catch (error: any) {
      console.error("Failed to switch network:", error);
    }
  }

  return (
    <main className="arc-app min-h-screen">
      <div className="container mx-auto max-w-6xl px-4 py-6">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ArcLogoIcon className="h-10 w-10" />
            <h1 className="bg-gradient-to-r from-[#ff7582] to-[#725a7a] bg-clip-text text-4xl font-bold text-transparent">
              Arc [testnet]
            </h1>
          </div>
          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
              const ready = mounted;
              const connected = ready && account && chain;

              if (!ready) return null;

              if (!connected) {
                return (
                  <button
                    onClick={openConnectModal}
                    className="rounded-xl bg-[#ff7582] px-4 py-2 text-sm font-semibold text-white shadow hover:bg-[#ff5f70]"
                    type="button"
                  >
                    Connect Wallet
                  </button>
                );
              }

              return (
                <div className="flex items-center gap-2">
                  <button
                    onClick={openChainModal}
                    type="button"
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50"
                  >
                    {chain?.name}
                  </button>

                  <button
                    onClick={openAccountModal}
                    type="button"
                    className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50"
                  >
                    <span className="flex items-center gap-1">
                      <span>
                        {(account?.displayBalance || "")
                          .replace(/\s*USDC\b/gi, "")
                          .trim()}
                      </span>
                      <UsdcIcon className="h-4 w-4" />
                    </span>
                    <span className="text-gray-400">|</span>
                    <span>{account?.displayName}</span>
                  </button>
                </div>
              );
            }}
          </ConnectButton.Custom>
        </div>

        {/* Wrong Network Banner */}
        {isWrongNetwork && (
          <div className="mb-6 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
            <div className="flex items-start gap-3">
              <div className="text-2xl">⚠️</div>
              <div className="flex-1">
                <div className="font-semibold text-orange-900">Wrong network</div>
                <div className="mt-1 text-sm text-orange-700">
                  Please switch to ARC Testnet (Chain ID: {expectedChainId})
                </div>
                <button
                  onClick={switchToARC}
                  className="mt-3 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
                >
                  Switch to ARC Testnet
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Card */}
        <div
          className={
            tab === "issuance" || tab === "bridge"
              ? "rounded-2xl bg-transparent shadow-none"
              : "overflow-hidden rounded-2xl bg-white shadow-xl"
          }
        >
          {/* Tabs */}
          <div className="rounded-2xl bg-white/80 backdrop-blur shadow-xl p-2">            <div className="flex gap-2">
              {(["bridge", "issuance", "payment", "invoices"] as TabType[]).map((t) => {
                const enabled = t === "bridge" || t === "issuance" || t === "payment" || t === "invoices";
                const active = tab === t;;


                const base = "flex-1 px-6 py-4 text-lg font-semibold transition-all rounded-xl";

                const stateClass = active
                  ? "bg-gradient-to-r from-[#ff7582] to-[#725a7a] text-white shadow"
                  : enabled
                  ? "bg-white text-gray-800 hover:bg-gray-50"
                  : "cursor-not-allowed bg-gray-100 text-gray-400";

                return (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    disabled={!enabled}
                    className={[base, stateClass].join(" ")}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                    {!enabled && <span className="ml-2 text-xs">(Soon)</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className={tab === "issuance" || tab === "bridge" ? "pt-6" : "p-5"}>
            {isConnected ? (
              <>
                {tab === "bridge" && <BridgeTab />}
                {tab === "issuance" && <IssuanceTab />}
                {tab === "payment" && <PaymentsTab />}
                {tab === "invoices" && <InvoicesTab />}
                {tab !== "bridge" && tab !== "issuance" && tab !== "payment" && tab !== "invoices" && (
                  <div className="py-12 text-center">

                    <div className="mb-4 text-4xl">🚧</div>
                    <p className="text-gray-600">This feature is coming soon!</p>
                  </div>
                )}
              </>
            ) : (
              <div className="py-12 text-center">
                
                <p className="text-gray-600">Connect your wallet to start</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
            <span>Powered by 1992evm</span>
            <a
              href="https://x.com/1992evm"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center"
              aria-label="1992evm on X"
              title="1992evm on X"
            >
              <img src="/chain-icons/logoX.svg" alt="X" className="h-4 w-4" />
            </a>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Donate: 0xA87Bd559fd6F2646225AcE941bA6648Ec1BAA9AF
          </div>
          <div className="mt-1 text-[11px] text-gray-400">
            Chain logos are sourced from Chainlink Docs and Codex Docs.
          </div>
        </div>
      </div>

      <style jsx global>{`
        :root {
          --arc-c1: #ff7582;
          --arc-c2: #725a7a;
          --arc-c3: #725a7a;
        }

        .arc-app {
          font-family: "Space Grotesk", Arial, sans-serif;
          background: radial-gradient(900px 500px at 15% 10%, rgba(255, 117, 130, 0.22), transparent 60%),
            radial-gradient(800px 420px at 85% 20%, rgba(114, 90, 122, 0.22), transparent 60%),
            radial-gradient(900px 520px at 55% 95%, rgba(114, 90, 122, 0.18), transparent 60%),
            linear-gradient(
              135deg,
              rgba(255, 255, 255, 1) 0%,
              rgba(255, 245, 247, 1) 45%,
              rgba(246, 241, 248, 1) 100%
            );
        }

        @font-face {
          font-family: "Space Grotesk";
          src: url("/fonts/SpaceGrotesk-VariableFont_wght.woff2") format("woff2");
          font-weight: 300 700;
          font-style: normal;
          font-display: swap;
        }
      `}</style>
    </main>
  );
}