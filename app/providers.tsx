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
    decimals: 6,
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "ARC Explorer",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});

const ethSepolia = defineChain({
  id: Number(process.env.NEXT_PUBLIC_ETH_SEPOLIA_CHAIN_ID || 11155111),
  name: "Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_ETH_SEPOLIA_RPC_URL || "https://rpc.sepolia.org"] },
  },
  blockExplorers: {
    default: {
      name: "Etherscan",
      url: process.env.NEXT_PUBLIC_ETH_SEPOLIA_EXPLORER_URL || "https://sepolia.etherscan.io",
    },
  },
  testnet: true,
});

const baseSepolia = defineChain({
  id: Number(process.env.NEXT_PUBLIC_BASE_SEPOLIA_CHAIN_ID || 84532),
  name: "Base Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: {
      name: "Base Explorer",
      url:
        process.env.NEXT_PUBLIC_BASE_SEPOLIA_EXPLORER_URL ||
        "https://base-sepolia.blockscout.com",
    },
  },
  testnet: true,
});

const config = createConfig({
  // NOTE: For cross-chain bridging, wallet must be able to switch to the source chain.
  // We include a minimal set here (ARC + popular testnets). Others can still be added via wallet_addEthereumChain.
  chains: [arc, ethSepolia, baseSepolia],
  transports: { 
    [arc.id]: http(arc.rpcUrls.default.http[0]),
    [ethSepolia.id]: http(ethSepolia.rpcUrls.default.http[0]),
    [baseSepolia.id]: http(baseSepolia.rpcUrls.default.http[0]),
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