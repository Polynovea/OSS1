"use client";

import type { Ga4Range } from "@/lib/admin/ga4";

const OPTIONS: { value: Ga4Range; label: string }[] = [
  { value: "7d", label: "7 DAYS" },
  { value: "28d", label: "28 DAYS" },
  { value: "90d", label: "90 DAYS" },
];

export default function RangeSelector({ value, onChange }: { value: Ga4Range; onChange: (r: Ga4Range) => void }) {
  return (
    <div className="flex gap-2">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-full border text-[10px] font-bold tracking-wide uppercase transition-all cursor-pointer ${
            value === opt.value
              ? "border-action/30 bg-action/8 text-action"
              : "border-subtle bg-transparent text-fg-muted hover:text-fg-secondary"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
