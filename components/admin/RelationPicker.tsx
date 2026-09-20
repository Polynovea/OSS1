"use client";

import { useEffect, useState } from "react";
import type { FieldDefinition } from "@/lib/schema/fields/types";

interface EntryOption { id: string; label: string; status: string }

/** A real relation picker (V2 §13 Phase 3) fed by GET /api/models/:id/entries/options — replaces free-typed entry ids. */
export default function RelationPicker({ field, value, onChange }: { field: FieldDefinition; value: unknown; onChange: (value: unknown) => void }) {
  const [options, setOptions] = useState<EntryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const isMulti = field.relation?.cardinality === "one_to_many" || field.relation?.cardinality === "many_to_many";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true); setError("");
      try {
        if (!field.relation?.targetModelApiKey) { setOptions([]); return; }
        const modelsRes = await fetch("/api/models");
        const modelsBody = await modelsRes.json();
        if (!modelsRes.ok) throw new Error(modelsBody.error || "Could not load target model");
        const target = (modelsBody.data || []).find((m: { api_key: string }) => m.api_key === field.relation!.targetModelApiKey);
        if (!target) { if (!cancelled) { setOptions([]); setError("Target model not found"); } return; }
        const optionsRes = await fetch(`/api/models/${target.id}/entries/options`);
        const optionsBody = await optionsRes.json();
        if (!optionsRes.ok) throw new Error(optionsBody.error || "Could not load related entries");
        if (!cancelled) setOptions(optionsBody.data || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load related entries");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [field.relation?.targetModelApiKey]);

  const selectClass = "mt-2 w-full rounded-lg border border-default bg-field px-3 py-2.5 text-sm text-fg-primary outline-none focus:border-action/50";

  if (error) return <p className="mt-2 text-xs text-danger">{error}</p>;

  return (
    <select
      required={field.required}
      multiple={isMulti}
      disabled={loading}
      value={isMulti ? (Array.isArray(value) ? value.map(String) : []) : String(value ?? "")}
      onChange={(e) => onChange(isMulti ? Array.from(e.target.selectedOptions).map((option) => option.value) : e.target.value || undefined)}
      className={selectClass}
    >
      {!isMulti && <option value="">{loading ? "Loading…" : "Select an entry…"}</option>}
      {options.map((option) => (
        <option key={option.id} value={option.id}>{option.label} {option.status !== "published" ? `(${option.status})` : ""}</option>
      ))}
    </select>
  );
}
