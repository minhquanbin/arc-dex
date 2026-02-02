import { createPublicClient, http, parseUnits, getAddress } from "viem";

// Router ABI đầy đủ
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
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenMessengerV2",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "feeCollector",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "serviceFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

function addressToBytes32(address: `0x${string}`) {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as `0x${string}`;
}

const HOOK_DATA = "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;

const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.testnet.arc.network";
const ROUTER = (process.env.NEXT_PUBLIC_ARC_ROUTER || "0x82657177d3b529E008cb766475F53CeFb0d95819") as `0x${string}`;

const client = createPublicClient({
  transport: http(ARC_RPC),
});

async function debugRouterInDepth() {
  console.log("🔍 DEEP DEBUGGING ROUTER CONTRACT\n");
  console.log("📡 RPC:", ARC_RPC);
  console.log("🔗 Router:", ROUTER);
  console.log("");

  try {
    // ===== 1. Read Router configuration =====
    console.log("1️⃣ Reading Router configuration...");
    
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

    let serviceFee: bigint;
    let isPaused: boolean;

    try {
      serviceFee = await client.readContract({
        address: ROUTER,
        abi: ROUTER_ABI,
        functionName: "serviceFee",
      }) as bigint;
    } catch {
      console.log("   ⚠️  Router không có function serviceFee() - có thể hardcoded trong contract");
      serviceFee = parseUnits("0.01", 6); // Fallback
    }

    try {
      isPaused = await client.readContract({
        address: ROUTER,
        abi: ROUTER_ABI,
        functionName: "paused",
      }) as boolean;
    } catch {
      console.log("   ⚠️  Router không có function paused() - giả sử không paused");
      isPaused = false;
    }

    console.log("   ✅ Router USDC:", routerUsdc);
    console.log("   ✅ Router TokenMessenger:", routerTm);
    console.log("   ✅ Fee Collector:", feeCollector);
    console.log("   ✅ Service Fee:", Number(serviceFee) / 1e6, "USDC");
    console.log("   ✅ Paused:", isPaused);
    console.log("");

    if (isPaused) {
      console.log("❌ Router contract is PAUSED! Cannot bridge.");
      return;
    }

    // ===== 2. Test different scenarios =====
    console.log("2️⃣ Testing multiple amount scenarios...\n");

    const scenarios = [
      { amount: "1.0", domain: 3, name: "Small amount (1 USDC)" },
      { amount: "2.0", domain: 3, name: "Medium amount (2 USDC)" },
      { amount: "5.0", domain: 3, name: "Large amount (5 USDC)" },
      { amount: "10.0", domain: 3, name: "Very large (10 USDC)" },
    ];

    for (const scenario of scenarios) {
      console.log(`\n📊 Scenario: ${scenario.name}`);
      console.log("─".repeat(60));

      const amount = parseUnits(scenario.amount, 6);
      const domain = scenario.domain;

      // Calculate maxFee like auto-bridge
      const minForwardFeeUsdc = domain === 0 ? "1.25" : "0.2";
      const minForwardFee = parseUnits(minForwardFeeUsdc, 6);
      const maxFeeBps = 2000n; // 20%
      const maxFeeFromPct = (amount * maxFeeBps) / 10000n;
      let maxFee = maxFeeFromPct < minForwardFee ? minForwardFee : maxFeeFromPct;

      // Important: maxFee must be < amount
      if (maxFee >= amount) {
        maxFee = amount - 1n;
      }

      const totalWithServiceFee = amount + serviceFee;

      console.log(`   Bridge Amount: ${scenario.amount} USDC`);
      console.log(`   Service Fee: ${Number(serviceFee) / 1e6} USDC`);
      console.log(`   Total Needed: ${Number(totalWithServiceFee) / 1e6} USDC`);
      console.log(`   Calculated maxFee: ${Number(maxFee) / 1e6} USDC (${Number(maxFee * 10000n / amount) / 100}%)`);
      console.log(`   Min Forward Fee: ${Number(minForwardFee) / 1e6} USDC`);
      console.log("");

      // Check if maxFee < amount
      if (maxFee >= amount) {
        console.log(`   ❌ FAIL: maxFee (${Number(maxFee) / 1e6}) >= amount (${Number(amount) / 1e6})`);
        continue;
      }

      // CRITICAL: Check if maxFee < (amount - serviceFee)
      // Router might validate: maxFee < actualBridgeAmount (amount - serviceFee)
      const actualBridgeAmount = amount - serviceFee;
      if (maxFee >= actualBridgeAmount) {
        console.log(`   ⚠️  WARNING: maxFee (${Number(maxFee) / 1e6}) >= actualBridgeAmount (${Number(actualBridgeAmount) / 1e6})`);
        console.log(`   This could be the bug! Router might require: maxFee < (amount - serviceFee)`);
      } else {
        console.log(`   ✅ maxFee < amount: OK`);
        console.log(`   ✅ maxFee < (amount - serviceFee): OK`);
      }

      // Try different maxFee values
      console.log("\n   Testing different maxFee values:");
      
      const maxFeeTests = [
        { value: maxFee, label: "Current (20%)" },
        { value: (amount * 500n) / 10000n, label: "Conservative (5%)" },
        { value: (amount * 1000n) / 10000n, label: "Moderate (10%)" },
        { value: minForwardFee, label: "Minimum forward fee" },
        { value: (actualBridgeAmount * 500n) / 10000n, label: "5% of (amount - serviceFee)" },
      ];

      for (const test of maxFeeTests) {
        const testMaxFee = test.value;
        if (testMaxFee >= amount) {
          console.log(`   ❌ ${test.label}: ${Number(testMaxFee) / 1e6} USDC - TOO HIGH (>= amount)`);
        } else if (testMaxFee >= actualBridgeAmount) {
          console.log(`   ⚠️  ${test.label}: ${Number(testMaxFee) / 1e6} USDC - RISKY (>= actualBridgeAmount)`);
        } else {
          console.log(`   ✅ ${test.label}: ${Number(testMaxFee) / 1e6} USDC - SAFE`);
        }
      }
    }

    console.log("\n\n" + "=".repeat(60));
    console.log("🔍 ANALYSIS SUMMARY");
    console.log("=".repeat(60));

    console.log("\n🎯 SUSPECTED BUG IN ROUTER:");
    console.log("Router contract likely has this validation:");
    console.log("   require(maxFee < amount - serviceFee, 'maxFee too high')");
    console.log("\nBUT your dApp is calculating:");
    console.log("   maxFee = 20% of amount (not considering serviceFee deduction)");
    console.log("\n💡 FIX OPTIONS:");
    console.log("1. Calculate maxFee as % of (amount - serviceFee) instead of amount");
    console.log("2. Reduce MAX_FEE_BPS from 2000 (20%) to 500-1000 (5-10%)");
    console.log("3. Add hard cap: maxFee must be < (amount - serviceFee - 0.1 USDC)");

    console.log("\n\n📝 RECOMMENDED FIX:");
    console.log("In lib/cctp.ts, change computeMaxFee():");
    console.log("```typescript");
    console.log("const serviceFee = computeServiceFee();");
    console.log("const actualBridgeAmount = amount - serviceFee;");
    console.log("const maxFeeFromPct = (actualBridgeAmount * maxFeeBps) / 10000n;");
    console.log("// ... rest of logic");
    console.log("```");

  } catch (err: any) {
    console.error("\n❌ Fatal Error:", err.message);
    console.error(err);
  }
}

console.log("═".repeat(60));
console.log("  ARC ROUTER - DEEP DEBUG TOOL");
console.log("═".repeat(60));
console.log("");

debugRouterInDepth().catch(console.error);