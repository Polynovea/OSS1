"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, BarChart2, Bookmark, CheckCircle2, Clock3, RefreshCw, Save, Search, Stethoscope, Trash2, TrendingDown } from "lucide-react";
import AdminLayout from "@/components/admin/AdminLayout";
import { getAuthHeaders } from "@/lib/admin/authCheck";

type SearchRow = { entry_id: string; content_model_id: string; locale: string; status: string; search_text: string; updated_at: string; rank: number; similarity: number };
type SavedSearch = { id: string; owner_id: string; name: string; query_json: Record<string, unknown>; is_shared: boolean; updated_at: string };
type Connector = { id: string; provider: string; name: string; active: boolean; credential_mode: string };
type SyncState = { connector_id: string; status: string; last_attempt_at: string | null; last_success_at: string | null; fresh_through: string | null; last_error: string | null; updated_at: string };
type Snapshot = { entry_id: string; version_id: string | null; destination_url: string; period_start: string; period_end: string; page_views: number | null; users_count: number | null; engagement_seconds: number | null; metrics_json: Record<string, unknown>; data_fresh_through: string | null; captured_at: string };
type HealthFinding = { id: string; entity_type: "entry" | "asset"; entity_id: string; finding_code: string; severity: "info" | "warning" | "blocking"; state: string; title: string; detail: string | null; evidence_json: Record<string, unknown>; last_detected_at: string };
type RemediationTask = { id: string; finding_id: string | null; entity_type: string; entity_id: string; title: string; status: string; priority: string; due_at: string | null; created_at: string };
type HealthProfile = { entry_id: string; owner_id: string | null; last_reviewed_at: string | null; review_cadence_days: number | null; expires_at: string | null };
type StewardshipRow = { entryId: string; search: { search_text: string; status: string; locale: string } | null; profile: HealthProfile | null };
type Member = { id: string; username: string; display_name: string | null; email: string };
type HealthData = { summary: Record<string, number>; findings: HealthFinding[]; tasks: RemediationTask[]; profiles?: HealthProfile[]; stewardship?: StewardshipRow[]; members?: Member[]; currentActorId?: string };

async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) throw new Error("Admin session is unavailable. Please sign in again.");
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(authHeaders)) headers.set(key, value);
  return fetch(input, { ...init, headers });
}

const fmt = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const short = (value?: string | null) => value ? value.slice(0, 8) : "—";

function Badge({ value }: { value: string }) {
  const cls = value === "blocking" || value === "failed" || value === "stale" ? "border-danger bg-danger-muted text-danger" : value === "warning" || value === "queued" || value === "running" ? "border-warning bg-warning-muted text-warning" : value === "fresh" || value === "done" ? "border-success bg-success-muted text-success" : "border-subtle bg-surface-2 text-fg-secondary";
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${cls}`}>{value.replace(/_/g, " ")}</span>;
}

export default function IntelligencePage() {
  const [tab, setTab] = useState<"search" | "analytics" | "health">("search");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [locale, setLocale] = useState("");
  const [sort, setSort] = useState("relevance");
  const [results, setResults] = useState<SearchRow[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [savedName, setSavedName] = useState("");

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [syncStates, setSyncStates] = useState<SyncState[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  const [health, setHealth] = useState<HealthData>({ summary: {}, findings: [], tasks: [], profiles: [], stewardship: [], members: [] });
  const [profileDrafts, setProfileDrafts] = useState<Record<string, { ownerId: string; cadence: string; expiresAt: string }>>({});

  const runSearch = useCallback(async () => {
    setBusy("search"); setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      if (locale) params.set("locale", locale);
      params.set("sort", sort);
      params.set("limit", "100");
      const response = await authenticatedFetch(`/api/content-search?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Search failed");
      setResults(body.data ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Search failed"); }
    finally { setBusy(""); }
  }, [locale, query, sort, status]);

  const loadSaved = useCallback(async () => {
    const response = await authenticatedFetch("/api/content-search/saved");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load saved searches");
    setSaved(body.data ?? []);
  }, []);

  const loadAnalytics = useCallback(async () => {
    const response = await authenticatedFetch("/api/intelligence/analytics");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load analytics intelligence");
    setConnectors(body.data?.connectors ?? []);
    setSyncStates(body.data?.syncStates ?? []);
    setSnapshots(body.data?.snapshots ?? []);
  }, []);

  const loadHealth = useCallback(async () => {
    const response = await authenticatedFetch("/api/intelligence/health");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load content health");
    setHealth(body.data ?? { summary: {}, findings: [], tasks: [], profiles: [], stewardship: [], members: [] });
  }, []);

  const loadAll = useCallback(async () => {
    setBusy("refresh"); setError("");
    try { await Promise.all([runSearch(), loadSaved(), loadAnalytics(), loadHealth()]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Intelligence"); }
    finally { setBusy(""); }
  }, [loadAnalytics, loadHealth, loadSaved, runSearch]);

  useEffect(() => { void loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCurrentSearch() {
    if (!savedName.trim()) return setError("Enter a saved-search name first.");
    setBusy("save-search"); setError("");
    try {
      const response = await authenticatedFetch("/api/content-search/saved", { method: "POST", body: JSON.stringify({ name: savedName, query: { q: query, status, locale, sort } }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not save search");
      setSavedName(""); setNotice("Saved search updated."); await loadSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save search"); }
    finally { setBusy(""); }
  }

  async function deleteSearch(id: string) {
    setBusy(`delete:${id}`); setError("");
    try { const response = await authenticatedFetch(`/api/content-search/saved/${id}`, { method: "DELETE" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not delete search"); await loadSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete search"); }
    finally { setBusy(""); }
  }

  async function analyticsOperation(operation: "ensure_ga4" | "queue_sync" | "run_sync", connectorId?: string) {
    setBusy(operation); setError(""); setNotice("");
    try {
      const response = await authenticatedFetch("/api/intelligence/analytics", { method: "POST", body: JSON.stringify({ operation, connectorId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Analytics operation failed");
      setNotice(operation === "queue_sync" ? "Analytics synchronization queued in Delivery Ops." : operation === "run_sync" ? "GA4 synchronization completed." : "GA4 connector ready.");
      await loadAnalytics();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Analytics operation failed"); }
    finally { setBusy(""); }
  }

  async function healthOperation(operation: "scan" | "queue_scan") {
    setBusy(operation); setError(""); setNotice("");
    try {
      const response = await authenticatedFetch("/api/intelligence/health", { method: "POST", body: JSON.stringify({ operation }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Health operation failed");
      setNotice(operation === "queue_scan" ? "Health scan queued in Delivery Ops." : `Health scan completed: ${body.data?.findingsWritten ?? 0} finding(s) detected.`);
      await loadHealth();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Health operation failed"); }
    finally { setBusy(""); }
  }

  async function saveHealthProfile(row: StewardshipRow) {
    const existing = row.profile; const draft = profileDrafts[row.entryId] ?? { ownerId: existing?.owner_id ?? "", cadence: existing?.review_cadence_days ? String(existing.review_cadence_days) : "", expiresAt: existing?.expires_at ? existing.expires_at.slice(0, 10) : "" };
    setBusy("profile:" + row.entryId); setError("");
    try { const response = await authenticatedFetch("/api/intelligence/health", { method: "POST", body: JSON.stringify({ operation: "update_profile", entryId: row.entryId, ownerId: draft.ownerId || null, reviewCadenceDays: draft.cadence || null, expiresAt: draft.expiresAt ? new Date(draft.expiresAt + "T23:59:59Z").toISOString() : null, lastReviewedAt: existing?.last_reviewed_at ?? null }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not update stewardship"); setNotice("Content stewardship updated."); await loadHealth(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update stewardship"); } finally { setBusy(""); }
  }

  async function markReviewed(row: StewardshipRow) {
    const existing = row.profile; setBusy("review:" + row.entryId); setError("");
    try { const response = await authenticatedFetch("/api/intelligence/health", { method: "POST", body: JSON.stringify({ operation: "update_profile", entryId: row.entryId, ownerId: existing?.owner_id ?? null, reviewCadenceDays: existing?.review_cadence_days ?? null, expiresAt: existing?.expires_at ?? null, lastReviewedAt: new Date().toISOString() }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not mark reviewed"); await loadHealth(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not mark reviewed"); } finally { setBusy(""); }
  }

  async function createTask(finding: HealthFinding) {
    setBusy(`task:${finding.id}`); setError("");
    try {
      const response = await authenticatedFetch("/api/intelligence/health", { method: "POST", body: JSON.stringify({ operation: "create_task", findingId: finding.id, entityType: finding.entity_type, entityId: finding.entity_id, title: finding.title, priority: finding.severity === "blocking" ? "urgent" : finding.severity === "warning" ? "high" : "normal" }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not create remediation task"); await loadHealth();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create remediation task"); }
    finally { setBusy(""); }
  }

  async function completeTask(task: RemediationTask) {
    setBusy(`complete:${task.id}`); setError("");
    try { const response = await authenticatedFetch(`/api/intelligence/health/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: "done", resolutionNote: "Marked complete from Intelligence." }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Could not complete task"); await loadHealth(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not complete task"); }
    finally { setBusy(""); }
  }

  const groupedAnalytics = useMemo(() => {
    const byEntry = new Map<string, Snapshot[]>();
    for (const row of snapshots) byEntry.set(row.entry_id, [...(byEntry.get(row.entry_id) ?? []), row]);
    return [...byEntry.entries()].map(([entryId, rows]) => {
      const current = rows.find((row) => row.metrics_json?.comparisonWindow === "current_28d") ?? rows[0];
      const previous = rows.find((row) => row.metrics_json?.comparisonWindow === "previous_28d") ?? rows[1];
      const pct = (a?: number | null, b?: number | null) => b ? (((a ?? 0) - b) / b) * 100 : null;
      return { entryId, current, previous, pageViewsDelta: pct(current?.page_views, previous?.page_views), usersDelta: pct(current?.users_count, previous?.users_count) };
    }).filter((item) => item.current).slice(0, 100);
  }, [snapshots]);

  return <AdminLayout><div className="ui-page mx-auto max-w-[1500px]">
    <header className="ui-page-header"><div><p className="ui-eyebrow">Search, Analytics & Content Health</p><h1 className="ui-page-title">Content Intelligence</h1><p className="ui-page-description">Find governed content, understand analytics freshness and observational performance change, and turn content debt into accountable remediation work.</p></div><button onClick={() => void loadAll()} disabled={busy !== ""} className="ui-btn ui-btn-secondary"><RefreshCw size={14} className={busy === "refresh" ? "animate-spin" : ""}/>Refresh</button></header>
    {error && <div className="ui-alert ui-alert-danger mt-5">{error}</div>}
    {notice && <div className="ui-alert ui-alert-success mt-5">{notice}</div>}

    <nav className="mt-6 flex flex-wrap gap-1 border-b border-subtle pb-3">{([['search','Search',Search],['analytics','Analytics',BarChart2],['health','Content Health',Stethoscope]] as const).map(([key,label,Icon]) => <button key={key} onClick={() => setTab(key)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium ${tab === key ? "bg-surface-2 text-fg-primary" : "text-fg-muted hover:bg-surface-2 hover:text-fg-secondary"}`}><Icon size={14}/>{label}</button>)}</nav>

    {tab === "search" && <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0"><div className="flex items-center gap-2"><Search size={16} className="text-action"/><h2 className="text-lg font-bold">Ranked content search</h2></div><div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_130px_150px_auto]"><input value={query} onChange={(e)=>setQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')void runSearch();}} placeholder="Search content…" className="rounded-lg border border-subtle bg-field px-3 py-2 text-sm"/><select value={status} onChange={(e)=>setStatus(e.target.value)} className="rounded-lg border border-subtle bg-field px-3 py-2 text-xs"><option value="">All states</option>{['draft','in_review','approved','scheduled','published','archived'].map(v=><option key={v} value={v}>{v}</option>)}</select><input value={locale} onChange={(e)=>setLocale(e.target.value)} placeholder="locale" className="rounded-lg border border-subtle bg-field px-3 py-2 text-xs"/><select value={sort} onChange={(e)=>setSort(e.target.value)} className="rounded-lg border border-subtle bg-field px-3 py-2 text-xs"><option value="relevance">Relevance</option><option value="updated_desc">Newest</option><option value="updated_asc">Oldest</option></select><button onClick={()=>void runSearch()} disabled={busy!==""} className="rounded-lg ui-btn ui-btn-primary">Search</button></div>
        <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-subtle text-[9px] uppercase tracking-wider text-fg-muted"><tr><th className="py-3 pr-4">Content</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Locale</th><th className="px-4 py-3">Rank</th><th className="px-4 py-3">Updated</th></tr></thead><tbody>{results.map(row=><tr key={row.entry_id} className="border-b border-subtle"><td className="py-3 pr-4"><Link href={`/admin/entries/${row.entry_id}`} className="font-semibold text-fg-primary hover:text-action">{row.search_text.slice(0,110)||`Entry ${short(row.entry_id)}`}</Link><p className="mt-1 font-mono text-[9px] text-fg-muted">{short(row.entry_id)} · model {short(row.content_model_id)}</p></td><td className="px-4 py-3"><Badge value={row.status}/></td><td className="px-4 py-3 text-fg-muted">{row.locale}</td><td className="px-4 py-3 text-fg-muted">{Math.max(row.rank||0,row.similarity||0).toFixed(3)}</td><td className="px-4 py-3 text-fg-muted">{fmt(row.updated_at)}</td></tr>)}{results.length===0&&<tr><td colSpan={5} className="py-10 text-center text-fg-muted">No permission-visible content matched.</td></tr>}</tbody></table></div></section>
      <aside className="xl:border-l xl:border-subtle xl:pl-6"><div className="flex items-center gap-2"><Bookmark size={15} className="text-action"/><h2 className="font-bold">Saved searches</h2></div><div className="mt-4 flex gap-2"><input value={savedName} onChange={(e)=>setSavedName(e.target.value)} placeholder="Name this search" className="min-w-0 flex-1 rounded-lg border border-subtle bg-field px-3 py-2 text-xs"/><button onClick={()=>void saveCurrentSearch()} className="rounded-lg border border-action/20 p-2 text-action"><Save size={14}/></button></div><div className="mt-4 space-y-2">{saved.map(item=><div key={item.id} className="border-t border-subtle py-3 first:border-t-0"><div className="flex items-start justify-between gap-2"><button onClick={()=>{const q=item.query_json;setQuery(String(q.q??''));setStatus(String(q.status??''));setLocale(String(q.locale??''));setSort(String(q.sort??'relevance'));}} className="text-left"><p className="text-xs font-semibold text-fg-primary">{item.name}</p><p className="mt-1 text-[9px] text-fg-muted">{item.is_shared?'shared':'personal'} · {fmt(item.updated_at)}</p></button><button onClick={()=>void deleteSearch(item.id)} className="text-fg-muted hover:text-danger"><Trash2 size={13}/></button></div></div>)}{saved.length===0&&<p className="text-xs text-fg-muted">No saved searches yet.</p>}</div></aside>
    </div>}

    {tab === "analytics" && <div className="mt-6 space-y-6">
      <section className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fg-muted">Connector state</p><h2 className="mt-1 text-lg font-bold">GA4 freshness</h2><p className="mt-1 text-xs text-fg-muted">Snapshots are historical observations. They are never presented as live data or automatic causal attribution.</p></div>{connectors.length===0?<button onClick={()=>void analyticsOperation('ensure_ga4')} className="rounded-lg ui-btn ui-btn-primary">Initialize GA4 connector</button>:null}</div><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{connectors.map(connector=>{const state=syncStates.find(item=>item.connector_id===connector.id);return <div key={connector.id} className="border-t border-subtle py-4 first:border-t-0"><div className="flex items-center justify-between"><p className="font-semibold">{connector.name}</p><Badge value={state?.status??'never_synced'}/></div><p className="mt-2 text-[10px] text-fg-muted">Credentials: {connector.credential_mode}</p><div className="mt-3 space-y-1 text-[10px] text-fg-muted"><p>Fresh through: {state?.fresh_through??'—'}</p><p>Last success: {fmt(state?.last_success_at)}</p>{state?.last_error&&<p className="text-danger">{state.last_error}</p>}</div><div className="mt-3 flex gap-2"><button onClick={()=>void analyticsOperation('run_sync',connector.id)} disabled={busy!==""} className="rounded-lg border border-action/20 px-3 py-2 text-[10px] font-bold uppercase text-action">Sync now</button><button onClick={()=>void analyticsOperation('queue_sync',connector.id)} disabled={busy!==""} className="rounded-lg border border-subtle px-3 py-2 text-[10px] font-bold uppercase text-fg-secondary">Queue durable sync</button></div></div>})}</div></section>
      <section className="min-w-0"><div className="flex items-center gap-2"><Activity size={15} className="text-info"/><h2 className="font-bold">Observed 28-day change</h2></div><p className="mt-2 text-xs text-fg-muted">Current 28 days versus previous 28 days. Correlation only; no causal claim is made.</p><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-subtle text-[9px] uppercase tracking-wider text-fg-muted"><tr><th className="py-3 pr-4">Entry / destination</th><th className="px-4 py-3">Views</th><th className="px-4 py-3">Δ views</th><th className="px-4 py-3">Users</th><th className="px-4 py-3">Δ users</th><th className="px-4 py-3">Fresh through</th></tr></thead><tbody>{groupedAnalytics.map(row=><tr key={row.entryId} className="border-b border-subtle"><td className="py-3 pr-4"><Link href={`/admin/entries/${row.entryId}`} className="font-semibold text-fg-primary">{row.current?.destination_url}</Link><p className="font-mono text-[9px] text-fg-muted">{short(row.entryId)}</p></td><td className="px-4 py-3">{row.current?.page_views??0}</td><td className={`px-4 py-3 ${row.pageViewsDelta!==null&&row.pageViewsDelta<0?'text-danger':'text-success'}`}>{row.pageViewsDelta===null?'—':`${row.pageViewsDelta.toFixed(1)}%`}</td><td className="px-4 py-3">{row.current?.users_count??0}</td><td className={`px-4 py-3 ${row.usersDelta!==null&&row.usersDelta<0?'text-danger':'text-success'}`}>{row.usersDelta===null?'—':`${row.usersDelta.toFixed(1)}%`}</td><td className="px-4 py-3 text-fg-muted">{row.current?.data_fresh_through??'—'}</td></tr>)}{groupedAnalytics.length===0&&<tr><td colSpan={6} className="py-10 text-center text-fg-muted">No synchronized content analytics yet.</td></tr>}</tbody></table></div></section>
    </div>}

    {tab === "health" && <div className="mt-6 space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Blocking" value={health.summary.blocking??0} icon={<AlertTriangle size={15}/>}/><Metric label="Warnings" value={health.summary.warnings??0} icon={<Clock3 size={15}/>}/><Metric label="Open tasks" value={health.summary.openTasks??0} icon={<Stethoscope size={15}/>}/><Metric label="Unused assets" value={health.summary.unusedAssets??0} icon={<Activity size={15}/>}/><Metric label="Performance decline" value={health.summary.performanceDecline??0} icon={<TrendingDown size={15}/>}/></div>
      <section className="min-w-0"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fg-muted">Content stewardship</p><h2 className="mt-1 text-lg font-bold">Ownership, review cadence & expiry</h2><p className="mt-1 text-xs text-fg-muted">Turn maintenance policy into explicit operational state per entry.</p></div><div className="mt-4 space-y-3">{(health.stewardship??[]).slice(0,100).map(row=>{const profile=row.profile;const draft=profileDrafts[row.entryId]??{ownerId:profile?.owner_id??'',cadence:profile?.review_cadence_days?String(profile.review_cadence_days):'',expiresAt:profile?.expires_at?profile.expires_at.slice(0,10):''};return <div key={row.entryId} className="grid gap-3 rounded-xl border border-subtle bg-field p-4 xl:grid-cols-[minmax(220px,1fr)_220px_130px_150px_auto]"><div className="min-w-0"><Link href={'/admin/entries/'+row.entryId} className="block truncate text-sm font-semibold text-fg-primary hover:text-action">{row.search?.search_text?.slice(0,90)||('Entry '+short(row.entryId))}</Link><p className="mt-1 text-[9px] text-fg-muted">{row.search?.status??'unknown'} · {row.search?.locale??'—'} · reviewed {fmt(profile?.last_reviewed_at)}</p></div><select value={draft.ownerId} onChange={e=>setProfileDrafts(d=>({...d,[row.entryId]:{...draft,ownerId:e.target.value}}))} className="rounded-lg border border-subtle bg-field px-2 py-2 text-xs text-fg-secondary"><option value="">No owner</option>{(health.members??[]).map(member=><option key={member.id} value={member.id}>{member.display_name||member.username||member.email}</option>)}</select><input type="number" min="1" max="3650" placeholder="Review days" value={draft.cadence} onChange={e=>setProfileDrafts(d=>({...d,[row.entryId]:{...draft,cadence:e.target.value}}))} className="rounded-lg border border-subtle bg-field px-2 py-2 text-xs"/><input type="date" value={draft.expiresAt} onChange={e=>setProfileDrafts(d=>({...d,[row.entryId]:{...draft,expiresAt:e.target.value}}))} className="rounded-lg border border-subtle bg-field px-2 py-2 text-xs"/><div className="flex gap-2"><button onClick={()=>void saveHealthProfile(row)} disabled={busy!==''} className="rounded-lg border border-action/20 px-3 py-2 text-[10px] font-bold uppercase text-action">Save</button><button onClick={()=>void markReviewed(row)} disabled={busy!==''} className="rounded-lg border border-success px-3 py-2 text-[10px] font-bold uppercase text-success">Reviewed</button></div></div>})}{(health.stewardship??[]).length===0&&<p className="text-xs text-fg-muted">No permission-visible entries.</p>}</div></section>
      <section className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fg-muted">Materialized findings</p><h2 className="mt-1 text-lg font-bold">Content debt & health</h2></div><div className="flex gap-2"><button onClick={()=>void healthOperation('scan')} disabled={busy!==""} className="rounded-lg ui-btn ui-btn-primary">Run scan</button><button onClick={()=>void healthOperation('queue_scan')} disabled={busy!==""} className="rounded-lg border border-subtle px-3 py-2 text-[10px] font-bold uppercase text-fg-secondary">Queue durable scan</button></div></div><div className="mt-4 space-y-2">{health.findings.filter(f=>['open','acknowledged'].includes(f.state)).map(finding=><div key={finding.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-subtle py-4 first:border-t-0"><div className="min-w-0"><div className="flex items-center gap-2"><Badge value={finding.severity}/><p className="text-sm font-semibold text-fg-primary">{finding.title}</p></div><p className="mt-1 text-xs text-fg-muted">{finding.detail??finding.finding_code}</p><p className="mt-2 font-mono text-[9px] text-fg-muted">{finding.entity_type}:{short(finding.entity_id)} · {fmt(finding.last_detected_at)}</p></div><div className="flex gap-2">{finding.entity_type==='entry'&&<Link href={`/admin/entries/${finding.entity_id}`} className="rounded-lg border border-subtle px-3 py-2 text-[10px] font-bold uppercase text-fg-secondary">Open</Link>}<button onClick={()=>void createTask(finding)} disabled={busy!==""} className="rounded-lg border border-action/20 px-3 py-2 text-[10px] font-bold uppercase text-action">Create task</button></div></div>)}{health.findings.filter(f=>['open','acknowledged'].includes(f.state)).length===0&&<div className="ui-alert ui-alert-success"><CheckCircle2 size={14}/> No open materialized findings. Run a scan to refresh health state.</div>}</div></section>
      <section className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fg-muted">Remediation queue</p><h2 className="mt-1 text-lg font-bold">Operational work</h2><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-subtle text-[9px] uppercase tracking-wider text-fg-muted"><tr><th className="py-3 pr-4">Task</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Due</th><th className="px-4 py-3"></th></tr></thead><tbody>{health.tasks.map(task=><tr key={task.id} className="border-b border-subtle"><td className="py-3 pr-4"><p className="font-semibold text-fg-primary">{task.title}</p><p className="font-mono text-[9px] text-fg-muted">{task.entity_type}:{short(task.entity_id)}</p></td><td className="px-4 py-3"><Badge value={task.priority}/></td><td className="px-4 py-3"><Badge value={task.status}/></td><td className="px-4 py-3 text-fg-muted">{fmt(task.due_at)}</td><td className="px-4 py-3">{task.status!=='done'&&<button onClick={()=>void completeTask(task)} className="rounded-lg border border-success px-3 py-2 text-[10px] font-bold uppercase text-success">Mark done</button>}</td></tr>)}{health.tasks.length===0&&<tr><td colSpan={5} className="py-10 text-center text-fg-muted">No remediation tasks yet.</td></tr>}</tbody></table></div></section>
    </div>}
  </div></AdminLayout>;
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <div className="min-w-0"><div className="flex items-center gap-2 text-fg-muted">{icon}<p className="text-[11px] font-medium">{label}</p></div><p className="mt-2 text-3xl font-semibold text-fg-primary">{value}</p></div>; }
