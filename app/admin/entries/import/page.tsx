"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import { AlertTriangle, ArrowLeft, Check, RefreshCw, Upload } from "lucide-react";

interface Model { id: string; name: string; api_key: string }
interface RowResult { index: number; ok: boolean; errors: string[]; entryId?: string }

export default function ImportEntriesPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [raw, setRaw] = useState("[\n  { }\n]");
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [committed, setCommitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { void fetch("/api/models").then((r) => r.json()).then((b) => setModels(b.data || [])); }, []);

  function parseRows(): Record<string, unknown>[] | null {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) { setError("Import data must be a JSON array of row objects"); return null; }
      return parsed;
    } catch {
      setError("Could not parse JSON — check the syntax");
      return null;
    }
  }

  async function run(dryRun: boolean) {
    setError(""); if (!modelId) { setError("Choose a content model first"); return; }
    const rows = parseRows(); if (!rows) return;
    setBusy(true);
    try {
      const res = await fetch("/api/entries/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId, rows, dryRun }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Import failed");
      setResults(body.data.results);
      setCommitted(!dryRun);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const failed = results?.filter((r) => !r.ok).length ?? 0;
  const succeeded = results?.filter((r) => r.ok).length ?? 0;

  return (
    <AdminLayout>
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex items-center gap-4 border-b border-subtle pb-5">
          <Link href="/admin/entries" className="rounded-lg border border-subtle p-2 text-fg-muted"><ArrowLeft size={17} /></Link>
          <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-action">Data studio / Import</p><h1 className="mt-1 text-3xl font-extrabold">IMPORT RECORDS</h1></div>
        </header>
        <p className="text-sm text-fg-muted">Paste a JSON array of row objects keyed by field name. Every row runs through the same validation, uniqueness, and relation checks a manual save would — dry run first to review errors, then commit.</p>

        <section className="rounded-2xl border border-subtle bg-surface-1 p-6">
          <label className="text-xs font-bold uppercase tracking-wider text-fg-muted">
            Content model
            <select value={modelId} onChange={(e) => { setModelId(e.target.value); setResults(null); setCommitted(false); }} className="mt-2 w-full rounded-lg border border-default bg-field px-3.5 py-3 text-sm text-fg-primary outline-none">
              <option value="">Select a model…</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.api_key})</option>)}
            </select>
          </label>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-fg-muted">
            Rows (JSON array)
            <textarea value={raw} onChange={(e) => { setRaw(e.target.value); setResults(null); setCommitted(false); }} rows={12} className="mt-2 w-full resize-y rounded-lg border border-default bg-field px-3.5 py-3 font-mono text-xs text-fg-primary outline-none" />
          </label>
          <div className="mt-4 flex items-center gap-3">
            <button type="button" disabled={busy} onClick={() => void run(true)} className="inline-flex items-center gap-2 rounded-lg border border-action/25 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-action disabled:opacity-50">{busy ? <RefreshCw size={14} className="animate-spin" /> : null} Dry run</button>
            <button type="button" disabled={busy || !results || failed > 0 || committed} onClick={() => void run(false)} className="inline-flex items-center gap-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50"><Upload size={14} /> Commit import</button>
          </div>
        </section>

        {error && <div className="rounded-xl border border-danger bg-danger-muted p-4 text-sm text-danger">{error}</div>}

        {results && (
          <section className="rounded-2xl border border-subtle bg-surface-1 p-6">
            <div className="mb-4 flex items-center gap-3 text-sm">
              {committed ? <Check size={16} className="text-success" /> : <AlertTriangle size={16} className="text-warning" />}
              <span className="font-bold text-fg-primary">{committed ? "Import committed" : "Dry run complete"}</span>
              <span className="text-fg-muted">{succeeded} would pass{committed ? "" : ", "}{!committed && `${failed} would fail`}</span>
            </div>
            <div className="space-y-2">
              {results.map((row) => (
                <div key={row.index} className={`rounded-lg border px-3 py-2 text-xs ${row.ok ? "border-success bg-success-muted text-success" : "border-danger bg-danger-muted text-danger"}`}>
                  <span className="font-mono">Row {row.index + 1}</span> — {row.ok ? (row.entryId ? `created ${row.entryId}` : "valid") : row.errors.join("; ")}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}
