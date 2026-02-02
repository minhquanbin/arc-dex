import { createPublicClient, http, parseUnits, getAddress } from "viem";

// Router ABI
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

async function debugBridge() {
  console.log("🔍 DEBUGGING ROUTER CONTRACT\n");
  console.log("📡 RPC:", ARC_RPC);
  console.log("🔗 Router:", ROUTER);
  console.log("");

  try {
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

    console.log("2️⃣ Testing with sample parameters...");
    const testAmount = parseUnits("5", 6);
    const testDomain = 3;
    const serviceFee = parseUnits("0.01", 6);

    let testRecipient: `0x${string}`;
    const inputAddress = process.argv[2];

    if (inputAddress) {
      try {
        testRecipient = getAddress(inputAddress) as `0x${string}`;
        console.log("   Using provided address:", testRecipient);
      } catch {
        console.log("   ❌ Invalid address provided, using null address");
        testRecipient = "0x0000000000000000000000000000000000000000";
      }
    } else {
      testRecipient = "0x0000000000000000000000000000000000000000";
      console.log("   💡 No address provided, using null address (config test only)");
      console.log("   💡 To test with your wallet: npx tsx debug-bridge.ts YOUR_ADDRESS");
    }

    const testMaxFee = parseUnits("0.22", 6);
    const minFinality = 1000;

    console.log("   Bridge Amount:", testAmount.toString(), `(${Number(testAmount) / 1e6} USDC)`);
    console.log("   Service Fee:", serviceFee.toString(), `(${Number(serviceFee) / 1e6} USDC)`);
    console.log("   Total Required:", (testAmount + serviceFee).toString(), `(${Number(testAmount + serviceFee) / 1e6} USDC)`);
    console.log("   Domain:", testDomain, "(Arbitrum Sepolia)");
    console.log("   MaxFee:", testMaxFee.toString(), `(${Number(testMaxFee) / 1e6} USDC)`);
    console.log("   MinFinality:", minFinality);
    console.log("");

    console.log("3️⃣ Validating maxFee < amount...");
    if (testMaxFee >= testAmount) {
      console.log("   ❌ ERROR: maxFee >= amount!");
      console.log("   Contract requires: maxFee < amount");
      console.log("   Current: maxFee =", Number(testMaxFee) / 1e6, "USDC, amount =", Number(testAmount) / 1e6, "USDC");
      console.log("");
    } else {
      console.log("   ✅ maxFee < amount OK!");
      console.log("   Difference:", Number(testAmount - testMaxFee) / 1e6, "USDC");
      console.log("");
    }

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

        const totalNeeded = testAmount + serviceFee;
        console.log("   Total needed:", Number(totalNeeded) / 1e6, "USDC (bridge amount + 0.01 service fee)");

        if (balance < totalNeeded) {
          console.log("   ❌ Insufficient balance!");
        } else {
          console.log("   ✅ Balance sufficient");
        }

        if (allowance < totalNeeded) {
          console.log("   ⚠️  Need to approve", Number(totalNeeded) / 1e6, "USDC to Router");
        } else {
          console.log("   ✅ Allowance sufficient");
        }
        console.log("");
      } catch (balErr: any) {
        console.log("   ⚠️  Could not check balance:", balErr.message);
        console.log("");
      }
    }

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
          args: [testAmount, testDomain, addressToBytes32(testRecipient), testMaxFee, minFinality, HOOK_DATA],
          account: userAddress,
        });
        console.log("   ✅ SIMULATION SUCCESS!");
        console.log("   Nonce:", result);
        console.log("");
        console.log("🎉 All checks passed! Router contract should work.");
        console.log("");
        console.log("📝 Next steps:");
        console.log("   1. Make sure you have enough USDC balance");
        console.log("   2. Approve Router to spend your USDC");
        console.log("   3. Call bridge() function via dApp UI");
      } catch (simErr: any) {
        console.log("   ❌ SIMULATION FAILED!");
        console.log("   Error:", simErr.message || simErr.shortMessage);
        console.log("");
        console.log("   🔍 Possible causes:");
        console.log("   1. Router contract is paused");
        console.log("   2. Insufficient balance/allowance");
        console.log("   3. maxFee >= amount (contract requirement violated)");
        console.log("   4. Invalid hookData format");
        console.log("   5. destinationDomain not supported");
        console.log("   6. Service fee not configured correctly");
        console.log("");
        console.log("   💡 Suggestions:");
        console.log("   - Try with a larger amount (>= 2 USDC)");
        console.log("   - Make sure wallet has USDC and has approved Router");
        console.log("   - Check if contract is paused on blockchain explorer");
        console.log("   - Verify service fee is configured correctly in contract");
      }
    }
  } catch (err: any) {
    console.error("\n❌ Fatal Error:", err.message);
    console.error(err);
  }
}

console.log("═".repeat(60));
console.log("  ARC ROUTER - DEBUG TOOL");
console.log("═".repeat(60));
console.log("");

debugBridge().catch(console.error);