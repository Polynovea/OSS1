"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AdminLayout from "@/components/admin/AdminLayout";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { Archive, ArchiveRestore, Bookmark, CheckCircle2, Download, FilePenLine, LibraryBig, Plus, RefreshCw, Search, Send, Trash2, Undo2, Upload } from "lucide-react";

interface Model { id: string; name: string; api_key: string }
interface SearchDoc {
  entry_id: string;
  content_model_id: string;
  status: string;
  search_text: string;
  updated_at: string;
  content_models: { name: string; api_key: string } | { name: string; api_key: string }[] | null;
}
interface SavedView { id: string; name: string; filters_json: { modelId?: string; status?: string; query?: string; sort?: "updated_desc" | "updated_asc" } }

const STATUSES = ["draft", "in_review", "approved", "scheduled", "published", "archived"] as const;
const PAGE_SIZE = 25;

function modelName(doc: SearchDoc, models: Model[]): string {
  const rel = doc.content_models;
  return (Array.isArray(rel) ? rel[0]?.name : rel?.name) || models.find((model) => model.id === doc.content_model_id)?.name || "Unknown model";
}

export default function EntriesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [models, setModels] = useState<Model[]>([]);
  const [docs, setDocs] = useState<SearchDoc[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modelFilter, setModelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<"updated_desc" | "updated_asc">("updated_desc");
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const searchRequestId = useRef(0);

  const search = useCallback(async (nextOffset: number, append: boolean) => {
    const requestId = ++searchRequestId.current;
    setLoading(true); setError("");
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
      if (modelFilter) params.set("modelId", modelFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
      params.set("sort", sort);
      const res = await fetch(`/api/content-search?${params.toString()}`, { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load records");
      if (requestId !== searchRequestId.current) return;
      const rows: SearchDoc[] = body.data || [];
      setDocs((current) => (append ? [...current, ...rows] : rows));
      setHasMore(rows.length === PAGE_SIZE);
      setOffset(nextOffset);
    } catch (err) {
      if (requestId !== searchRequestId.current) return;
      setError(err instanceof Error ? err.message : "Could not load records");
    } finally {
      if (requestId === searchRequestId.current) setLoading(false);
    }
  }, [modelFilter, statusFilter, debouncedQuery, sort]);

  useEffect(() => {
    async function loadModels() {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/models", { headers });
        const b = await res.json();
        const nextModels: Model[] = b.data || [];
        setModels(nextModels);

        const modelApiKey = searchParams.get("modelApiKey");
        const modelIdParam = searchParams.get("modelId");

        if (modelApiKey) {
          setModelFilter(nextModels.find((model) => model.api_key === modelApiKey)?.id || "");
        } else if (modelIdParam) {
          setModelFilter(modelIdParam);
        }
      } catch {
        // Fallback
      }
    }
    void loadModels();
  }, [searchParams, router]);

  const loadViews = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/entries/views", { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setSavedViews(body.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load saved views");
    }
  }, []);

  useEffect(() => { void loadViews(); }, [loadViews]);
  useEffect(() => { const timeout = setTimeout(() => setDebouncedQuery(query), 300); return () => clearTimeout(timeout); }, [query]);
  useEffect(() => { setSelected(new Set()); void search(0, false); }, [search]);

  function toggle(id: string) {
    setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleAll() {
    setSelected((current) => (current.size === docs.length ? new Set() : new Set(docs.map((d) => d.entry_id))));
  }

  async function bulkAction(action: "archive" | "unarchive") {
    setBusy(true); setError(""); setNotice("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/entries/bulk", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ action, ids: [...selected] })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Bulk action failed");
      setNotice(`${body.data.succeeded} record(s) ${action === "archive" ? "archived" : "restored"}${body.data.failed ? `, ${body.data.failed} failed` : ""}.`);
      setSelected(new Set());
      await search(0, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk action failed");
    } finally {
      setBusy(false);
    }
  }

  async function bulkWorkflow(action: "submit" | "approve" | "request_changes") {
    setBusy(true); setError(""); setNotice("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/entries/bulk/workflow", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ action, ids: [...selected] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Bulk workflow action failed");
      setNotice(`${body.data.succeeded} record(s) completed ${action.replaceAll("_", " ")}${body.data.failed ? `, ${body.data.failed} failed` : ""}.`);
      setSelected(new Set());
      await search(0, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk workflow action failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportModel() {
    if (!modelFilter) return;
    setBusy(true); setError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/entries/export?modelId=${modelFilter}`, { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Export failed");
      const blob = new Blob([JSON.stringify(body.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${body.data.apiKey}-export.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  function applyView(view: SavedView) {
    const filters = view.filters_json || {};
    setModelFilter(filters.modelId || ""); setStatusFilter(filters.status || ""); setQuery(filters.query || ""); setSort(filters.sort || "updated_desc");
  }

  async function saveView() {
    const name = viewName.trim(); if (!name) { setError("Name this view before saving it"); return; }
    setBusy(true); setError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/entries/views", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ name, filters: { modelId: modelFilter || undefined, status: statusFilter || undefined, query: query.trim() || undefined, sort } })
      });
      const body = await res.json(); if (!res.ok) throw new Error(body.error || "Could not save view");
      setViewName(""); await loadViews(); setNotice(`Saved view “${name}”.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save view"); } finally { setBusy(false); }
  }

  async function deleteView(id: string) {
    setBusy(true); setError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/entries/views/${id}`, { method: "DELETE", headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not delete view");
      await loadViews();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not delete view"); } finally { setBusy(false); }
  }

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        <header className="ui-page-header">
          <div>
            <p className="ui-eyebrow flex items-center gap-1.5"><LibraryBig size={12} />Data Studio</p>
            <h1 className="ui-page-title">Records</h1>
            <p className="ui-page-description">Create and manage structured records. Publish workflow applies only to models configured for content.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/entries/import" className="ui-btn ui-btn-secondary no-underline"><Upload size={14} /> Import</Link>
            <Link href="/admin/entries/new" className="ui-btn ui-btn-primary no-underline"><Plus size={15} /> New record</Link>
          </div>
        </header>

        <section className="ui-section"><div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search records…" className="w-64 rounded-lg border border-default bg-field py-2.5 pl-9 pr-3 text-sm text-fg-primary outline-none focus:border-action/50" />
          </div>
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="rounded-lg border border-default bg-field px-3 py-2.5 text-sm text-fg-secondary outline-none"
          >
            <option value="">All models</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-default bg-field px-3 py-2.5 text-sm text-fg-secondary outline-none">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as "updated_desc" | "updated_asc")} className="rounded-lg border border-default bg-field px-3 py-2.5 text-sm text-fg-secondary outline-none">
            <option value="updated_desc">Newest first</option><option value="updated_asc">Oldest first</option>
          </select>
          {modelFilter && <button type="button" disabled={busy} onClick={() => void exportModel()} className="ui-btn ui-btn-secondary disabled:opacity-50"><Download size={14} /> Export model</button>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-4">
          <Bookmark size={14} className="text-action" /><span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-fg-muted">Saved views</span>
          {savedViews.map((view) => <span key={view.id} className="inline-flex items-center rounded-lg border border-subtle bg-field"><button type="button" onClick={() => applyView(view)} className="px-2.5 py-1.5 text-xs text-fg-secondary hover:text-action">{view.name}</button><button type="button" disabled={busy} aria-label={`Delete ${view.name}`} onClick={() => void deleteView(view.id)} className="border-l border-subtle px-1.5 py-1.5 text-fg-muted hover:text-danger"><Trash2 size={12} /></button></span>)}
          <input value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={120} placeholder="Name current view" className="ml-auto min-w-40 rounded-lg px-3 py-2 text-xs" />
          <button type="button" disabled={busy || !viewName.trim()} onClick={() => void saveView()} className="ui-btn ui-btn-tertiary disabled:opacity-50">Save view</button>
        </div>
        </section>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-action/25 bg-action/5 px-4 py-3 text-xs">
            <span className="font-bold text-action">{selected.size} selected</span>
            <button type="button" disabled={busy} onClick={() => void bulkWorkflow("submit")} className="inline-flex items-center gap-1.5 rounded-lg border border-review px-3 py-1.5 font-bold uppercase tracking-wider text-review hover:text-violet-100 disabled:opacity-50"><Send size={13} /> Submit</button>
            <button type="button" disabled={busy} onClick={() => void bulkWorkflow("approve")} className="inline-flex items-center gap-1.5 rounded-lg border border-success px-3 py-1.5 font-bold uppercase tracking-wider text-success hover:text-emerald-100 disabled:opacity-50"><CheckCircle2 size={13} /> Approve</button>
            <button type="button" disabled={busy} onClick={() => void bulkWorkflow("request_changes")} className="inline-flex items-center gap-1.5 rounded-lg border border-warning px-3 py-1.5 font-bold uppercase tracking-wider text-warning hover:text-amber-100 disabled:opacity-50"><Undo2 size={13} /> Changes</button>
            <button type="button" disabled={busy} onClick={() => void bulkAction("archive")} className="inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 font-bold uppercase tracking-wider text-fg-secondary hover:text-fg-primary disabled:opacity-50"><Archive size={13} /> Archive</button>
            <button type="button" disabled={busy} onClick={() => void bulkAction("unarchive")} className="inline-flex items-center gap-1.5 rounded-lg border border-subtle px-3 py-1.5 font-bold uppercase tracking-wider text-fg-secondary hover:text-fg-primary disabled:opacity-50"><ArchiveRestore size={13} /> Restore</button>
          </div>
        )}

        {error && <div className="rounded-xl border border-danger bg-danger-muted p-4 text-sm text-danger">{error}</div>}
        {notice && <div className="rounded-xl border border-success bg-success-muted p-4 text-sm text-success">{notice}</div>}

        {loading && docs.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center text-fg-muted"><RefreshCw className="animate-spin" /></div>
        ) : docs.length === 0 ? (
          <div className="ui-empty rounded-xl bg-surface-1">
            <FilePenLine size={28} className="mx-auto text-action" />
            <h2 className="mt-4 text-lg font-bold">No records match this view</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-fg-muted">Adjust your filters, or choose a content model and author the first entry.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border-y border-subtle">
            <div className="grid min-w-[760px] grid-cols-[28px_minmax(0,1fr)_140px_130px_140px] gap-4 border-b border-default px-3 py-3 text-[11px] font-medium text-fg-muted">
              <input type="checkbox" checked={selected.size > 0 && selected.size === docs.length} onChange={toggleAll} className="accent-primary" />
              <span>Record</span><span>Model</span><span>State</span><span>Last change</span>
            </div>
            {docs.map((doc) => {
              return (
                <div key={doc.entry_id} className="grid min-w-[760px] grid-cols-[28px_minmax(0,1fr)_140px_130px_140px] items-center gap-4 border-b border-subtle px-3 py-3 last:border-0 hover:bg-surface-2">
                  <input type="checkbox" checked={selected.has(doc.entry_id)} onChange={() => toggle(doc.entry_id)} className="accent-primary" />
                  <Link href={`/admin/entries/${doc.entry_id}`} className="block truncate no-underline"><span className="block font-mono text-xs text-action">{doc.entry_id.slice(0, 8)}</span><span className="mt-1 block truncate text-sm text-fg-secondary">{doc.search_text?.slice(0, 80) || "(no preview text)"}</span></Link>
                  <span className="truncate text-sm text-fg-secondary">{modelName(doc, models)}</span>
                  <span className={doc.status === "published" ? "text-xs font-bold text-success" : doc.status === "archived" ? "text-xs font-bold text-fg-muted" : "text-xs font-bold text-warning"}>{doc.status}</span>
                  <span className="text-xs text-fg-muted">{new Date(doc.updated_at).toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
        )}

        {hasMore && (
          <button type="button" disabled={loading} onClick={() => void search(offset + PAGE_SIZE, true)} className="ui-btn ui-btn-secondary mx-auto disabled:opacity-50">
            {loading ? <RefreshCw size={14} className="animate-spin" /> : null} Load more
          </button>
        )}
      </div>
    </AdminLayout>
  );
}
