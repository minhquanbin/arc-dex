"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultWallets } from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { defineChain } from "viem";
import { createConfig } from "wagmi";

const arc = defineChain({
  id: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 12345),
  name: "ARC Testnet",
  nativeCurrency: { name: "ARC", symbol: "ARC", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.network"] },
  },
});

const { wallets } = getDefaultWallets({
  appName: "ARC Bridge",
  projectId: "REPLACE_WITH_WALLETCONNECT_PROJECT_ID",
});

const config = createConfig({
  chains: [arc],
  transports: { [arc.id]: http(arc.rpcUrls.default.http[0]) },
  wallets,
  ssr: true,
});

const qc = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}