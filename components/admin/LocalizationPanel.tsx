"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Languages, Loader2, RefreshCw } from "lucide-react";

type Locale = {
  locale: string;
  required: boolean;
  isDefault: boolean;
  fallbackLocale: string | null;
  status: "current" | "stale" | "missing" | "draft" | "in_review" | "needs_review";
  sourceLocale: string;
  translatedEntryId: string | null;
  translatedEntryStatus: string | null;
  reviewedAt: string | null;
  staleAt: string | null;
  createUrl: string | null;
};

const labels: Record<Locale["status"], string> = {
  current: "Current",
  stale: "Stale",
  missing: "Missing",
  draft: "Draft",
  in_review: "In review",
  needs_review: "Needs review",
};
const colors: Record<Locale["status"], string> = {
  current: "text-success",
  stale: "text-warning",
  missing: "text-danger",
  draft: "text-fg-secondary",
  in_review: "text-review",
  needs_review: "text-cyan-300",
};

export default function LocalizationPanel({ entryId }: { entryId: string }) {
  const [rows, setRows] = useState<Locale[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyLocale, setBusyLocale] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/entries/${entryId}/localization`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load localization state");
      setRows(body.data || []);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load localization state"); }
    finally { setLoading(false); }
  }, [entryId]);

  useEffect(() => { void load(); }, [load]);

  const review = async (locale: string) => {
    setBusyLocale(locale); setError("");
    try {
      const res = await fetch(`/api/entries/${entryId}/localization`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "review", locale }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not review translation");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not review translation"); }
    finally { setBusyLocale(""); }
  };

  return <section className="rounded-2xl border border-review bg-review-muted p-5">
    <div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-review">Locale lifecycle</p><h2 className="mt-1 text-base font-bold">Translations</h2></div><button type="button" onClick={()=>void load()} className="rounded-lg border border-subtle p-2 text-fg-secondary"><RefreshCw size={13} className={loading?"animate-spin":""}/></button></div>
    {error&&<p className="mt-3 text-xs text-danger">{error}</p>}
    {rows.length ? <div className="mt-4 space-y-2">{rows.map((row)=><div key={row.locale} className="rounded-lg border border-subtle bg-field px-3 py-2.5"><div className="flex items-center justify-between gap-3"><span className="font-mono text-xs text-fg-secondary">{row.locale}{row.isDefault?" · default":""}{row.required?" · required":""}</span><span className={`text-[10px] font-bold uppercase tracking-wider ${colors[row.status]}`}>{labels[row.status]}</span></div>{row.fallbackLocale&&<p className="mt-1 text-[10px] text-fg-muted">Fallback: {row.fallbackLocale}</p>}<div className="mt-2 flex flex-wrap gap-2">{row.createUrl&&<Link href={row.createUrl} className="inline-flex items-center gap-1 rounded-md border border-review px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-violet-200"><Languages size={10}/> Create translation</Link>}{row.translatedEntryId&&row.translatedEntryId!==entryId&&<Link href={`/admin/entries/${row.translatedEntryId}`} className="inline-flex items-center gap-1 rounded-md border border-subtle px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-fg-secondary"><ExternalLink size={10}/> Edit {row.locale}</Link>}{row.translatedEntryId&&["approved","published"].includes(row.translatedEntryStatus||"")&&row.status!=="current"&&<button type="button" disabled={busyLocale===row.locale} onClick={()=>void review(row.locale)} className="inline-flex items-center gap-1 rounded-md border border-success px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-success disabled:opacity-40">{busyLocale===row.locale?<Loader2 size={10} className="animate-spin"/>:<Check size={10}/>} Mark reviewed</button>}</div></div>)}</div> : !loading ? <p className="mt-3 text-xs text-fg-muted">No workspace locales are configured yet.</p> : null}
  </section>;
}
