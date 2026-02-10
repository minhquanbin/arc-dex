"use client";

import { useState } from "react";
import BatchPayment from "@/components/payments/BatchPayment";
import RecurringPayment from "@/components/payments/RecurringPayment";
import StreamingPayment from "@/components/payments/StreamingPayment";

type PaymentMode = "batch" | "recurring" | "streaming";

export default function PaymentsTab() {
  const [mode, setMode] = useState<PaymentMode>("batch");

  const USDC_LOGO_SRC = "/chain-icons/usdc.svg"; // icon used inside cards

  const modes = [
    {
      id: "batch" as const,
      title: "Batch Pay",
      description: "Pay multiple recipients instantly",
      features: ["CSV upload", "Multi-send", "Templates", "Instant settlement"],
      status: "",
      
    },
    {
      id: "recurring" as const,
      title: "Recurring Pay",
      description: "Automated scheduled payments",
      features: ["Set & forget", "Weekly/Monthly", "Auto-execute", "Predictable"],
      status: "",
      
    },
    {
      id: "streaming" as const,
      title: "Stream Pay",
      description: "Salary flows every second",
      features: ["Per-second pay", "Instant claim", "Token vesting", "Escrow"],
      status: "",
      
    },
  ];

  const currentMode = modes.find((m) => m.id === mode);

  return (
    <div className="payments-scope space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <img src="/chain-icons/payment.svg" alt="Payments" className="h-8 w-8" />
          <h1 className="text-3xl font-bold">Payments</h1>
        </div>
      </div>

      {/* Mode Selection */}
      <div className="arc-card-light p-4 space-y-4 border-2 border-[#ff7582]/40 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700">Payment Options</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`
                p-6 rounded-xl border-2 transition-all text-left shadow-sm
                ${
                  mode === m.id
                    ? "border-[#ff7582]/70 bg-gradient-to-br from-[#ff7582]/18 to-[#725a7a]/12"
                    : "border-gray-300 bg-white hover:border-[#ff7582]/50"
                }
              `}
            >
              {/* Logo & Status */}
              <div className="flex items-start justify-between mb-3">
                <img src={USDC_LOGO_SRC} alt="USDC" className="h-10 w-10" />
                {m.status ? (
                  <span className="text-xs px-2 py-1 bg-white/10 rounded-full">
                    {m.status}
                  </span>
                ) : null}
              </div>
              
              <h3 className="text-lg font-bold mb-1 text-gray-900">{m.title}</h3>
              <p className="text-sm text-gray-600 mb-3">{m.description}</p>
              
              {/* Features */}
              <div className="space-y-1">
                {m.features.map((feature, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                    <img
                      src="/chain-icons/check.svg"
                      alt=""
                      aria-hidden="true"
                      className="h-3.5 w-3.5 opacity-80"
                    />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>

            </button>
          ))}
        </div>
      </div>

      {/* Active Mode Info Banner */}
      <div className="p-4 bg-gradient-to-r from-[#ff7582]/20 to-[#725a7a]/20 rounded-lg border border-[#ff7582]/30">
        <div className="flex items-start gap-3">
          <img src={USDC_LOGO_SRC} alt="USDC" className="h-8 w-8" />
          <div>
            <h3 className="font-bold text-lg mb-1">{currentMode?.title}</h3>
            <p className="text-sm text-gray-300">{currentMode?.description}</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/10" />

      {/* Dynamic Content Based on Mode */}
      {mode === "batch" && <BatchPayment />}
      {mode === "recurring" && <RecurringPayment />}
      {mode === "streaming" && <StreamingPayment />}

    </div>
  );
}
