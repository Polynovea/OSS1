"use client";

import { Database, FileText, Rocket } from "lucide-react";
import type { ModelCapability } from "@/lib/schema/fields/types";

const OPTIONS: { value: ModelCapability; label: string; description: string; icon: typeof Database }[] = [
  { value: "data_only", label: "Data only", description: "Structured records with no publish, workflow, or route surface.", icon: Database },
  { value: "content_enabled", label: "Content-enabled", description: "Structured records with drafts and versioning, not published to a destination.", icon: FileText },
  { value: "publishable", label: "Publishable", description: "Full content-operations surface — workflow, preview, and publishing.", icon: Rocket },
];

interface CapabilitySelectorProps {
  value: ModelCapability;
  onChange: (value: ModelCapability) => void;
  disabled?: boolean;
}

export default function CapabilitySelector({ value, onChange, disabled }: CapabilitySelectorProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? "border-action/60 bg-action/5" : "border-subtle bg-field hover:border-[#3a3a40]"
            }`}
          >
            <Icon size={16} className={active ? "text-action" : "text-fg-muted"} />
            <span className={`text-xs font-bold uppercase tracking-wider ${active ? "text-action" : "text-fg-secondary"}`}>{option.label}</span>
            <span className="text-[11px] leading-4 text-fg-muted">{option.description}</span>
          </button>
        );
      })}
    </div>
  );
}
