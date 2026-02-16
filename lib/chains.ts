export type Dest = {
  key: string;
  name: string;
  domain: number;
  symbol: string;
  iconPath: string;
};

export const DESTS: Dest[] = [
  { key: "ETH_SEPOLIA", name: "Sepolia (Ethereum)", domain: 0, symbol: "Ξ", iconPath: "/chain-icons/eth_sepolia.svg" },
  { key: "AVAX_FUJI", name: "Avalanche Fuji", domain: 1, symbol: "AVAX", iconPath: "/chain-icons/avax_fuji.svg" },
  { key: "OP_SEPOLIA", name: "OP Sepolia", domain: 2, symbol: "OP", iconPath: "/chain-icons/op_sepolia.svg" },
  { key: "ARB_SEPOLIA", name: "Arbitrum Sepolia", domain: 3, symbol: "ARB", iconPath: "/chain-icons/arb_sepolia.svg" },
  { key: "BASE_SEPOLIA", name: "Base Sepolia", domain: 6, symbol: "BASE", iconPath: "/chain-icons/base_sepolia.svg" },
  { key: "POLYGON_AMOY", name: "Polygon Amoy", domain: 7, symbol: "POLY", iconPath: "/chain-icons/polygon_amoy.svg" },
  { key: "UNICHAIN_SEPOLIA", name: "Unichain Sepolia", domain: 10, symbol: "UNI", iconPath: "/chain-icons/unichain_sepolia.svg" },
  { key: "LINEA_SEPOLIA", name: "Linea Sepolia", domain: 11, symbol: "LINEA", iconPath: "/chain-icons/linea_sepolia.svg" },
  { key: "CODEX_TESTNET", name: "Codex Testnet", domain: 12, symbol: "CODEX", iconPath: "/chain-icons/codex_testnet.svg" },
  { key: "SONIC_TESTNET", name: "Sonic Testnet", domain: 13, symbol: "SONIC", iconPath: "/chain-icons/sonic_testnet.svg" },
  { key: "WORLD_CHAIN_SEPOLIA", name: "World Chain Sepolia", domain: 14, symbol: "WORLD", iconPath: "/chain-icons/world_chain_sepolia.svg" },
  { key: "MONAD_TESTNET", name: "Monad Testnet", domain: 15, symbol: "MONAD", iconPath: "/chain-icons/monad_testnet.svg" },
  { key: "SEI_TESTNET", name: "Sei Testnet", domain: 16, symbol: "SEI", iconPath: "/chain-icons/sei_testnet.svg" },
  { key: "XDC_APOTHEM", name: "XDC Apothem", domain: 18, symbol: "XDC", iconPath: "/chain-icons/xdc_apothem.svg" },
  { key: "HYPEREVM_TESTNET", name: "HyperEVM Testnet", domain: 19, symbol: "HYPER", iconPath: "/chain-icons/hyperevm_testnet.svg" },
  { key: "INK_TESTNET", name: "Ink Testnet", domain: 21, symbol: "INK", iconPath: "/chain-icons/ink_testnet.svg" },
  { key: "PLUME_TESTNET", name: "Plume Testnet", domain: 22, symbol: "PLUME", iconPath: "/chain-icons/plume_testnet.svg" },
];

export type EvmChainConfig = {
  key: Dest["key"] | "ARC_TESTNET";
  name: string;
  chainId: number;
  rpcUrl?: string;
  explorerUrl?: string;
  // CCTP v2
  domain: number;
  usdc?: `0x${string}`;
  tokenMessengerV2?: `0x${string}`;
  iconPath?: string;
};

export const ARC_CHAIN: EvmChainConfig = {
  key: "ARC_TESTNET",
  name: "ARC Testnet",
  chainId: Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID || 5042002),
  rpcUrl: process.env.NEXT_PUBLIC_ARC_RPC_URL,
  explorerUrl: "https://testnet.arcscan.app",
  domain: Number(process.env.NEXT_PUBLIC_ARC_CCTP_DOMAIN || 26),
  iconPath: "/chain-icons/arc-logo.svg",
};

function envAddr(v?: string): `0x${string}` | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) return undefined;
  return s as `0x${string}`;
}

function envNum(v?: string): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function chainFromEnv(dest: Dest): EvmChainConfig | null {
  const prefix = `NEXT_PUBLIC_${dest.key}_`;
  const chainId = envNum(process.env[`${prefix}CHAIN_ID`]);
  if (!chainId) return null; // not enabled

  return {
    key: dest.key,
    name: dest.name,
    chainId,
    rpcUrl: process.env[`${prefix}RPC_URL`],
    explorerUrl: process.env[`${prefix}EXPLORER_URL`],
    domain: dest.domain,
    usdc: envAddr(process.env[`${prefix}USDC`]),
    tokenMessengerV2: envAddr(process.env[`${prefix}TOKEN_MESSENGER_V2`]),
    iconPath: dest.iconPath,
  };
}

export const OTHER_EVM_CHAINS: EvmChainConfig[] = DESTS.map(chainFromEnv).filter(
  (x): x is EvmChainConfig => !!x
);

// Helpful when debugging env vars in production (Vercel).
export const __DEBUG_OTHER_CHAIN_KEYS = OTHER_EVM_CHAINS.map((c) => c.key);
