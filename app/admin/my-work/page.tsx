"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import { Bell, CheckSquare, RefreshCw, Rocket } from "lucide-react";

type Queue = {
  assignments: Array<{ id: string; entry_id: string; role: string; due_at: string | null; note: string | null; content_entries: { status: string; content_models: { name: string } | { name: string }[] | null } | null }>;
  releaseAssignments: Array<{ id: string; release_id: string; role: string; due_at: string | null; note: string | null; releases: { name: string; status: string; scheduled_for: string | null } | { name: string; status: string; scheduled_for: string | null }[] | null }>;
  notifications: Array<{ id: string; entry_id: string | null; release_id: string | null; kind: string; created_at: string; payload_json?: Record<string, unknown> }>;
};

export default function MyWorkPage() {
  const [queue, setQueue] = useState<Queue>({ assignments: [], releaseAssignments: [], notifications: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/collaboration/queue");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load your work");
      setQueue({ assignments: body.data.assignments || [], releaseAssignments: body.data.releaseAssignments || [], notifications: body.data.notifications || [] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load your work"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const total = queue.assignments.length + queue.releaseAssignments.length;

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-6xl">
        <header className="ui-page-header">
          <div><p className="ui-eyebrow">Editorial operations</p><h1 className="ui-page-title">My Work</h1><p className="ui-page-description">Entry and release work assigned to you, plus recent editorial notifications.</p></div>
          <button onClick={() => void load()} className="ui-btn ui-btn-secondary"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button>
        </header>

        {error ? <div className="ui-alert ui-alert-danger mt-5">{error}</div> : null}

        <section className="grid gap-10 border-b border-subtle py-8 lg:grid-cols-3">
          <div><div className="text-3xl font-semibold text-fg-primary">{total}</div><div className="mt-1 text-[12px] text-fg-muted">Open assignments</div></div>
          <div><div className="text-3xl font-semibold text-review">{queue.assignments.length}</div><div className="mt-1 text-[12px] text-fg-muted">Content assignments</div></div>
          <div><div className="text-3xl font-semibold text-action">{queue.releaseAssignments.length}</div><div className="mt-1 text-[12px] text-fg-muted">Release assignments</div></div>
        </section>

        <div className="grid gap-10 py-8 lg:grid-cols-2">
          <section>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg-primary"><CheckSquare size={15} className="text-review" />Content assigned to you</h2>
            <div className="mt-4 border-y border-subtle">
              {queue.assignments.length ? queue.assignments.map((item) => {
                const model = Array.isArray(item.content_entries?.content_models) ? item.content_entries?.content_models[0] : item.content_entries?.content_models;
                return <Link key={item.id} href={`/admin/entries/${item.entry_id}`} className="group block border-b border-subtle py-4 no-underline last:border-0"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-[13px] font-semibold text-fg-primary group-hover:text-link">{model?.name || "Content entry"}</p><p className="mt-1 text-[12px] text-fg-muted">{item.role} · {item.due_at ? `Due ${new Date(item.due_at).toLocaleString()}` : "No due date"}</p>{item.note ? <p className="mt-2 text-[12px] leading-5 text-fg-secondary">{item.note}</p> : null}</div><span className="ui-badge ui-badge-review">{item.content_entries?.status || "assigned"}</span></div></Link>;
              }) : <div className="py-8 text-sm text-fg-muted">No active entry assignments.</div>}
            </div>
          </section>

          <section>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg-primary"><Rocket size={15} className="text-action" />Releases assigned to you</h2>
            <div className="mt-4 border-y border-subtle">
              {queue.releaseAssignments.length ? queue.releaseAssignments.map((item) => {
                const release = Array.isArray(item.releases) ? item.releases[0] : item.releases;
                return <Link key={item.id} href={`/admin/releases/${item.release_id}`} className="group block border-b border-subtle py-4 no-underline last:border-0"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-[13px] font-semibold text-fg-primary group-hover:text-link">{release?.name || "Release"}</p><p className="mt-1 text-[12px] text-fg-muted">{item.role} · {item.due_at ? `Due ${new Date(item.due_at).toLocaleString()}` : "No due date"}</p>{release?.scheduled_for ? <p className="mt-1 text-[11px] text-warning">Scheduled {new Date(release.scheduled_for).toLocaleString()}</p> : null}</div><span className="ui-badge ui-badge-pending">{release?.status || "unknown"}</span></div></Link>;
              }) : <div className="py-8 text-sm text-fg-muted">No active release assignments.</div>}
            </div>
          </section>
        </div>

        <section className="ui-section">
          <div className="flex items-center justify-between gap-4"><h2 className="flex items-center gap-2 text-[15px] font-semibold text-fg-primary"><Bell size={15} className="text-review" />Notifications</h2><span className="text-[12px] text-fg-muted">{queue.notifications.length} recent</span></div>
          <div className="mt-4 border-y border-subtle">{queue.notifications.length ? queue.notifications.map((item) => {
            const href = item.release_id ? `/admin/releases/${item.release_id}` : item.entry_id ? `/admin/entries/${item.entry_id}` : null;
            const content = <div className="ui-list-row py-3"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-review-muted" /><div className="min-w-0 flex-1"><span className="text-[12px] font-medium text-fg-secondary">{item.kind.replaceAll("_", " ")}</span><div className="mt-1 text-[10px] text-fg-muted">{new Date(item.created_at).toLocaleString()}</div></div></div>;
            return href ? <Link key={item.id} href={href} className="block no-underline">{content}</Link> : <div key={item.id}>{content}</div>;
          }) : <div className="py-8 text-sm text-fg-muted">You are all caught up.</div>}</div>
        </section>
      </div>
    </AdminLayout>
  );
}
