"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import { ArrowLeft, Check, Languages, Loader2, Rocket } from "lucide-react";

type Entry = { id: string; content_model_id: string; status: string; current_draft_version_id: string | null };
type Locale = { locale: string; enabled: boolean; required: boolean; is_default: boolean };

export default function NewReleasePage() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [locales, setLocales] = useState<Locale[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedLocales, setPickedLocales] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetch("/api/entries"), fetch("/api/locales")]).then(async ([entriesRes, localesRes]) => {
      const [entriesBody, localesBody] = await Promise.all([entriesRes.json(), localesRes.json()]);
      if (!entriesRes.ok) throw new Error(entriesBody.error || "Could not load approved entries");
      if (!localesRes.ok) throw new Error(localesBody.error || "Could not load locales");
      const available = (entriesBody.data || []).filter((entry: Entry) => entry.status === "approved" && entry.current_draft_version_id);
      const enabled = (localesBody.data || []).filter((locale: Locale) => locale.enabled);
      setEntries(available); setLocales(enabled); setPickedLocales(enabled.filter((locale: Locale)=>locale.required||locale.is_default).map((locale: Locale)=>locale.locale));
    }).catch((err)=>setError(err.message||"Could not load release inputs")).finally(()=>setLoading(false));
  }, []);

  const create = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/releases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, itemVersionIds: picked, locales: pickedLocales }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error || "Could not create release");
      router.push(`/admin/releases/${body.data.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create release"); }
    finally { setBusy(false); }
  };
  const toggle = (versionId: string) => setPicked((current)=>current.includes(versionId)?current.filter((id)=>id!==versionId):[...current,versionId]);
  const toggleLocale = (locale: Locale) => {
    if (locale.required) return;
    setPickedLocales((current)=>current.includes(locale.locale)?current.filter((item)=>item!==locale.locale):[...current,locale.locale]);
  };

  return <AdminLayout><div className="mx-auto max-w-4xl"><header className="flex items-center gap-4 border-b border-subtle pb-5"><Link href="/admin/releases" className="rounded-lg border border-subtle p-2 text-fg-muted"><ArrowLeft size={17}/></Link><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-action">Publishing control plane / New</p><h1 className="mt-1 text-3xl font-extrabold">CREATE RELEASE</h1></div></header>
    {error&&<div className="mt-5 rounded-xl border border-danger bg-danger-muted p-4 text-sm text-danger">{error}</div>}
    <div className="mt-7 space-y-5"><label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted">Release name<input value={name} onChange={(e)=>setName(e.target.value)} placeholder="September Website Release" className="mt-2 w-full rounded-lg border border-default bg-field px-3 py-2.5 text-sm text-fg-primary outline-none"/></label><label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted">Purpose<textarea value={description} onChange={(e)=>setDescription(e.target.value)} rows={2} className="mt-2 w-full resize-none rounded-lg border border-default bg-field px-3 py-2.5 text-sm text-fg-primary outline-none"/></label>
      <section className="rounded-2xl border border-subtle bg-surface-1 p-5"><div className="flex items-center justify-between"><div><h2 className="font-bold">Approved entry versions</h2><p className="mt-1 text-xs text-fg-muted">Release items are exact version pins. Drift after approval blocks publication.</p></div><span className="text-xs font-bold text-action">{picked.length} selected</span></div>{loading?<div className="flex justify-center py-8 text-fg-muted"><Loader2 className="animate-spin"/></div>:entries.length===0?<p className="py-8 text-center text-sm text-fg-muted">No approved entries are available yet.</p>:<div className="mt-4 grid gap-2 sm:grid-cols-2">{entries.map((entry)=><button type="button" key={entry.id} onClick={()=>toggle(entry.current_draft_version_id!)} className={`flex items-center justify-between rounded-lg border px-3 py-3 text-left ${picked.includes(entry.current_draft_version_id!)?"border-action/40 bg-action/8":"border-subtle bg-field"}`}><span><span className="block font-mono text-xs text-fg-secondary">entry:{entry.id.slice(0,8)}</span><span className="mt-1 block text-[10px] uppercase tracking-wider text-fg-muted">Approved current version</span></span>{picked.includes(entry.current_draft_version_id!)&&<Check size={16} className="text-action"/>}</button>)}</div>}</section>
      <section className="rounded-2xl border border-review bg-review-muted p-5"><div className="flex items-center gap-2"><Languages size={15} className="text-review"/><div><h2 className="font-bold">Coordinated locales</h2><p className="mt-1 text-xs text-fg-muted">Required locales cannot be removed. Readiness checks translation freshness and inclusion.</p></div></div><div className="mt-4 flex flex-wrap gap-2">{locales.map((locale)=><button key={locale.locale} type="button" onClick={()=>toggleLocale(locale)} className={`rounded-full border px-3 py-1.5 text-xs ${pickedLocales.includes(locale.locale)?"border-review bg-review-muted text-violet-200":"border-subtle text-fg-muted"}`}><span className="font-mono">{locale.locale}</span>{locale.required?" · required":locale.is_default?" · default":""}</button>)}</div></section>
      <button disabled={busy||!name.trim()||picked.length===0} onClick={()=>void create()} className="inline-flex items-center gap-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50"><Rocket size={14}/>{busy?"Creating…":"Create draft release"}</button>
    </div>
  </div></AdminLayout>;
}
