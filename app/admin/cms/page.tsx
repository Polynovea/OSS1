"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import { usePolling } from "@/lib/admin/usePolling";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  FileText,
  GitPullRequest,
  Image,
  Layers3,
  Plug,
  RefreshCw,
  Rocket,
  Server,
  ShieldCheck,
  Sparkles,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";

type Readiness = "healthy" | "attention" | "blocked";

interface Snapshot {
  readiness: Readiness;
  attention: Array<{ key: string; severity: "blocking" | "warning" | "info"; title: string; detail: string; href: string; count: number }>;
  content: { models: number; entries: number; assets: number; byStatus: { draft: number; inReview: number; approved: number; scheduled: number; published: number } };
  workflow: { myAssignments: number; approvalsPending: number };
  releases: { open: number; scheduled: number; partiallyFailed: number; recent: Array<{ id: string; name: string; status: string; scheduled_for: string | null; published_at: string | null; updated_at: string }> };
  delivery: { queued: number; running: number; deadLetter: number; recent: Array<{ id: string; kind: string; status: string; queue_name: string; attempt_count: number; max_attempts: number; last_error_code: string | null; last_error_message: string | null; created_at: string; updated_at: string }> };
  assurance: { open: number; blocking: number; warnings: number; recent: Array<{ id: string; severity: string; state: string; title: string; detail: string | null; entity_type: string; entity_id: string; last_detected_at: string }> };
  infrastructure: {
    environments: { total: number; ready: number; problem: number };
    connections: { total: number; active: number; problem: number };
    analyticsProblems: number;
    defaultEnvironment: { id: string; key: string; name: string; kind: string; status: string; is_default: boolean; health_json: Record<string, unknown>; last_health_check_at: string | null; deployed_schema_revision: string | null } | null;
    environmentList: Array<{ id: string; key: string; name: string; kind: string; status: string; is_default: boolean }>;
  };
  recentActivity: Array<{ id: string; action: string; entity_type: string; entity_id: string | null; metadata_json: Record<string, unknown>; created_at: string }>;
  generatedAt: string;
}

const readinessMeta = {
  healthy: { label: "Operational", headline: "Everything that is configured is in sync.", icon: CheckCircle2, tone: "text-success" },
  attention: { label: "Needs attention", headline: "A few things need your attention.", icon: AlertTriangle, tone: "text-warning" },
  blocked: { label: "Intervention required", headline: "A blocking issue is holding the platform back.", icon: XCircle, tone: "text-danger" },
} as const;

function humanize(value: string) {
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function timeAgo(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(delta / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function StatusMark({ status }: { status: string }) {
  const bad = ["failed", "blocked", "dead_letter", "degraded", "partially_failed"].includes(status);
  const good = ["active", "ready", "healthy", "published", "succeeded"].includes(status);
  return <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: bad ? "var(--danger-fg)" : good ? "var(--success-fg)" : "var(--warning-fg)" }} />;
}

function Stat({ label, value, detail, href, icon: Icon }: { label: string; value: number | string; detail: string; href: string; icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }> }) {
  return (
    <Link href={href} className="group min-w-0 no-underline">
      <div className="flex items-center gap-2 text-fg-muted"><Icon size={14} strokeWidth={1.45} /><span className="text-[11px] font-medium">{label}</span></div>
      <div className="mt-2 flex items-end gap-2"><span className="font-headline text-3xl font-bold tracking-tight text-fg-primary">{value}</span><ArrowUpRight size={13} className="mb-1.5 text-fg-muted transition group-hover:text-action" /></div>
      <div className="mt-1 text-[11px] text-fg-muted">{detail}</div>
    </Link>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-sm text-fg-muted">{children}</div>;
}

export default function CMSDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const initialLoadStarted = useRef(false);

  const fetchSnapshot = useCallback(async (initial = false) => {
    if (initial) setLoading(true); else setRefreshing(true);
    try {
      const response = await fetch("/api/command-center", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error("snapshot unavailable");
      setSnapshot(body.data);
      setUnavailable(false);
    } catch (error) {
      setUnavailable(true);
      if (!initial) throw error;
    } finally {
      if (initial) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void fetchSnapshot(true);
  }, [fetchSnapshot]);
  usePolling(fetchSnapshot);

  const readiness = snapshot?.readiness ?? "attention";
  const state = readinessMeta[readiness];
  const StateIcon = state.icon;
  const env = snapshot?.infrastructure.defaultEnvironment ?? null;
  const flow = snapshot?.content.byStatus ?? { draft: 0, inReview: 0, approved: 0, scheduled: 0, published: 0 };
  const flowTotal = Math.max(1, flow.draft + flow.inReview + flow.approved + flow.scheduled + flow.published);

  return (
    <AdminLayout>
      <div className="mx-auto w-full max-w-[1460px] pb-14">
        <header className="flex flex-wrap items-start justify-between gap-5 pb-8">
          <div>
            <p className="mb-2 text-[12px] font-medium text-fg-muted">Workspace overview</p>
            <h1 className="m-0 font-headline text-4xl font-bold tracking-[-0.035em] text-fg-primary md:text-5xl">Command Center</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-fg-muted">What is moving, what needs attention, and whether the platform is ready to operate.</p>
          </div>
          <div className="flex items-center gap-3 pt-1">
            {snapshot?.generatedAt && <span className="hidden text-[11px] text-fg-muted sm:inline">Updated {timeAgo(snapshot.generatedAt)}</span>}
            <button onClick={() => void fetchSnapshot(false)} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-lg bg-surface-2 px-3 text-[11px] font-medium text-fg-muted transition hover:bg-surface-2 hover:text-fg-secondary disabled:opacity-50"><RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />Refresh</button>
          </div>
        </header>

        {unavailable && (
          <div className="mb-7 flex items-center justify-between gap-4 rounded-xl bg-warning-muted px-4 py-3 text-[12px] text-amber-200/80">
            <span>Some workspace telemetry is temporarily unavailable. The dashboard will retry automatically.</span>
            <button onClick={() => void fetchSnapshot(false)} className="shrink-0 text-[11px] font-medium text-amber-200">Retry</button>
          </div>
        )}

        <section className="grid gap-10 border-y border-subtle py-9 lg:grid-cols-[1.35fr_.65fr]">
          <div className="min-w-0">
            <div className={`flex items-center gap-2 text-[12px] font-medium ${state.tone}`}><StateIcon size={15} strokeWidth={1.7} />{loading ? "Reading workspace state…" : state.label}</div>
            <h2 className="mt-4 max-w-3xl font-headline text-3xl font-semibold leading-[1.15] tracking-[-0.025em] text-fg-primary md:text-4xl">{loading ? "Building an operational picture…" : state.headline}</h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-fg-muted">{snapshot?.attention.length ? `${snapshot.attention.length} signal${snapshot.attention.length === 1 ? "" : "s"} are currently surfaced from content, delivery, governance and infrastructure.` : "No blocking or warning signals are currently recorded."}</p>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-[12px]">
              <Link href="/admin/entries" className="text-fg-secondary no-underline hover:text-fg-primary">Create content <ArrowUpRight size={12} className="ml-1 inline" /></Link>
              <Link href="/admin/models" className="text-fg-secondary no-underline hover:text-fg-primary">Build a model <ArrowUpRight size={12} className="ml-1 inline" /></Link>
              <Link href="/admin/releases" className="text-fg-secondary no-underline hover:text-fg-primary">Prepare release <ArrowUpRight size={12} className="ml-1 inline" /></Link>
              <Link href="/admin/infrastructure" className="text-fg-secondary no-underline hover:text-fg-primary">Run System Doctor <ArrowUpRight size={12} className="ml-1 inline" /></Link>
            </div>
          </div>

          <div className="lg:border-l lg:border-subtle lg:pl-8">
            <div className="flex items-center justify-between"><span className="text-[12px] font-medium text-fg-muted">Current environment</span><Server size={15} className="text-fg-muted" /></div>
            <div className="mt-4 text-xl font-semibold text-fg-primary">{loading ? "—" : env?.name || "Not configured"}</div>
            {env ? (
              <dl className="mt-5 space-y-3 text-[12px]">
                <div className="flex justify-between gap-4"><dt className="text-fg-muted">Type</dt><dd className="m-0 text-fg-secondary">{humanize(env.kind)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-fg-muted">State</dt><dd className="m-0 flex items-center gap-2 text-fg-secondary"><StatusMark status={env.status} />{humanize(env.status)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-fg-muted">Schema</dt><dd className="m-0 max-w-[180px] truncate font-mono text-[10px] text-fg-muted">{env.deployed_schema_revision || "No recorded deployment"}</dd></div>
              </dl>
            ) : <p className="mt-4 max-w-xs text-[12px] leading-5 text-fg-muted">Create an environment to activate provisioning, deployment health and reconciliation.</p>}
            <Link href="/admin/environments" className="mt-5 inline-flex items-center gap-1 text-[11px] font-medium text-action no-underline">Manage environments <ArrowUpRight size={11} /></Link>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-x-6 gap-y-8 border-b border-subtle py-8 sm:grid-cols-4 xl:grid-cols-8 xl:divide-x xl:divide-[var(--border-subtle)]">
          <Stat label="Models" value={loading ? "—" : snapshot?.content.models ?? 0} detail="Active schemas" href="/admin/models" icon={Layers3} />
          <Stat label="Entries" value={loading ? "—" : snapshot?.content.entries ?? 0} detail="Active content" href="/admin/entries" icon={FileText} />
          <Stat label="Media" value={loading ? "—" : snapshot?.content.assets ?? 0} detail="Stored assets" href="/admin/media" icon={Image} />
          <Stat label="My work" value={loading ? "—" : snapshot?.workflow.myAssignments ?? 0} detail="Open assignments" href="/admin/my-work" icon={GitPullRequest} />
          <Stat label="Releases" value={loading ? "—" : snapshot?.releases.open ?? 0} detail="Open bundles" href="/admin/releases" icon={Rocket} />
          <Stat label="Delivery" value={loading ? "—" : (snapshot?.delivery.queued ?? 0) + (snapshot?.delivery.running ?? 0)} detail="In flight" href="/admin/operations" icon={Zap} />
          <Stat label="Health" value={loading ? "—" : snapshot?.assurance.open ?? 0} detail="Open findings" href="/admin/assurance" icon={ShieldCheck} />
          <Stat label="Connections" value={loading ? "—" : `${snapshot?.infrastructure.connections.active ?? 0}/${snapshot?.infrastructure.connections.total ?? 0}`} detail="Active / total" href="/admin/connections" icon={Plug} />
        </section>

        <div className="grid gap-12 py-10 xl:grid-cols-[1.05fr_.95fr]">
          <section>
            <div className="flex items-end justify-between gap-4"><div><p className="text-[12px] font-medium text-fg-muted">What needs you</p><h2 className="mt-1 text-xl font-semibold text-fg-primary">Attention</h2></div><Link href="/admin/my-work" className="text-[11px] text-fg-muted no-underline hover:text-fg-secondary">Open My Work</Link></div>
            <div className="mt-5 divide-y divide-[var(--border-subtle)] border-y border-subtle">
              {!loading && !snapshot?.attention.length && <div className="flex items-center gap-3 py-5 text-sm text-fg-muted"><CheckCircle2 size={16} className="text-success" />Nothing requires intervention right now.</div>}
              {(snapshot?.attention ?? []).slice(0, 8).map((item) => (
                <Link key={item.key} href={item.href} className="group flex items-start gap-4 py-4 no-underline">
                  <div className={`mt-1 ${item.severity === "blocking" ? "text-danger" : item.severity === "warning" ? "text-warning" : "text-info"}`}>{item.severity === "blocking" ? <XCircle size={15} /> : item.severity === "warning" ? <AlertTriangle size={15} /> : <CircleDot size={15} />}</div>
                  <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><span className="text-[13px] font-medium text-fg-secondary group-hover:text-fg-primary">{item.title}</span><span className="text-[11px] text-fg-muted">{item.count}</span></div><p className="mt-1 text-[12px] leading-5 text-fg-muted">{item.detail}</p></div>
                  <ArrowUpRight size={12} className="mt-1 text-fg-disabled transition group-hover:text-fg-muted" />
                </Link>
              ))}
            </div>
          </section>

          <section>
            <div><p className="text-[12px] font-medium text-fg-muted">Editorial lifecycle</p><h2 className="mt-1 text-xl font-semibold text-fg-primary">Content flow</h2></div>
            <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-surface-2">
              <span style={{ width: `${(flow.draft / flowTotal) * 100}%`, backgroundColor: "var(--pending-fg)" }} />
              <span style={{ width: `${(flow.inReview / flowTotal) * 100}%`, backgroundColor: "var(--review-fg)" }} />
              <span style={{ width: `${(flow.approved / flowTotal) * 100}%`, backgroundColor: "var(--info-fg)" }} />
              <span style={{ width: `${(flow.scheduled / flowTotal) * 100}%`, backgroundColor: "var(--warning-fg)" }} />
              <span style={{ width: `${(flow.published / flowTotal) * 100}%`, backgroundColor: "var(--success-fg)" }} />
            </div>
            <div className="mt-6 grid grid-cols-5 gap-3">
              {[["Draft", flow.draft], ["Review", flow.inReview], ["Approved", flow.approved], ["Scheduled", flow.scheduled], ["Published", flow.published]].map(([label, value]) => <div key={String(label)}><div className="text-xl font-semibold text-fg-secondary">{loading ? "—" : value}</div><div className="mt-1 text-[10px] text-fg-muted">{label}</div></div>)}
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 border-t border-subtle pt-5 text-[12px] text-fg-muted"><Link href="/admin/workflows" className="no-underline hover:text-fg-secondary">{flow.inReview} awaiting review</Link><Link href="/admin/calendar" className="no-underline hover:text-fg-secondary">{flow.scheduled} scheduled entries</Link><Link href="/admin/releases" className="no-underline hover:text-fg-secondary">{snapshot?.releases.scheduled ?? 0} scheduled releases</Link></div>
          </section>
        </div>

        <div className="grid gap-10 border-t border-subtle py-10 lg:grid-cols-3">
          <section>
            <div className="flex items-center justify-between"><h3 className="text-[15px] font-semibold text-fg-secondary">Delivery</h3><Link href="/admin/operations" className="text-[11px] text-fg-muted no-underline hover:text-fg-secondary">Open</Link></div>
            <div className="mt-5 flex gap-8"><div><div className="text-2xl font-semibold text-fg-primary">{snapshot?.delivery.queued ?? 0}</div><div className="mt-1 text-[10px] text-fg-muted">Queued</div></div><div><div className="text-2xl font-semibold text-fg-primary">{snapshot?.delivery.running ?? 0}</div><div className="mt-1 text-[10px] text-fg-muted">Running</div></div><div><div className={`text-2xl font-semibold ${(snapshot?.delivery.deadLetter ?? 0) ? "text-danger" : "text-fg-primary"}`}>{snapshot?.delivery.deadLetter ?? 0}</div><div className="mt-1 text-[10px] text-fg-muted">Dead letter</div></div></div>
            <div className="mt-5 divide-y divide-[var(--border-subtle)]">{(snapshot?.delivery.recent ?? []).slice(0, 4).map((job) => <div key={job.id} className="flex items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-2"><StatusMark status={job.status} /><div className="truncate text-[12px] text-fg-muted">{humanize(job.kind)}</div></div><span className="text-[10px] text-fg-disabled">{timeAgo(job.updated_at)}</span></div>)}{!snapshot?.delivery.recent.length && <EmptyLine>No delivery activity yet.</EmptyLine>}</div>
          </section>

          <section>
            <div className="flex items-center justify-between"><h3 className="text-[15px] font-semibold text-fg-secondary">Infrastructure</h3><Link href="/admin/infrastructure" className="text-[11px] text-fg-muted no-underline hover:text-fg-secondary">Open</Link></div>
            <dl className="mt-5 divide-y divide-[var(--border-subtle)] text-[12px]"><div className="flex justify-between py-3"><dt className="text-fg-muted">Environments</dt><dd className="m-0 text-fg-secondary">{snapshot?.infrastructure.environments.ready ?? 0}/{snapshot?.infrastructure.environments.total ?? 0} ready</dd></div><div className="flex justify-between py-3"><dt className="text-fg-muted">Connections</dt><dd className="m-0 text-fg-secondary">{snapshot?.infrastructure.connections.active ?? 0}/{snapshot?.infrastructure.connections.total ?? 0} active</dd></div><div className="flex justify-between py-3"><dt className="text-fg-muted">Problems</dt><dd className={`m-0 ${(snapshot?.infrastructure.environments.problem ?? 0) + (snapshot?.infrastructure.connections.problem ?? 0) ? "text-danger" : "text-success"}`}>{(snapshot?.infrastructure.environments.problem ?? 0) + (snapshot?.infrastructure.connections.problem ?? 0)}</dd></div></dl>
            <div className="mt-5 flex gap-5 text-[11px]"><Link href="/admin/environments" className="text-fg-muted no-underline hover:text-fg-secondary">Environments</Link><Link href="/admin/connections" className="text-fg-muted no-underline hover:text-fg-secondary">Connections</Link><Link href="/admin/infrastructure" className="text-fg-muted no-underline hover:text-fg-secondary"><Wrench size={11} className="mr-1 inline" />Doctor</Link></div>
          </section>

          <section>
            <div className="flex items-center justify-between"><h3 className="text-[15px] font-semibold text-fg-secondary">Assurance</h3><Link href="/admin/assurance" className="text-[11px] text-fg-muted no-underline hover:text-fg-secondary">Open</Link></div>
            <div className="mt-5 flex gap-8"><div><div className="text-2xl font-semibold text-fg-primary">{snapshot?.assurance.open ?? 0}</div><div className="mt-1 text-[10px] text-fg-muted">Open</div></div><div><div className="text-2xl font-semibold text-warning">{snapshot?.assurance.warnings ?? 0}</div><div className="mt-1 text-[10px] text-fg-muted">Warnings</div></div><div><div className="text-2xl font-semibold text-danger">{snapshot?.assurance.blocking ?? 0}</div><div className="mt-1 text-[10px] text-fg-muted">Blocking</div></div></div>
            <div className="mt-5 divide-y divide-[var(--border-subtle)]">{(snapshot?.assurance.recent ?? []).slice(0, 3).map((finding) => <div key={finding.id} className="py-3"><div className="truncate text-[12px] text-fg-muted">{finding.title}</div><div className="mt-1 text-[10px] text-fg-disabled">{humanize(finding.entity_type)} · {timeAgo(finding.last_detected_at)}</div></div>)}{!snapshot?.assurance.recent.length && <EmptyLine>No health findings yet.</EmptyLine>}</div>
          </section>
        </div>

        <div className="grid gap-12 border-t border-subtle py-10 xl:grid-cols-[.85fr_1.15fr]">
          <section>
            <div className="flex items-center justify-between"><h3 className="text-[15px] font-semibold text-fg-secondary">Recent releases</h3><Link href="/admin/releases" className="text-[11px] text-fg-muted no-underline hover:text-fg-secondary">All releases</Link></div>
            <div className="mt-4 divide-y divide-[var(--border-subtle)]">{(snapshot?.releases.recent ?? []).length ? snapshot!.releases.recent.slice(0, 5).map((release) => <Link key={release.id} href={`/admin/releases/${release.id}`} className="group flex items-center justify-between gap-4 py-3 no-underline"><div className="min-w-0"><div className="truncate text-[12px] font-medium text-fg-muted group-hover:text-fg-secondary">{release.name}</div><div className="mt-1 flex items-center gap-2 text-[10px] text-fg-disabled"><StatusMark status={release.status} />{humanize(release.status)}</div></div><span className="text-[10px] text-fg-disabled">{timeAgo(release.updated_at)}</span></Link>) : <EmptyLine>No release activity yet.</EmptyLine>}</div>
          </section>

          <section>
            <div className="flex items-center justify-between"><h3 className="text-[15px] font-semibold text-fg-secondary">Platform activity</h3><Sparkles size={14} className="text-fg-disabled" /></div>
            <div className="mt-4 grid gap-x-8 md:grid-cols-2">{(snapshot?.recentActivity ?? []).slice(0, 8).map((event) => <div key={event.id} className="flex min-w-0 gap-3 border-t border-subtle py-3"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-action/60" /><div className="min-w-0"><div className="truncate text-[11px] text-fg-muted">{humanize(event.action)}</div><div className="mt-1 text-[10px] text-fg-disabled">{humanize(event.entity_type)} · {timeAgo(event.created_at)}</div></div></div>)}{!snapshot?.recentActivity.length && <EmptyLine>No platform activity yet.</EmptyLine>}</div>
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
