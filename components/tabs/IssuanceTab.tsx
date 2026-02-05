"use client";

import { useEffect, useState } from "react";
import { parseUnits, keccak256, toHex, decodeEventLog } from "viem";
import { useAccount, usePublicClient, useWalletClient, useWriteContract } from "wagmi";
import {
  deployStablecoinWithCircle,
  checkTransactionStatus,
  getContractDetails,
  generateStablecoinName,
  generateStablecoinSymbol,
  validateStablecoinParams,
  STABLECOIN_ABI,
  STABLECOIN_CONFIG,
  type StablecoinInfo,
} from "../../lib/stablecoin";

type DeploymentStatus = "idle" | "deploying" | "polling" | "success" | "error";

type RolePreset =
  | "MINTER_ROLE"
  | "BURNER_ROLE"
  | "PAUSER_ROLE"
  | "DEFAULT_ADMIN_ROLE"
  | "CUSTOM";

const rolePresetToBytes32 = (preset: Exclude<RolePreset, "CUSTOM">): string => {
  if (preset === "DEFAULT_ADMIN_ROLE") {
    // OpenZeppelin AccessControl default admin role is 0x00..00
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  return keccak256(toHex(preset));
};

// ✅ Factory ABI - simple inline version
const FACTORY_ABI = [
  {
    type: "function",
    name: "createStablecoin",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "platformFeeRecipient", type: "address" },
      { name: "platformFeePercent", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "StablecoinCreated",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

export default function IssuanceTab() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  // Form state
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [deployMode, setDeployMode] = useState<"wallet" | "circle">("wallet");
  const [walletId, setWalletId] = useState("");
  const [platformFeePercent, setPlatformFeePercent] = useState(0);

  // Deployment state
  const [status, setStatus] = useState<DeploymentStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [deployedContract, setDeployedContract] = useState<StablecoinInfo | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);

  // Persist deployed contracts locally so refresh won't lose them
  const [savedContracts, setSavedContracts] = useState<StablecoinInfo[]>([]);
  const [selectedContractAddress, setSelectedContractAddress] = useState<string>("");

  // Contract interaction state (after deploy)
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastActionTx, setLastActionTx] = useState<string | null>(null);

  const [mintTo, setMintTo] = useState("");
  const [mintAmount, setMintAmount] = useState("");

  const [burnAmount, setBurnAmount] = useState("");

  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");

  const [approveSpender, setApproveSpender] = useState("");
  const [approveAmount, setApproveAmount] = useState("");

  const [rolePreset, setRolePreset] = useState<RolePreset>("MINTER_ROLE");
  const [roleHex, setRoleHex] = useState(rolePresetToBytes32("MINTER_ROLE"));
  const [roleAccount, setRoleAccount] = useState("");

  // ✅ Get Factory Address from env
  const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as `0x${string}` | undefined;

  useEffect(() => {
    if (rolePreset === "CUSTOM") return;
    setRoleHex(rolePresetToBytes32(rolePreset));
  }, [rolePreset]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("arc:savedStablecoins");
      const parsed = raw ? (JSON.parse(raw) as StablecoinInfo[]) : [];
      const items = Array.isArray(parsed) ? parsed : [];
      setSavedContracts(items);

      const lastSelected = localStorage.getItem("arc:selectedStablecoin") || "";
      if (lastSelected) {
        setSelectedContractAddress(lastSelected);
        const found = items.find(
          (c) => c.contractAddress?.toLowerCase() === lastSelected.toLowerCase()
        );
        if (found) {
          setDeployedContract(found);
          setStatus("success");
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const persistSavedContracts = (items: StablecoinInfo[]) => {
    setSavedContracts(items);
    try {
      localStorage.setItem("arc:savedStablecoins", JSON.stringify(items));
    } catch {
      // ignore
    }
  };

  const selectSavedContract = (contractAddress: string) => {
    setSelectedContractAddress(contractAddress);
    try {
      localStorage.setItem("arc:selectedStablecoin", contractAddress);
    } catch {
      // ignore
    }

    const found = savedContracts.find(
      (c) => c.contractAddress?.toLowerCase() === contractAddress.toLowerCase()
    );
    if (found) {
      setDeployedContract(found);
      setStatus("success");
      setError(null);
      setActionError(null);
      setLastActionTx(null);
    }
  };

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

  // Auto-generate name and symbol
  const handleAutoGenerate = () => {
    const generatedName = generateStablecoinName();
    const generatedSymbol = generateStablecoinSymbol(generatedName);
    setName(generatedName);
    setSymbol(generatedSymbol);
  };

  // Poll deployment status (for Circle mode)
  const pollDeploymentStatus = async (txId: string, ctId: string): Promise<void> => {
    let attempts = 0;
    const maxAttempts = STABLECOIN_CONFIG.MAX_POLL_ATTEMPTS;

    while (attempts < maxAttempts) {
      try {
        // Check transaction status
        const txStatus = await checkTransactionStatus(txId);

        if (txStatus.state === "COMPLETE") {
          // Get contract details
          const contractDetails = await getContractDetails(ctId);

          if (contractDetails.status === "COMPLETE" && contractDetails.contractAddress) {
            // Success! Create contract info
            const contractInfo: StablecoinInfo = {
              contractId: ctId,
              contractAddress: contractDetails.contractAddress,
              name,
              symbol,
              decimals: STABLECOIN_CONFIG.DECIMALS,
              totalSupply: "0", // Initial supply is 0 for Circle ERC-20 template
              balance: "0",
              isPaused: false,
              deployTx: txStatus.txHash || "",
              transactionId: txId,
              timestamp: new Date().toISOString(),
            };

            setDeployedContract(contractInfo);
            setSelectedContractAddress(contractInfo.contractAddress);

            // Save (de-dupe by contractAddress)
            const nextSaved = [
              contractInfo,
              ...savedContracts.filter(
                (c) => c.contractAddress.toLowerCase() !== contractInfo.contractAddress.toLowerCase()
              ),
            ];
            persistSavedContracts(nextSaved);

            setStatus("success");
            return;
          }
        } else if (txStatus.state === "FAILED") {
          const reason =
            txStatus.errorReason ||
            txStatus.errorMessage ||
            txStatus.errorCode ||
            "Transaction failed on-chain";
          throw new Error(`Deployment transaction failed: ${reason}`);
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, STABLECOIN_CONFIG.POLL_INTERVAL_MS));
        attempts++;
      } catch (err) {
        console.error("Polling error:", err);
        attempts++;
      }
    }

    throw new Error("Deployment timeout - transaction status check exceeded maximum attempts");
  };

  // ✅ NEW: Deploy via Factory
  const handleWalletDeploy = async () => {
    if (!isConnected || !address || !walletClient || !publicClient) {
      setError("Please connect your wallet first");
      return;
    }

    if (!FACTORY_ADDRESS) {
      setError("Factory address not configured. Add NEXT_PUBLIC_FACTORY_ADDRESS to .env.local");
      return;
    }

    try {
      // Validate inputs
      validateStablecoinParams({
        name,
        symbol,
        platformFeePercent,
      });

      setStatus("deploying");
      setError(null);
      setDeployedContract(null);
      setTransactionId(null);
      setContractId(null);

      console.log("🚀 Deploying via Factory:", FACTORY_ADDRESS);

      // Call factory.createStablecoin
      const hash = await walletClient.writeContract({
        address: FACTORY_ADDRESS,
        abi: FACTORY_ABI,
        functionName: "createStablecoin",
        args: [
          name,
          symbol,
          address, // Fee recipient = deployer
          BigInt(Math.floor(platformFeePercent)),
        ],
      });

      console.log("📝 Transaction sent:", hash);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      console.log("✅ Transaction confirmed");

      // Parse event to get token address
      let tokenAddress: string | undefined;

      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: FACTORY_ABI,
            data: log.data,
            topics: log.topics,
          });

          if (decoded.eventName === "StablecoinCreated") {
            tokenAddress = (decoded.args as any).token;
            break;
          }
        } catch (e) {
          // Skip non-matching logs
          continue;
        }
      }

      if (!tokenAddress) {
        throw new Error("Could not find token address in transaction logs");
      }

      console.log("🎉 Token deployed at:", tokenAddress);

      // Create contract info
      const contractInfo: StablecoinInfo = {
        contractId: tokenAddress,
        contractAddress: tokenAddress,
        name,
        symbol,
        decimals: 18,
        totalSupply: "0",
        balance: "0",
        isPaused: false,
        deployTx: hash,
        transactionId: hash,
        timestamp: new Date().toISOString(),
      };

      setDeployedContract(contractInfo);
      setSelectedContractAddress(contractInfo.contractAddress);

      // Save to localStorage (de-dupe by contractAddress)
      const nextSaved = [
        contractInfo,
        ...savedContracts.filter(
          (c) => c.contractAddress.toLowerCase() !== contractInfo.contractAddress.toLowerCase()
        ),
      ];
      persistSavedContracts(nextSaved);

      setStatus("success");
    } catch (err: any) {
      console.error("❌ Deployment failed:", err);
      setError(err?.shortMessage || err?.message || "Deployment failed");
      setStatus("error");
    }
  };

  // Circle Wallet Deploy (existing code)
  const handleCircleDeploy = async () => {
    if (!isConnected || !address) {
      setError("Please connect your wallet first");
      return;
    }

    if (!walletId) {
      setError("Please enter your Circle Wallet ID");
      return;
    }

    try {
      // Validate inputs
      validateStablecoinParams({
        name,
        symbol,
        platformFeePercent,
      });

      setStatus("deploying");
      setError(null);
      setDeployedContract(null);
      setTransactionId(null);
      setContractId(null);

      // Deploy via Circle API
      const result = await deployStablecoinWithCircle({
        name,
        symbol,
        walletId,
        walletAddress: address,
        platformFeePercent,
        contractURI: STABLECOIN_CONFIG.DEFAULT_CONTRACT_URI,
      });

      console.log("Deployment initiated:", result);

      setTransactionId(result.transactionId);
      setContractId(result.contractIds[0]);
      setStatus("polling");

      // Poll for completion
      await pollDeploymentStatus(result.transactionId, result.contractIds[0]);
    } catch (err: any) {
      console.error("Deployment error:", err);
      setError(err.message || "Deployment failed");
      setStatus("error");
    }
  };

  const requireDeployed = () => {
    if (!deployedContract?.contractAddress) throw new Error("Missing contract address");
    return deployedContract.contractAddress as `0x${string}`;
  };

  const handleMint = async () => {
    try {
      setActionError(null);
      setLastActionTx(null);

      const addr = requireDeployed();
      if (!mintAmount) throw new Error("Enter mint amount");
      const to = (mintTo?.trim() ? mintTo.trim() : address) as `0x${string}`;
      if (!to) throw new Error("Connect wallet first");

      const hash = await writeContractAsync({
        address: addr,
        abi: STABLECOIN_ABI,
        functionName: "mintTo",
        args: [to, parseUnits(mintAmount, STABLECOIN_CONFIG.DECIMALS)],
      });

      setLastActionTx(hash);
    } catch (e: any) {
      setActionError(e?.shortMessage || e?.message || "Mint failed");
    }
  };

  const handleBurn = async () => {
    try {
      setActionError(null);
      setLastActionTx(null);

      const addr = requireDeployed();
      if (!burnAmount) throw new Error("Enter burn amount");
      if (!address) throw new Error("Connect wallet first");

      const burnQty = parseUnits(burnAmount, STABLECOIN_CONFIG.DECIMALS);
      if (publicClient) {
        const bal = (await publicClient.readContract({
          address: addr,
          abi: STABLECOIN_ABI,
          functionName: "balanceOf",
          args: [address],
        })) as bigint;

        if (burnQty > bal) {
          throw new Error(
            `ERC20: burn amount exceeds balance. Balance: ${bal.toString()} (base units), burn: ${burnQty.toString()} (base units).`
          );
        }
      }

      const hash = await writeContractAsync({
        address: addr,
        abi: STABLECOIN_ABI,
        functionName: "burn",
        args: [burnQty],
      });

      setLastActionTx(hash);
    } catch (e: any) {
      setActionError(e?.shortMessage || e?.message || "Burn failed");
    }
  };

  const handleTransfer = async () => {
    try {
      setActionError(null);
      setLastActionTx(null);

      const addr = requireDeployed();
      if (!transferTo || !transferAmount) throw new Error("Enter transfer recipient + amount");

      const hash = await writeContractAsync({
        address: addr,
        abi: STABLECOIN_ABI,
        functionName: "transfer",
        args: [transferTo as `0x${string}`, parseUnits(transferAmount, STABLECOIN_CONFIG.DECIMALS)],
      });

      setLastActionTx(hash);
    } catch (e: any) {
      setActionError(e?.shortMessage || e?.message || "Transfer failed");
    }
  };

  const handleApprove = async () => {
    try {
      setActionError(null);
      setLastActionTx(null);

      const addr = requireDeployed();
      if (!approveSpender || !approveAmount) throw new Error("Enter spender + amount");

      const hash = await writeContractAsync({
        address: addr,
        abi: STABLECOIN_ABI,
        functionName: "approve",
        args: [approveSpender as `0x${string}`, parseUnits(approveAmount, STABLECOIN_CONFIG.DECIMALS)],
      });

      setLastActionTx(hash);
    } catch (e: any) {
      setActionError(e?.shortMessage || e?.message || "Approve failed");
    }
  };

  const handleGrantRole = async () => {
    try {
      setActionError(null);
      setLastActionTx(null);

      const addr = requireDeployed();
      if (!roleHex || !roleAccount) throw new Error("Enter role (bytes32) + account");

      const hash = await writeContractAsync({
        address: addr,
        abi: STABLECOIN_ABI,
        functionName: "grantRole",
        args: [roleHex as `0x${string}`, roleAccount as `0x${string}`],
      });

      setLastActionTx(hash);
    } catch (e: any) {
      setActionError(e?.shortMessage || e?.message || "GrantRole failed");
    }
  };

  return (
    <div className="w-full px-4 py-6 mx-auto max-w-6xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: Deploy form */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-xl font-bold text-gray-900">Deploy tokens</h3>

            {/* Mode Toggle */}
            <div className="mb-6 flex gap-3">
              <button
                onClick={() => setDeployMode("wallet")}
                className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                  deployMode === "wallet"
                    ? "bg-gradient-to-r from-[#ff7582] to-[#725a7a] text-white shadow-md"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                User Wallet
              </button>
              <button
                onClick={() => setDeployMode("circle")}
                className={`flex-1 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                  deployMode === "circle"
                    ? "bg-gradient-to-r from-[#ff7582] to-[#725a7a] text-white shadow-md"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Circle Wallet
              </button>
            </div>

            <div className="space-y-4">
              {/* Token Name */}
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-700">
                  Token Name <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. TimgUSD"
                    className="flex-1 px-4 py-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                  <button
                    onClick={handleAutoGenerate}
                    className="px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-600 text-white text-sm font-medium rounded-lg hover:from-pink-600 hover:to-purple-700 transition-colors"
                  >
                    Random
                  </button>
                </div>
              </div>

              {/* Token Symbol */}
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-700">
                  Token Symbol <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  placeholder="e.g. TUSD"
                  className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
              </div>

              {/* Platform Fee */}
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-700">
                  Platform Fee (%) - Optional
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={platformFeePercent}
                  onChange={(e) => setPlatformFeePercent(parseFloat(e.target.value) || 0)}
                  placeholder="0.01"
                  className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Platform fee percentage (0-10%). If set, you'll receive this percentage on token sales.
                </p>
              </div>

              {/* Circle Wallet ID (only for Circle mode) */}
              {deployMode === "circle" && (
                <div>
                  <label className="block mb-2 text-sm font-medium text-gray-700">
                    Circle Wallet ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={walletId}
                    onChange={(e) => setWalletId(e.target.value)}
                    placeholder="Your Circle Wallet ID"
                    className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                  />
                </div>
              )}

              {/* ✅ Factory Info (only for User Wallet mode) */}
              {deployMode === "wallet" && FACTORY_ADDRESS && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-700">
                    <span className="font-medium">Factory Contract:</span>{" "}
                    <code className="text-[11px] break-all">{FACTORY_ADDRESS}</code>
                  </p>
                </div>
              )}

              {deployMode === "wallet" && !FACTORY_ADDRESS && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-xs text-red-700">
                    ⚠️ Factory address not configured. Add{" "}
                    <code className="bg-red-100 px-1 rounded">NEXT_PUBLIC_FACTORY_ADDRESS</code> to
                    .env.local
                  </p>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">
                    <strong>Error:</strong> {error}
                  </p>
                </div>
              )}

              {/* Status Display */}
              {status === "deploying" && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    🚀 Deploying stablecoin... Please confirm in your wallet.
                  </p>
                </div>
              )}

              {status === "polling" && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">⏳ Waiting for transaction confirmation...</p>
                  {transactionId && (
                    <p className="mt-1 text-xs text-blue-600 font-mono break-all">
                      TX: {transactionId}
                    </p>
                  )}
                </div>
              )}

              {/* Deploy Buttons */}
              {deployMode === "wallet" ? (
                <button
                  onClick={handleWalletDeploy}
                  disabled={
                    !isConnected || 
                    status === "deploying" || 
                    status === "polling" ||
                    !FACTORY_ADDRESS
                  }
                  className={gradientButtonClass(
                    !isConnected || status === "deploying" || status === "polling" || !FACTORY_ADDRESS,
                    "w-full px-6 py-4 text-base"
                  )}
                >
                  {!isConnected
                    ? "Connect Wallet First"
                    : status === "deploying"
                    ? "Deploying..."
                    : "Deploy via Wallet"}
                </button>
              ) : (
                <button
                  onClick={handleCircleDeploy}
                  disabled={!isConnected || status === "deploying" || status === "polling"}
                  className={gradientButtonClass(
                    !isConnected || status === "deploying" || status === "polling",
                    "w-full px-6 py-4 text-base"
                  )}
                >
                  {!isConnected
                    ? "Connect Wallet First"
                    : status === "deploying"
                    ? "Deploying..."
                    : status === "polling"
                    ? "Confirming..."
                    : "Deploy via Circle"}
                </button>
              )}

              <p className="text-xs text-gray-500 text-center">
                {deployMode === "wallet"
                  ? "Deploys an ERC-20 on ARC via the connected wallet."
                  : "Dùng Circle Smart Contract Platform để deploy"}
              </p>
            </div>
          </div>
        </div>

        {/* Right column: Deployed tokens */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-xl font-bold text-gray-900">Your deployed tokens</h3>

            {savedContracts.length > 0 ? (
              <div className="space-y-3">
                <select
                  value={selectedContractAddress}
                  onChange={(e) => selectSavedContract(e.target.value)}
                  className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                >
                  <option value="">Select a token...</option>
                  {savedContracts.map((c) => (
                    <option key={c.contractAddress} value={c.contractAddress}>
                      {c.name} ({c.symbol}) - {c.contractAddress.slice(0, 8)}...
                      {c.contractAddress.slice(-6)}
                    </option>
                  ))}
                </select>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedContractAddress("");
                      setDeployedContract(null);
                      setStatus("idle");
                      try {
                        localStorage.removeItem("arc:selectedStablecoin");
                      } catch {
                        // ignore
                      }
                    }}
                    className={gradientButtonClass(false, "px-4 py-2 text-sm")}
                  >
                    Clear
                  </button>
                </div>

                <div className="mt-2 text-xs text-gray-600">
                  Tip: these are saved in your browser (localStorage), so they'll still be here after
                  refresh.
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                No deployed tokens found yet.
              </div>
            )}

            {/* Contract Actions */}
            {status === "success" && deployedContract && (
              <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900">Contract actions</h4>
                  <span className="text-xs text-gray-500">
                    Decimals: {STABLECOIN_CONFIG.DECIMALS}
                  </span>
                </div>

                {actionError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-xs text-red-800">
                      <strong>Error:</strong> {actionError}
                    </p>
                  </div>
                )}

                {lastActionTx && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-xs text-blue-800">
                      <strong>Last TX:</strong>{" "}
                      <a
                        className="underline font-mono"
                        target="_blank"
                        rel="noopener noreferrer"
                        href={`https://testnet.arcscan.app/tx/${lastActionTx}`}
                      >
                        {lastActionTx.slice(0, 10)}...{lastActionTx.slice(-8)}
                      </a>
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4">
                  {/* Mint */}
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-gray-900">Mint</div>
                    <input
                      type="text"
                      value={mintTo}
                      onChange={(e) => setMintTo(e.target.value)}
                      placeholder="Recipient address (0x...)"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    />
                    <input
                      type="text"
                      value={mintAmount}
                      onChange={(e) => setMintAmount(e.target.value)}
                      placeholder='Amount (e.g. "100")'
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    />
                    <button
                      onClick={handleMint}
                      disabled={isWriting}
                      className={gradientButtonClass(isWriting, "w-full px-4 py-2 text-sm")}
                    >
                      {isWriting ? "Sending..." : "Mint"}
                    </button>
                  </div>

                  {/* Burn */}
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-gray-900">Burn</div>
                    <input
                      type="text"
                      value={burnAmount}
                      onChange={(e) => setBurnAmount(e.target.value)}
                      placeholder='Amount (e.g. "10")'
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    />

                    <button
                      onClick={handleBurn}
                      disabled={isWriting}
                      className={gradientButtonClass(isWriting, "w-full px-4 py-2 text-sm")}
                    >
                      {isWriting ? "Sending..." : "Burn"}
                    </button>
                  </div>

                  {/* Transfer */}
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-gray-900">Transfer</div>
                    <input
                      type="text"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      placeholder="Recipient address (0x...)"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    />
                    <input
                      type="text"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      placeholder='Amount (e.g. "1")'
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    />
                    <button
                      onClick={handleTransfer}
                      disabled={isWriting}
                      className={gradientButtonClass(isWriting, "w-full px-4 py-2 text-sm")}
                    >
                      {isWriting ? "Sending..." : "Transfer"}
                    </button>
                  </div>

                  {/* Approve Spending Limit */}
                  <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-gray-900">Approve Spending Limit</div>
                    <input
                      type="text"
                      value={approveSpender}
                      onChange={(e) => setApproveSpender(e.target.value)}
                      placeholder="Spender address (0x...)"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    />
                    <input
                      type="text"
                      value={approveAmount}
                      onChange={(e) => setApproveAmount(e.target.value)}
                      placeholder='Amount (e.g. "100")'
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                    />
                    <button
                      onClick={handleApprove}
                      disabled={isWriting}
                      className={gradientButtonClass(isWriting, "w-full px-4 py-2 text-sm")}
                    >
                      {isWriting ? "Sending..." : "Approve"}
                    </button>
                  </div>

                  {/* GrantRole (advanced) */}
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-amber-900">
                      GrantRole (advanced)
                    </div>

                    <select
                      value={rolePreset}
                      onChange={(e) => setRolePreset(e.target.value as RolePreset)}
                      className="w-full px-3 py-2 text-sm border border-amber-300 rounded-lg bg-white"
                    >
                      <option value="MINTER_ROLE">Role Mint (MINTER_ROLE)</option>
                      <option value="BURNER_ROLE">Role Burn (BURNER_ROLE)</option>
                      <option value="PAUSER_ROLE">Role Pause (PAUSER_ROLE)</option>
                      <option value="DEFAULT_ADMIN_ROLE">
                        Role Admin (DEFAULT_ADMIN_ROLE)
                      </option>
                    </select>

                    <input
                      type="text"
                      value={roleAccount}
                      onChange={(e) => setRoleAccount(e.target.value)}
                      placeholder="Account address (0x...)"
                      className="w-full px-3 py-2 text-sm border border-amber-300 rounded-lg"
                    />
                    <button
                      onClick={handleGrantRole}
                      disabled={isWriting}
                      className={gradientButtonClass(isWriting, "w-full px-4 py-2 text-sm")}
                    >
                      {isWriting ? "Sending..." : "GrantRole"}
                    </button>
                    <p className="text-[11px] text-amber-800">
                      If your deployed template doesn't support AccessControl, this call will fail.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}