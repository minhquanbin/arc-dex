export type Dest = { key: string; name: string; domain: number };

export const DESTS: Dest[] = [
  { key: "ETH_SEPOLIA", name: "Sepolia ETH", domain: 0 },
  { key: "AVAX_FUJI", name: "Avalanche Fuji", domain: 1 },
  { key: "OP_SEPOLIA", name: "OP Sepolia", domain: 2 },
  { key: "ARB_SEPOLIA", name: "Arbitrum Sepolia", domain: 3 },
  { key: "BASE_SEPOLIA", name: "Base Sepolia", domain: 6 },
  { key: "POLYGON_AMOY", name: "Polygon Amoy", domain: 7 },
  { key: "UNICHAIN_SEPOLIA", name: "Unichain Sepolia", domain: 10 },
  { key: "LINEA_SEPOLIA", name: "Linea Sepolia", domain: 11 },
  { key: "CODEX_TESTNET", name: "Codex Testnet", domain: 12 },
  { key: "SONIC_TESTNET", name: "Sonic Testnet", domain: 13 },
  { key: "WORLD_CHAIN_SEPOLIA", name: "World Chain Sepolia", domain: 14 },
  { key: "MONAD_TESTNET", name: "Monad Testnet", domain: 15 },
  { key: "SEI_TESTNET", name: "Sei Testnet", domain: 16 },
  { key: "XDC_APOTHEM", name: "XDC Apothem", domain: 18 },
  { key: "HYPEREVM_TESTNET", name: "HyperEVM Testnet", domain: 19 },
  { key: "INK_TESTNET", name: "Ink Testnet", domain: 21 },
  { key: "PLUME_TESTNET", name: "Plume Testnet", domain: 22 },
];