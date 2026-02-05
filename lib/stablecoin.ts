import { parseUnits } from "viem";

// =====================================================
// CIRCLE CONTRACTS CONFIGURATION
// =====================================================

// ERC-20 Template ID for Circle Contracts (docs Arc)
export const ERC20_TEMPLATE_ID = "a1b74add-23e0-4712-88d1-6b3009e85a86";

// Arc Testnet blockchain identifier
export const ARC_TESTNET_BLOCKCHAIN = "ARC-TESTNET";

// Circle API endpoints (server-side only)
export const CIRCLE_API_BASE_URL = "https://api.circle.com/v1/w3s";
// =====================================================
// WALLET (ON-CHAIN) DEPLOY CONFIG
// =====================================================

export const ARC_STABLECOIN_BYTECODE =
  (process.env.NEXT_PUBLIC_ARC_STABLECOIN_BYTECODE as `0x${string}` | undefined);

export const ARC_STABLECOIN_DEPLOY_ABI = [
  {
    type: "constructor",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "defaultAdmin", type: "address" },
      { name: "primarySaleRecipient", type: "address" },
      { name: "platformFeeRecipient", type: "address" },
      { name: "platformFeeBps", type: "uint256" },
      { name: "contractUri", type: "string" },
    ],
    stateMutability: "nonpayable",
  },
] as const;

// =====================================================
// STABLECOIN CONTRACT ABI (for interacting after deployment)
// =====================================================
export const STABLECOIN_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
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
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "mintTo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
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
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },

  // AccessControl (optional; only works if the template includes it)
  {
    type: "function",
    name: "grantRole",
    stateMutability: "nonpayable",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeRole",
    stateMutability: "nonpayable",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "hasRole",
    stateMutability: "view",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },

  {
    type: "event",
    name: "TokensMinted",
    inputs: [
      { name: "mintedTo", type: "address", indexed: true },
      { name: "quantityMinted", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TokensBurned",
    inputs: [
      { name: "burnedFrom", type: "address", indexed: true },
      { name: "quantityBurned", type: "uint256", indexed: false },
    ],
  },
] as const;

// =====================================================
// HELPER FUNCTIONS
// =====================================================

export function generateStablecoinName(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let prefix = "";
  for (let i = 0; i < 4; i++) {
    prefix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase() + "USD";
}

export function generateStablecoinSymbol(name: string): string {
  return name.charAt(0) + "USD";
}

export function validateStablecoinParams(params: {
  name: string;
  symbol: string;
  initialMint?: string;
  platformFeePercent?: number;
}) {
  const { name, symbol, initialMint, platformFeePercent } = params;

  if (!name || name.length < 3 || name.length > 50) {
    throw new Error("Name must be between 3-50 characters");
  }

  if (!symbol || symbol.length < 2 || symbol.length > 10) {
    throw new Error("Symbol must be between 2-10 characters");
  }

  if (initialMint) {
    const mintAmount = parseFloat(initialMint);
    if (isNaN(mintAmount) || mintAmount < 0) {
      throw new Error("Initial mint amount must be a positive number");
    }
  }

  if (platformFeePercent !== undefined && (platformFeePercent < 0 || platformFeePercent > 10)) {
    throw new Error("Platform fee must be between 0-10%");
  }
}

export function computePlatformFeeBps(percentFee: number): number {
  return Math.round(percentFee * 100);
}

export function formatSupply(supply: bigint, decimals: number): string {
  const divisor = 10 ** decimals;
  const supplyNum = Number(supply) / divisor;
  return supplyNum.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

// =====================================================
// CIRCLE API CLIENT
// =====================================================

/**
 * Deploy stablecoin using Circle Contracts Template
 * 
 * @param params Deployment parameters
 * @returns Deployment response with contractIds and transactionId
 */
export async function deployStablecoinWithCircle(params: {
  name: string;
  symbol: string;
  walletId: string;
  walletAddress: string;
  platformFeeRecipient?: string;
  platformFeePercent?: number;
  contractURI?: string;
}) {
  const {
    name,
    symbol,
    walletId,
    walletAddress,
    platformFeeRecipient,
    platformFeePercent = 0,
    contractURI = "https://metadata.arc-stablecoin.com/contract.json"
  } = params;

  // Validate params
  validateStablecoinParams({ name, symbol, platformFeePercent });

  // Template parameters theo tài liệu Arc
  const templateParameters: Record<string, any> = {
    name,
    symbol,
    defaultAdmin: walletAddress,
    primarySaleRecipient: walletAddress,
  };

  // Optional parameters
  if (platformFeeRecipient && platformFeePercent > 0) {
    templateParameters.platformFeeRecipient = platformFeeRecipient;
    templateParameters.platformFeePercent = platformFeePercent / 100; // Convert to decimal
  }

  if (contractURI) {
    templateParameters.contractUri = contractURI;
  }

  // ✅ Generate unique idempotency key for this request
  const idempotencyKey = crypto.randomUUID();

  const requestBody = {
    idempotencyKey, // ✅ Required by Circle API
    entitySecretCiphertext: "SENSITIVE_FIELD", // ✅ Will be replaced server-side
    blockchain: ARC_TESTNET_BLOCKCHAIN,
    name: `${name} Contract`, // Offchain name (visible in Circle Console)
    walletId,
    templateParameters,
    feeLevel: "MEDIUM",
  };

  // Call via server route (keeps API key secret + avoids browser CORS)
  const response = await fetch("/api/circle/deploy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      templateId: ERC20_TEMPLATE_ID,
      requestBody,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Circle API deployment failed: ${response.status} ${response.statusText}. ${JSON.stringify(error)}`
    );
  }

  const responseData = await response.json();
  
  // ✅ FIX: Handle different response structures
  console.log("📦 Deploy API Response:", JSON.stringify(responseData, null, 2));
  
  // Circle API can return response in two formats:
  // Format 1: { data: { contractIds: [...], transactionId: "..." } }
  // Format 2: { contractIds: [...], transactionId: "..." }
  // Format 3: { data: { contractId: "...", transactionId: "..." } } (for bytecode deploy)
  
  let contractIds: string[];
  let transactionId: string;
  
  if (responseData.data) {
    // Has 'data' wrapper
    const data = responseData.data;
    
    if (data.contractIds && Array.isArray(data.contractIds)) {
      // Template deployment: { data: { contractIds: [...] } }
      contractIds = data.contractIds;
    } else if (data.contractId && typeof data.contractId === 'string') {
      // Bytecode deployment: { data: { contractId: "..." } }
      contractIds = [data.contractId];
    } else {
      console.error("❌ Unexpected response structure:", responseData);
      throw new Error(`Unexpected response structure: ${JSON.stringify(responseData)}`);
    }
    
    transactionId = data.transactionId;
  } else {
    // No 'data' wrapper - direct response
    if (responseData.contractIds && Array.isArray(responseData.contractIds)) {
      contractIds = responseData.contractIds;
    } else if (responseData.contractId && typeof responseData.contractId === 'string') {
      contractIds = [responseData.contractId];
    } else {
      console.error("❌ Unexpected response structure:", responseData);
      throw new Error(`Unexpected response structure: ${JSON.stringify(responseData)}`);
    }
    
    transactionId = responseData.transactionId;
  }
  
  // Validate we got what we need
  if (!contractIds || contractIds.length === 0) {
    throw new Error("No contractIds returned from deployment API");
  }
  
  if (!transactionId) {
    throw new Error("No transactionId returned from deployment API");
  }
  
  console.log("✅ Parsed deployment response:", { contractIds, transactionId });
  
  return {
    contractIds,
    transactionId,
  };
}

/**
 * Check deployment transaction status
 */
export async function checkTransactionStatus(transactionId: string) {
  const response = await fetch(`/api/circle/transactions/${transactionId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to check transaction status: ${response.status}. ${text || ""}`
    );
  }

  const data = await response.json();

  // ✅ Handle response with or without 'data' wrapper(s)
  // Circle often returns: { data: { transaction: {...} } }
  const envelope = (data as any)?.data ?? data;
  const transaction = (envelope as any)?.transaction ?? envelope;

  // Keep full transaction payload (Circle may include useful failure fields)
  return transaction as {
    id: string;
    state: "PENDING" | "COMPLETE" | "FAILED";
    contractAddress?: string;
    txHash?: string;
    blockHeight?: number;
    errorReason?: string;
    errorCode?: string;
    errorMessage?: string;
    [k: string]: any;
  };
}

/**
 * Get contract details after deployment
 */
export async function getContractDetails(contractId: string) {
  const response = await fetch(`/api/circle/contracts/${contractId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get contract details: ${response.status}`);
  }

  const data = await response.json();

  // ✅ Handle response with or without 'data' wrapper(s)
  // Circle often returns: { data: { contract: {...} } }
  const envelope = (data as any)?.data ?? data;
  const contract = (envelope as any)?.contract ?? envelope;

  return contract as {
    id: string;
    contractAddress: string;
    blockchain: string;
    status: "PENDING" | "COMPLETE" | "FAILED";
  };
}

// =====================================================
// STABLECOIN CONFIG
// =====================================================
export const STABLECOIN_CONFIG = {
  DECIMALS: 18, // ERC-20 template uses 18 decimals by default
  DEFAULT_CONTRACT_URI: "https://metadata.arc-stablecoin.com/contract.json",
  
  // Polling config for deployment status
  POLL_INTERVAL_MS: 3000,
  MAX_POLL_ATTEMPTS: 180, // 9 minutes total (180 * 3s)
};

// =====================================================
// TYPES
// =====================================================
export type DeployStablecoinParams = {
  name: string;
  symbol: string;
  walletId: string;
  walletAddress: string;
  platformFeeRecipient?: string;
  platformFeePercent?: number;
  contractURI?: string;
};

export type StablecoinInfo = {
  contractId: string;
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  balance: string;
  isPaused: boolean;
  deployTx: string;
  transactionId: string;
  timestamp: string;
};