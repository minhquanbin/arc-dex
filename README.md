# Arc Bridge DApp - Refactored Structure

## 📁 New Project Structure

```
arc-bridge-dapp/
├── app/
│   ├── layout.tsx          # Root layout (unchanged)
│   ├── page.tsx            # ✨ NEW: Main shell with tab routing
│   ├── providers.tsx       # Wagmi/RainbowKit providers (unchanged)
│   └── globals.css         # Global styles (unchanged)
│
├── components/
│   └── tabs/               # ✨ NEW: Modular tab components
│       ├── BridgeTab.tsx   # Bridge functionality (extracted)
│       └── IssuanceTab.tsx # ✨ NEW: Stablecoin issuance
│
├── lib/
│   ├── chains.ts           # Chain configurations (unchanged)
│   ├── cctp.ts             # CCTP bridge utilities (unchanged)
│   └── stablecoin.ts       # ✨ NEW: Stablecoin utilities & ABIs
│
├── public/                 # Static assets (unchanged)
├── package.json
├── tsconfig.json
└── next.config.ts
```

---

## 🎯 Key Changes

### 1. **Modular Architecture**
- **Before**: All logic in `app/page.tsx` (~900 lines)
- **After**: Split into separate, maintainable modules:
  - `app/page.tsx` (200 lines) - Main shell
  - `components/tabs/BridgeTab.tsx` (400 lines) - Bridge logic
  - `components/tabs/IssuanceTab.tsx` (300 lines) - Issuance logic
  - `lib/stablecoin.ts` (200 lines) - Shared utilities

### 2. **New Features**
- **Issuance Tab**: Deploy & mint custom stablecoins on ARC Testnet
  - Based on `stablecoin-auto.js` logic
  - Full ERC-20 functionality (mint, burn, freeze, pause)
  - Compatible with Circle CCTP bridging
  - Built on thirdweb's audited contracts

### 3. **Benefits**
- ✅ **Easy to maintain**: Each feature is self-contained
- ✅ **Easy to extend**: Add new tabs without touching existing code
- ✅ **Easy to debug**: Isolated concerns, clear boundaries
- ✅ **Easy to test**: Mock individual components
- ✅ **Better DX**: Clear file structure, logical organization

---

## 🚀 How to Use

### Development
```bash
npm install
npm run dev
```

### Build
```bash
npm run build
npm start
```

### Environment Variables
```bash
# Required
NEXT_PUBLIC_ARC_CHAIN_ID=5042002
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.testnet.arc.network
NEXT_PUBLIC_ARC_ROUTER=0xEc02A909701A8eB9C84B93b55B6d4A7ca215CFca
NEXT_PUBLIC_ARC_USDC=0x3600000000000000000000000000000000000000

# Optional
NEXT_PUBLIC_FEE_COLLECTOR=0xA87Bd559fd6F2646225AcE941bA6648Ec1BAA9AF
NEXT_PUBLIC_FEE_USDC=0.01
NEXT_PUBLIC_MAX_FEE_BPS=500
NEXT_PUBLIC_MIN_FINALITY_THRESHOLD=1000
```

---

## 📝 Migration Guide

### If you were using the old `app/page.tsx`:

1. **Replace** your `app/page.tsx` with the new one
2. **Add** `components/tabs/BridgeTab.tsx`
3. **Add** `components/tabs/IssuanceTab.tsx`
4. **Add** `lib/stablecoin.ts`
5. **Keep** all other files unchanged

### Adding New Tabs

1. Create `components/tabs/YourTab.tsx`:
```tsx
export default function YourTab() {
  return (
    <div className="space-y-6">
      {/* Your tab content */}
    </div>
  );
}
```

2. Import in `app/page.tsx`:
```tsx
import YourTab from "@/components/tabs/YourTab";
```

3. Add to tab array:
```tsx
const tabs = ["bridge", "issuance", "your-feature"] as const;
```

4. Add to content section:
```tsx
{tab === "your-feature" && <YourTab />}
```

---

## 🔍 Code Organization Principles

### **Separation of Concerns**
- **UI Components** (`components/`) - Presentation logic only
- **Business Logic** (`lib/`) - Reusable utilities & functions
- **Routing** (`app/`) - Next.js app structure

### **Single Responsibility**
- Each component does ONE thing well
- Each file has a clear, specific purpose
- Easy to understand at a glance

### **DRY (Don't Repeat Yourself)**
- Shared utilities in `lib/`
- Reusable components in `components/`
- Config in environment variables

---

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Blockchain**: Wagmi v2 + Viem v2
- **Wallet**: RainbowKit v2
- **Styling**: Tailwind CSS v4
- **Language**: TypeScript 5

---

## 📦 Dependencies

### Core
- `next@16.1.6` - React framework
- `react@19.2.3` - UI library
- `wagmi@^2.19.5` - Ethereum hooks
- `viem@^2.45.1` - Ethereum client
- `@rainbow-me/rainbowkit@^2.2.10` - Wallet connection

### Build Tools
- `typescript@^5` - Type safety
- `tailwindcss@^4` - Styling
- `eslint@^9` - Linting

---

## 🎨 Styling

All components use:
- **Tailwind utility classes** for styling
- **Custom CSS** in `app/globals.css`
- **Inline styles** for dynamic values
- **Color scheme**: `#ff7582` (pink) → `#725a7a` (purple)

---

## 🔐 Security Notes

### Stablecoin Deployment
- **Bytecode**: Currently placeholder - must compile real contract
- **Admin roles**: Use multisig for production
- **Audits**: Required before mainnet deployment

### Bridge
- **CCTP integration**: Follows Circle's official specs
- **Fee validation**: Prevents overpayment attacks
- **Balance checks**: Prevents insufficient fund errors

---

## 📚 Resources

- [Circle CCTP Docs](https://developers.circle.com/cctp)
- [ARC Testnet Explorer](https://testnet.arcscan.app)
- [Wagmi Documentation](https://wagmi.sh)
- [Next.js App Router](https://nextjs.org/docs/app)

---

## 🤝 Contributing

When adding new features:
1. Create a new file in `components/tabs/`
2. Add shared logic to `lib/`
3. Update `app/page.tsx` to import the new tab
4. Keep files under 400 lines each
5. Document your code with JSDoc comments

---

## 📄 License

MIT

---

## 💬 Support

For issues or questions:
- Open a GitHub issue
- Contact: 1992evm (X)
- Donate: `0xA87Bd559fd6F2646225AcE941bA6648Ec1BAA9AF`