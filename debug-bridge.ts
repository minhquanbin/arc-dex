import { createPublicClient, http, parseUnits, getAddress } from "viem";

// ✅ FIX: Import từ lib/cctp.ts thay vì ./cctp
const ROUTER_ABI = [
  {
    type: "function",
    name: "bridge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokenMessengerV2", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feeCollector", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

const ERC20_ABI = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [
    { name: "owner", type: "address" }, { name: "spender", type: "address" }
  ], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [
    { name: "owner", type: "address" }
  ], outputs: [{ name: "", type: "uint256" }] },
] as const;

function addressToBytes32(address: `0x${string}`) {
  return (`0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`) as `0x${string}`;
}

const HOOK_DATA = "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;

// Config từ .env (hoặc hardcode để test)
const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.network";
const ROUTER = (process.env.NEXT_PUBLIC_ARC_ROUTER || "0x82657177d3b529E008cb766475F53CeFb0d95819") as `0x${string}`;

const client = createPublicClient({
  transport: http(ARC_RPC),
});

async function debugBridge() {
  console.log("🔍 DEBUGGING BRIDGE CONTRACT\n");
  console.log("📡 RPC:", ARC_RPC);
  console.log("🔗 Router:", ROUTER);
  console.log("");

  try {
    // 1. Kiểm tra Router config
    console.log("1️⃣ Checking Router configuration...");
    const routerUsdc = (await client.readContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "usdc",
    })) as `0x${string}`;
    
    const routerTm = (await client.readContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "tokenMessengerV2",
    })) as `0x${string}`;

    const feeCollector = (await client.readContract({
      address: ROUTER,
      abi: ROUTER_ABI,
      functionName: "feeCollector",
    })) as `0x${string}`;

    console.log("   ✅ Router USDC address:", routerUsdc);
    console.log("   ✅ Router TokenMessenger:", routerTm);
    console.log("   ✅ Fee Collector:", feeCollector);
    console.log("");

    // Kiểm tra xem .env có đúng không
    const envUsdc = process.env.NEXT_PUBLIC_ARC_USDC_ADDRESS;
    if (envUsdc && envUsdc.toLowerCase() !== routerUsdc.toLowerCase()) {
      console.log("   ⚠️  WARNING: .env USDC address không khớp!");
      console.log("   📝 .env có:", envUsdc);
      console.log("   📝 Router expect:", routerUsdc);
      console.log("   👉 GIẢI PHÁP: Xóa dòng NEXT_PUBLIC_ARC_USDC_ADDRESS trong .env.local");
      console.log("      (Code mới sẽ tự lấy địa chỉ đúng từ Router)");
      console.log("");
    } else {
      console.log("   ✅ Config OK!");
      console.log("");
    }

    // 2. Test với params mẫu
    console.log("2️⃣ Testing with sample parameters...");
    const testAmount = parseUnits("5", 6); // 5 USDC
    const testDomain = 3; // Arbitrum Sepolia
    
    // ✅ Lấy địa chỉ từ command line argument hoặc dùng địa chỉ mặc định
    let testRecipient: `0x${string}`;
    const inputAddress = process.argv[2]; // Lấy từ: npx tsx debug-bridge.ts 0xYourAddress
    
    if (inputAddress) {
      try {
        testRecipient = getAddress(inputAddress) as `0x${string}`; // Auto-correct checksum
        console.log("   Using provided address:", testRecipient);
      } catch {
        console.log("   ❌ Invalid address provided, using default");
        testRecipient = "0x0000000000000000000000000000000000000000"; // Null address for testing
      }
    } else {
      // Địa chỉ mặc định để test contract config (không test balance)
      testRecipient = "0x0000000000000000000000000000000000000000";
      console.log("   💡 No address provided, using null address (config test only)");
      console.log("   💡 To test with your wallet: npx tsx debug-bridge.ts YOUR_ADDRESS");
    }
    
    const testMaxFee = parseUnits("0.22", 6); // 220000 wei
    const minFinality = 1000;

    console.log("   Amount:", testAmount.toString(), `(${Number(testAmount) / 1e6} USDC)`);
    console.log("   Domain:", testDomain, "(Arbitrum Sepolia)");
    console.log("   MaxFee:", testMaxFee.toString(), `(${Number(testMaxFee) / 1e6} USDC)`);
    console.log("   MinFinality:", minFinality);
    console.log("");

    // 3. Check maxFee < amount
    console.log("3️⃣ Validating maxFee < amount...");
    if (testMaxFee >= testAmount) {
      console.log("   ❌ ERROR: maxFee >= amount!");
      console.log("   Contract yêu cầu: maxFee < amount");
      console.log("   Hiện tại: maxFee =", Number(testMaxFee) / 1e6, "USDC, amount =", Number(testAmount) / 1e6, "USDC");
      console.log("");
    } else {
      console.log("   ✅ maxFee < amount OK!");
      console.log("   Difference:", Number(testAmount - testMaxFee) / 1e6, "USDC");
      console.log("");
    }

    // 4. Kiểm tra user balance (nếu có địa chỉ)
    const userAddress = testRecipient as `0x${string}`;
    
    if (userAddress === "0x0000000000000000000000000000000000000000") {
      console.log("4️⃣ Skipping balance check (no address provided)");
      console.log("   💡 Run: npx tsx debug-bridge.ts YOUR_WALLET_ADDRESS");
      console.log("");
    } else {
      console.log("4️⃣ Checking user balance for:", userAddress);
    
    try {
      const balance = await client.readContract({
        address: routerUsdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [userAddress],
      });
      
      const allowance = await client.readContract({
        address: routerUsdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [userAddress, ROUTER],
      });

      console.log("   Balance:", balance.toString(), `(${Number(balance) / 1e6} USDC)`);
      console.log("   Allowance:", allowance.toString(), `(${Number(allowance) / 1e6} USDC)`);
      console.log("");

      const fee = parseUnits("0.01", 6);
      const totalNeeded = testAmount + fee;
      console.log("   Total needed:", Number(totalNeeded) / 1e6, "USDC (amount + 0.01 fee)");

      if (balance < totalNeeded) {
        console.log("   ❌ Insufficient balance!");
      } else {
        console.log("   ✅ Balance sufficient");
      }

      if (allowance < totalNeeded) {
        console.log("   ⚠️  Need to approve USDC");
      } else {
        console.log("   ✅ Allowance sufficient");
      }
      console.log("");
    } catch (balErr: any) {
      console.log("   ⚠️  Could not check balance:", balErr.message);
      console.log("");
    }
    } // Close if statement for non-null address

    // 5. Simulate transaction
    if (userAddress === "0x0000000000000000000000000000000000000000") {
      console.log("5️⃣ Skipping simulation (no address provided)");
      console.log("");
      console.log("✅ Contract configuration check completed!");
      console.log("💡 To test full flow: npx tsx debug-bridge.ts YOUR_WALLET_ADDRESS");
    } else {
      console.log("5️⃣ Simulating bridge transaction...");
    try {
      const { result } = await client.simulateContract({
        address: ROUTER,
        abi: ROUTER_ABI,
        functionName: "bridge",
        args: [
          testAmount,
          testDomain,
          addressToBytes32(testRecipient as `0x${string}`),
          testMaxFee,
          minFinality,
          HOOK_DATA,
        ],
        account: userAddress,
      });
      console.log("   ✅ SIMULATION SUCCESS!");
      console.log("   Nonce:", result);
      console.log("");
      console.log("🎉 All checks passed! Contract should work.");
    } catch (simErr: any) {
      console.log("   ❌ SIMULATION FAILED!");
      console.log("   Error:", simErr.message || simErr.shortMessage);
      console.log("");
      
      console.log("   🔍 Possible causes:");
      console.log("   1. Contract is paused");
      console.log("   2. Insufficient balance/allowance");
      console.log("   3. maxFee >= amount (contract requirement violated)");
      console.log("   4. Invalid hookData format");
      console.log("   5. destinationDomain not supported");
      console.log("   6. Internal contract logic issue");
      console.log("");
      console.log("   💡 Suggestions:");
      console.log("   - Try with a larger amount (>= 2 USDC)");
      console.log("   - Make sure wallet has USDC and has approved Router");
      console.log("   - Check if contract is paused on blockchain explorer");
    }
    } // Close if statement for simulation

  } catch (err: any) {
    console.error("\n❌ Fatal Error:", err.message);
    console.error(err);
  }
}

console.log("═".repeat(60));
console.log("  ARC BRIDGE - DEBUG TOOL");
console.log("═".repeat(60));
console.log("");

debugBridge().catch(console.error);