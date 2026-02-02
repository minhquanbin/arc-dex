"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import { defineChain } from "viem";

const arc = defineChain({
  id: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 5042002),
  name: "ARC Testnet",
  nativeCurrency: { 
    name: "USDC", 
    symbol: "USDC", 
    decimals: 6 
  },
  rpcUrls: {
    default: { 
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.network"] 
    },
  },
  blockExplorers: {
    default: { 
      name: "ARC Explorer", 
      url: "https://testnet.arcscan.app" 
    },
  },
  testnet: true,
});

const config = createConfig({
  chains: [arc],
  transports: { 
    [arc.id]: http(arc.rpcUrls.default.http[0]) 
  },
  ssr: true,
});

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}