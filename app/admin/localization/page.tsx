"use client";

import { useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { Check, Languages, Loader2, Plus, Save } from "lucide-react";

type LocaleRow = { id: string; locale: string; enabled: boolean; required: boolean; is_default: boolean; fallback_locale: string | null };

export default function LocalizationPage() {
  const [rows, setRows] = useState<LocaleRow[]>([]);
  const [newLocale, setNewLocale] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/locales"); const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load locales");
      setRows(body.data || []);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load locales"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (row: Partial<LocaleRow> & { locale: string }) => {
    setBusyKey(row.locale); setError(""); setNotice("");
    try {
      const res = await fetch("/api/locales", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: row.locale, enabled: row.enabled ?? true, required: row.required ?? false, isDefault: row.is_default ?? false, fallbackLocale: row.fallback_locale ?? null }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error || "Could not configure locale");
      setNotice(`${row.locale} locale policy saved.`); setNewLocale(""); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not configure locale"); }
    finally { setBusyKey(""); }
  };

  const patchRow = (locale: string, patch: Partial<LocaleRow>) => setRows((current)=>current.map((row)=>row.locale===locale?{...row,...patch}:row));

  return <AdminLayout><div className="ui-page mx-auto max-w-5xl">
    <header className="ui-page-header"><p className="ui-eyebrow">Content operations / Localization</p><h1 className="ui-page-title">LOCALE POLICY</h1><p className="ui-page-description">Configure enabled and required locales, the workspace default, and deterministic fallback chains. Translation freshness remains tied to source versions.</p></header>
    {error && <div className="ui-alert ui-alert-danger mt-5">{error}</div>}
    {notice && <div className="ui-alert ui-alert-success mt-5">{notice}</div>}
    <section className="ui-section"><div className="flex items-center gap-2"><Plus size={15} className="text-review"/><h2 className="ui-section-title">Add locale</h2></div><div className="mt-4 flex flex-wrap gap-3"><input value={newLocale} onChange={(e)=>setNewLocale(e.target.value)} placeholder="hi or en-IN" className="min-w-48 flex-1 rounded-lg border border-subtle bg-field px-3 py-2.5 text-sm text-fg-primary outline-none"/><button type="button" disabled={!newLocale.trim()||Boolean(busyKey)} onClick={()=>void save({locale:newLocale.trim(),enabled:true,required:false,is_default:false,fallback_locale:rows.find((row)=>row.is_default)?.locale||null})} className="ui-btn ui-btn-primary"><Plus size={13}/> Add enabled locale</button></div><p className="mt-2 text-[11px] text-fg-muted">Use a BCP-47 code such as en, hi, de, or en-IN. Fallback cycles are rejected at the database boundary.</p></section>
    <section className="ui-section"><div className="flex items-center justify-between"><div><p className="ui-eyebrow">Workspace locales</p><h2 className="ui-section-title">Publishing readiness policy</h2></div><Languages className="text-fg-muted" size={20}/></div>{loading?<div className="flex min-h-40 items-center justify-center text-fg-muted"><Loader2 className="animate-spin"/></div>:<div className="mt-5 space-y-3">{rows.map((row)=><div key={row.locale} className="border-t border-subtle py-4 first:border-t-0"><div className="grid gap-4 lg:grid-cols-[110px_1fr_auto]"><div><span className="font-mono text-lg font-bold text-fg-primary">{row.locale}</span>{row.is_default&&<span className="ml-2 rounded-full border border-action/30 px-2 py-0.5 text-[9px] font-bold uppercase text-action">default</span>}</div><div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-xs text-fg-secondary"><input type="checkbox" checked={row.enabled} disabled={row.is_default} onChange={(e)=>patchRow(row.locale,{enabled:e.target.checked})}/> Enabled</label><label className="flex items-center gap-2 text-xs text-fg-secondary"><input type="checkbox" checked={row.required} onChange={(e)=>patchRow(row.locale,{required:e.target.checked})}/> Required for coordinated releases</label><label className="flex items-center gap-2 text-xs text-fg-secondary"><input type="checkbox" checked={row.is_default} onChange={(e)=>patchRow(row.locale,{is_default:e.target.checked,enabled:true})}/> Workspace default</label><label className="text-[10px] uppercase tracking-wider text-fg-muted">Fallback <select value={row.fallback_locale||""} disabled={row.is_default} onChange={(e)=>patchRow(row.locale,{fallback_locale:e.target.value||null})} className="ml-2 rounded-lg border border-subtle bg-canvas px-2 py-1.5 text-xs normal-case text-fg-secondary"><option value="">None</option>{rows.filter((candidate)=>candidate.enabled&&candidate.locale!==row.locale).map((candidate)=><option key={candidate.locale} value={candidate.locale}>{candidate.locale}{candidate.is_default?" · default":""}</option>)}</select></label></div><button type="button" disabled={busyKey===row.locale} onClick={()=>void save(row)} className="ui-btn ui-btn-secondary h-fit text-[10px] uppercase tracking-wider">{busyKey===row.locale?<Loader2 size={12} className="animate-spin"/>:<Save size={12}/>} Save</button></div>{row.required&&<p className="mt-3 inline-flex items-center gap-1.5 text-[10px] text-success"><Check size={11}/> A release targeting this locale is blocked until current reviewed translations are included.</p>}</div>)}</div>}</section>
  </div></AdminLayout>;
}
