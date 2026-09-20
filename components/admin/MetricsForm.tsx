"use client";

import { useState, useEffect } from "react";
import { z } from "zod";
import type { LiveMetric } from "@/lib/admin/types";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { showToast } from "./Toast";
import { Save, TrendingUp, TrendingDown, Plus, Trash2 } from "lucide-react";

const metricSchema = z.object({
  label: z.string().min(5, "Label must be at least 5 characters").max(50),
  value: z.string().min(1, "Value is required"),
  period: z.string().min(1, "Period is required"),
  trend: z.string().regex(/^[+-]?\d+(\.\d+)?%$/, "Format: +12.5% or -5%"),
  trendDirection: z.enum(["up", "down"]),
});

type MetricFormData = z.infer<typeof metricSchema>;
type MetricRow = MetricFormData & { id?: number; key: string };

let rowKeySeq = 0;
const newRowKey = () => `new-${++rowKeySeq}`;
const emptyRow = (): MetricRow => ({
  key: newRowKey(), label: "", value: "", period: "", trend: "", trendDirection: "up",
});

interface MetricsFormProps {
  metrics: LiveMetric[];
  onSuccess: () => void;
}

// Reusable styled field
function Field({
  label, value, onChange, placeholder, error, type = "text",
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; error?: string; type?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[9px] font-bold text-fg-muted tracking-[0.12em] uppercase">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`w-full box-border bg-field text-fg-primary rounded-lg px-3 py-2 text-xs font-medium outline-none transition-all duration-150 border ${
          focused ? "border-action/40 shadow-[0_0_8px_rgba(230,211,163,0.08)]" : error ? "border-danger" : "border-subtle"
        }`}
      />
      {error && <span className="text-[10px] text-danger mt-0.5">{error}</span>}
    </div>
  );
}

export default function MetricsForm({ metrics, onSuccess }: MetricsFormProps) {
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [errors, setErrors] = useState<Partial<Record<number, Record<string, string>>>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setRows(metrics.map((m) => ({
      key: `existing-${m.id}`,
      id: m.id,
      label: m.label,
      value: m.value,
      period: m.period,
      trend: m.trend,
      trendDirection: m.trendDirection,
    })));
    setErrors({});
  }, [metrics]);

  const updateField = (index: number, field: keyof MetricFormData, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      if (next[index]) {
        const row = { ...next[index] };
        delete row[field];
        next[index] = row;
      }
      return next;
    });
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
  };

  const handleRemoveRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setErrors((prev) => {
      const next: typeof prev = {};
      Object.entries(prev).forEach(([i, val]) => {
        const idx = Number(i);
        if (idx < index) next[idx] = val;
        else if (idx > index) next[idx - 1] = val;
      });
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const allErrors: Partial<Record<number, Record<string, string>>> = {};
    let hasError = false;

    rows.forEach((row, i) => {
      const result = metricSchema.safeParse(row);
      if (!result.success) {
        hasError = true;
        const rowErrors: Record<string, string> = {};
        result.error.errors.forEach((err) => { rowErrors[err.path[0] as string] = err.message; });
        allErrors[i] = rowErrors;
      }
    });

    if (hasError) {
      setErrors(allErrors);
      showToast("Please fix the form errors.", "error");
      return;
    }

    setSubmitting(true);
    try {
      const payload = rows.map(({ key, ...rest }) => rest);
      const res = await fetch("/api/content/live-metrics", {
        method: "PUT",
        headers: await getAuthHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Update failed");
      showToast("Metrics updated.", "success");
      onSuccess();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Update failed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {rows.map((form, i) => {
        const isUp = form.trendDirection === "up";
        return (
          <div
            key={form.key}
            className="bg-surface-1 border border-subtle hover:border-action/25 rounded-[14px] overflow-hidden transition-colors duration-200"
          >
            <div className="flex items-center gap-3 px-5 py-3.5 bg-field border-b border-subtle">
              <div className="w-[26px] h-[26px] rounded-lg shrink-0 bg-action/10 border border-action/15 flex items-center justify-center text-[11px] font-extrabold text-action">
                {i + 1}
              </div>
              <span className="font-bold text-[13px] text-fg-primary flex-1">
                {form.label || "New Metric"}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-extrabold text-fg-primary">
                  {form.value || "—"}
                </span>
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                  isUp ? "text-green-500 bg-success-muted border-success" : "text-danger bg-danger-muted border-danger"
                }`}>
                  {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {form.trend || "0%"}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveRow(i)}
                  title="Remove metric"
                  className="text-fg-muted hover:text-danger transition-colors p-1 flex cursor-pointer bg-transparent border-none"
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            <div className="p-5 grid grid-cols-[2fr_1fr_1fr] gap-3.5">
              <Field
                label="Label"
                value={form.label}
                onChange={(v) => updateField(i, "label", v)}
                placeholder="e.g. Total Reach"
                error={errors[i]?.label}
              />
              <Field
                label="Value"
                value={form.value}
                onChange={(v) => updateField(i, "value", v)}
                placeholder="e.g. 1.4M"
                error={errors[i]?.value}
              />
              <Field
                label="Period"
                value={form.period}
                onChange={(v) => updateField(i, "period", v)}
                placeholder="e.g. Last 30 Days"
                error={errors[i]?.period}
              />
              <Field
                label="Trend"
                value={form.trend}
                onChange={(v) => updateField(i, "trend", v)}
                placeholder="+12.5%"
                error={errors[i]?.trend}
              />
              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="text-[9px] font-bold text-fg-muted tracking-[0.12em] uppercase">
                  Direction
                </label>
                <div className="flex gap-2">
                  {(["up", "down"] as const).map((dir) => {
                    const active = form.trendDirection === dir;
                    const isGreen = dir === "up";
                    return (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => updateField(i, "trendDirection", dir)}
                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg cursor-pointer text-[11px] font-bold tracking-[0.04em] uppercase border transition-all duration-150 ${
                          active
                            ? isGreen
                              ? "border-success bg-success-muted text-green-500"
                              : "border-danger bg-danger-muted text-danger"
                            : "border-subtle bg-transparent text-fg-muted hover:text-fg-secondary"
                        }`}
                      >
                        {dir === "up" ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                        {dir === "up" ? "Upward" : "Downward"}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={handleAddRow}
        className="flex items-center justify-center gap-2 px-5 py-3 rounded-[14px] border border-dashed border-subtle hover:border-action/40 text-fg-muted hover:text-action text-[11px] font-bold tracking-[0.06em] uppercase transition-colors duration-150 cursor-pointer bg-transparent"
      >
        <Plus size={14} strokeWidth={2} />
        Add Metric
      </button>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-action text-[#0A0A0A] text-[11px] font-extrabold tracking-[0.06em] uppercase hover:opacity-90 transition-all duration-150 shadow-[0_0_20px_rgba(230,211,163,0.15)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save size={14} strokeWidth={2} />
          {submitting ? "Saving..." : "Update All Metrics"}
        </button>
      </div>
    </form>
  );
}
