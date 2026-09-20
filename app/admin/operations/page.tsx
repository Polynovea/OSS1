"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleOff, Clock3, Copy, RefreshCw, RotateCcw, ShieldAlert, Webhook, XCircle } from "lucide-react";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import AdminLayout from "@/components/admin/AdminLayout";

type Job = {
  id: string;
  kind: string;
  status: string;
  correlation_id: string;
  idempotency_key: string;
  safe_metadata_json: Record<string, unknown>;
  run_after: string;
  attempt_count: number;
  max_attempts: number;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  replay_of_job_id: string | null;
};

type Attempt = {
  id: string;
  attempt_number: number;
  worker_id: string;
  outcome: string;
  request_metadata_json: Record<string, unknown>;
  response_metadata_json: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  latency_ms: number | null;
};

type JobDetail = { job: Job; attempts: Attempt[]; audit: Array<{ id: string; action: string; metadata_json: Record<string, unknown>; created_at: string }> };

type Health = {
  id: string;
  destination_kind: string;
  destination_id: string;
  health_state: string;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_latency_ms: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: string;
};

type WebhookSubscription = {
  id: string;
  name: string;
  endpoint_url: string;
  event_filters: string[];
  active: boolean;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
};

type WebhookDelivery = {
  id: string;
  subscription_id: string;
  event_type: string;
  event_id: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error: string | null;
  response_status: number | null;
  completed_at: string | null;
  created_at: string;
  webhook_subscriptions?: { name?: string; endpoint_url?: string; active?: boolean };
};

const shortId = (value?: string | null) => value ? value.slice(0, 8) : "—";
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";

async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const authHeaders = await getAuthHeaders();
  if (!authHeaders.Authorization) {
    throw new Error("Admin session is unavailable. Please sign in again.");
  }
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(authHeaders)) headers.set(key, value);
  return fetch(input, { ...init, headers });
}

function statusClass(status: string) {
  if (["succeeded", "healthy"].includes(status)) return "border-success bg-success-muted text-success";
  if (["dead_letter", "failed", "unhealthy", "cancelled"].includes(status)) return "border-danger bg-danger-muted text-danger";
  if (["retrying", "degraded"].includes(status)) return "border-warning bg-warning-muted text-warning";
  if (["running"].includes(status)) return "border-info bg-info-muted text-info";
  return "border-subtle bg-surface-2 text-fg-secondary";
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${statusClass(value)}`}>{value.replace(/_/g, " ")}</span>;
}

export default function DeliveryOperationsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [rotatedSecret, setRotatedSecret] = useState<{ id: string; secret: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (kindFilter) params.set("kind", kindFilter);
      const [jobsRes, healthRes, webhooksRes] = await Promise.all([
        authenticatedFetch(`/api/operations/jobs?${params.toString()}`),
        authenticatedFetch("/api/operations/health"),
        authenticatedFetch("/api/operations/webhooks"),
      ]);
      const [jobsBody, healthBody, webhooksBody] = await Promise.all([jobsRes.json(), healthRes.json(), webhooksRes.json()]);
      if (!jobsRes.ok) throw new Error(jobsBody.error || "Could not load delivery jobs");
      if (!healthRes.ok) throw new Error(healthBody.error || "Could not load destination health");
      if (!webhooksRes.ok) throw new Error(webhooksBody.error || "Could not load webhook operations");
      setJobs(jobsBody.data ?? []);
      setHealth(healthBody.data ?? []);
      setSubscriptions(webhooksBody.data?.subscriptions ?? []);
      setDeliveries(webhooksBody.data?.deliveries ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Delivery Operations");
    } finally {
      setLoading(false);
    }
  }, [kindFilter, statusFilter]);

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    const response = await authenticatedFetch(`/api/operations/jobs/${id}`);
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "Could not load job detail");
      return;
    }
    setDetail(body.data);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [loadDetail, selectedId]);

  const stats = useMemo(() => ({
    active: jobs.filter((job) => ["queued", "running", "retrying"].includes(job.status)).length,
    dead: jobs.filter((job) => job.status === "dead_letter").length,
    succeeded: jobs.filter((job) => job.status === "succeeded").length,
    unhealthy: health.filter((item) => ["degraded", "unhealthy"].includes(item.health_state)).length,
  }), [health, jobs]);

  async function mutateJob(id: string, operation: "replay" | "cancel") {
    setWorking(`${operation}:${id}`);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/operations/jobs/${id}/${operation}`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Could not ${operation} job`);
      await load();
      if (selectedId === id) setSelectedId(operation === "replay" ? body.data?.id ?? null : id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not ${operation} job`);
    } finally {
      setWorking("");
    }
  }

  async function mutateWebhook(id: string, body: Record<string, unknown>) {
    setWorking(`webhook:${id}`);
    setError("");
    try {
      const response = await authenticatedFetch(`/api/operations/webhooks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update webhook subscription");
      if (body.operation === "rotate_secret" && result.data?.signingSecret) {
        setRotatedSecret({ id, secret: result.data.signingSecret });
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update webhook subscription");
    } finally {
      setWorking("");
    }
  }

  return (
    <AdminLayout>
    <div className="ui-page mx-auto max-w-[1500px]">
      <header className="ui-page-header"><div><p className="ui-eyebrow">Delivery Operations Centre</p><h1 className="ui-page-title">Durable Delivery Control Plane</h1><p className="ui-page-description">Inspect PostgreSQL-backed jobs, attempts, retries, dead letters, destination health and webhook delivery state. Normal delivery execution belongs to the external worker, not a request lifecycle.</p></div><button onClick={() => void load()} disabled={loading} className="ui-btn ui-btn-secondary"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button></header>

      {error && <div className="ui-alert ui-alert-danger mt-5">{error}</div>}

      <section className="grid gap-6 border-b border-subtle py-7 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active jobs" value={stats.active} icon={<Clock3 size={16} />} />
        <Metric label="Dead letters" value={stats.dead} icon={<ShieldAlert size={16} />} />
        <Metric label="Succeeded" value={stats.succeeded} icon={<CheckCircle2 size={16} />} />
        <Metric label="Unhealthy destinations" value={stats.unhealthy} icon={<AlertTriangle size={16} />} />
      </section>

      <div className="grid gap-8 py-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,0.75fr)]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-subtle pb-4">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fg-muted">Durable queue</p><h2 className="mt-1 text-lg font-bold">Jobs</h2></div>
            <div className="flex gap-2">
              <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="rounded-lg border border-subtle bg-field px-3 py-2 text-xs text-fg-secondary">
                <option value="">All kinds</option><option value="publish">Publish</option><option value="webhook">Webhook</option><option value="scheduled_release">Scheduled release</option><option value="search_index">Search index</option><option value="image_processing">Image processing</option><option value="health_scan">Health scan</option><option value="analytics_sync">Analytics sync</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-subtle bg-field px-3 py-2 text-xs text-fg-secondary">
                <option value="">All states</option><option value="queued">Queued</option><option value="running">Running</option><option value="retrying">Retrying</option><option value="succeeded">Succeeded</option><option value="dead_letter">Dead letter</option><option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto border-b border-subtle">
            <table className="ui-table min-w-[760px]">
              <thead className="border-b border-subtle text-[9px] uppercase tracking-wider text-fg-muted"><tr><th className="px-4 py-3">Job</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Attempts</th><th className="px-4 py-3">Correlation</th><th className="px-4 py-3">Next / created</th></tr></thead>
              <tbody>
                {jobs.map((job) => <tr key={job.id} onClick={() => setSelectedId(job.id)} className={`cursor-pointer border-b border-subtle hover:bg-surface-2 ${selectedId === job.id ? "bg-action/[0.04]" : ""}`}>
                  <td className="px-4 py-3"><p className="font-semibold text-fg-primary">{job.kind.replace(/_/g, " ")}</p><p className="mt-1 font-mono text-[10px] text-fg-muted">{shortId(job.id)}</p></td>
                  <td className="px-4 py-3"><StatusBadge value={job.status} />{job.last_error_code && <p className="mt-1 text-[9px] text-danger">{job.last_error_code}</p>}</td>
                  <td className="px-4 py-3 text-fg-secondary">{job.attempt_count}/{job.max_attempts}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-fg-muted">{shortId(job.correlation_id)}</td>
                  <td className="px-4 py-3 text-[10px] text-fg-muted">{["queued", "retrying"].includes(job.status) ? date(job.run_after) : date(job.created_at)}</td>
                </tr>)}
                {!loading && jobs.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-fg-muted">No jobs match the current filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="xl:border-l xl:border-subtle xl:pl-6">
          {!detail ? <div className="flex min-h-64 items-center justify-center text-sm text-fg-muted">Select a job to inspect attempts and recovery actions.</div> : <>
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-action">Job detail</p><h2 className="mt-1 text-lg font-bold">{detail.job.kind.replace(/_/g, " ")}</h2></div><StatusBadge value={detail.job.status} /></div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-[10px]"><Info label="Job" value={detail.job.id} mono /><Info label="Correlation" value={detail.job.correlation_id} mono /><Info label="Idempotency" value={detail.job.idempotency_key} mono /><Info label="Attempts" value={`${detail.job.attempt_count}/${detail.job.max_attempts}`} /></div>
            {detail.job.last_error_message && <div className="mt-4 rounded-xl border border-danger bg-danger-muted p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-danger">Last error</p><p className="mt-1 text-xs leading-5 text-red-100">{detail.job.last_error_message}</p></div>}
            <div className="mt-4 flex flex-wrap gap-2">
              {["dead_letter", "succeeded", "cancelled"].includes(detail.job.status) && <button disabled={working !== ""} onClick={() => void mutateJob(detail.job.id, "replay")} className="inline-flex items-center gap-1.5 rounded-lg border border-action/25 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-action"><RotateCcw size={12} /> Replay</button>}
              {["queued", "running", "retrying"].includes(detail.job.status) && <button disabled={working !== ""} onClick={() => void mutateJob(detail.job.id, "cancel")} className="inline-flex items-center gap-1.5 rounded-lg border border-danger px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-danger"><CircleOff size={12} /> Cancel</button>}
            </div>
            <div className="mt-5 border-t border-subtle pt-4"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fg-muted">Attempt history</p><div className="mt-3 space-y-2">{detail.attempts.map((attempt) => <div key={attempt.id} className="rounded-xl border border-subtle bg-field p-3"><div className="flex items-center justify-between"><p className="text-xs font-semibold text-fg-primary">Attempt {attempt.attempt_number}</p><StatusBadge value={attempt.outcome} /></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-fg-muted"><span>worker {attempt.worker_id}</span><span>{attempt.latency_ms === null ? "latency —" : `${attempt.latency_ms} ms`}</span><span>{date(attempt.started_at)}</span></div>{attempt.error_message && <p className="mt-2 text-[10px] leading-4 text-danger">{attempt.error_code ? `${attempt.error_code}: ` : ""}{attempt.error_message}</p>}</div>)}{detail.attempts.length === 0 && <p className="text-xs text-fg-muted">No worker has claimed this job yet.</p>}</div></div>
          </>}
        </section>
      </div>

      <section className="ui-section">
        <div className="flex items-center gap-2"><Webhook size={16} className="text-action" /><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fg-muted">Destination health</p><h2 className="mt-1 text-lg font-bold">Publication targets & webhooks</h2></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{health.map((item) => <div key={item.id} className="rounded-xl border border-subtle bg-field p-4"><div className="flex items-center justify-between"><p className="text-xs font-semibold capitalize text-fg-primary">{item.destination_kind.replace(/_/g, " ")}</p><StatusBadge value={item.health_state} /></div><p className="mt-2 font-mono text-[10px] text-fg-muted">{item.destination_id}</p><div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-fg-muted"><span>Failures: {item.consecutive_failures}</span><span>Latency: {item.last_latency_ms ?? "—"}{item.last_latency_ms !== null ? " ms" : ""}</span><span>Last success: {date(item.last_success_at)}</span><span>Last failure: {date(item.last_failure_at)}</span></div>{item.last_error_message && <p className="mt-2 text-[10px] text-danger">{item.last_error_message}</p>}</div>)}{health.length === 0 && <p className="text-xs text-fg-muted">Destination health will appear after the worker records delivery outcomes.</p>}</div>
      </section>

      <section className="ui-section">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fg-muted">Webhook inspector</p><h2 className="mt-1 text-lg font-bold">Subscriptions & recent deliveries</h2></div>
        {rotatedSecret && <div className="mt-4 rounded-xl border border-warning bg-warning-muted p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-warning">New signing secret — copy now</p><div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-field p-2 text-xs text-fg-primary">{rotatedSecret.secret}</code><button onClick={() => void navigator.clipboard.writeText(rotatedSecret.secret)} className="rounded-lg border border-subtle p-2 text-fg-secondary"><Copy size={14} /></button><button onClick={() => setRotatedSecret(null)} className="rounded-lg border border-subtle p-2 text-fg-muted"><XCircle size={14} /></button></div></div>}
        <div className="mt-4 grid gap-3 lg:grid-cols-2">{subscriptions.map((subscription) => <div key={subscription.id} className="rounded-xl border border-subtle bg-field p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-fg-primary">{subscription.name}</p><p className="mt-1 break-all text-[10px] text-fg-muted">{subscription.endpoint_url}</p></div><StatusBadge value={subscription.active ? "healthy" : "cancelled"} /></div><p className="mt-2 text-[10px] text-fg-muted">Filters: {subscription.event_filters.length ? subscription.event_filters.join(", ") : "all events"} · failures {subscription.consecutive_failures}</p><div className="mt-3 flex gap-2"><button disabled={working !== ""} onClick={() => void mutateWebhook(subscription.id, { operation: "set_active", active: !subscription.active })} className="rounded-lg border border-subtle px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-fg-secondary">{subscription.active ? "Disable" : "Enable"}</button><button disabled={working !== ""} onClick={() => void mutateWebhook(subscription.id, { operation: "rotate_secret" })} className="rounded-lg border border-action/20 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-action">Rotate secret</button></div></div>)}{subscriptions.length === 0 && <p className="text-xs text-fg-muted">No webhook subscriptions configured.</p>}</div>
        <div className="mt-5 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-subtle text-[9px] uppercase tracking-wider text-fg-muted"><tr><th className="py-3 pr-4">Event</th><th className="px-4 py-3">Subscription</th><th className="px-4 py-3">State</th><th className="px-4 py-3">HTTP</th><th className="px-4 py-3">Attempts</th><th className="px-4 py-3">Created</th></tr></thead><tbody>{deliveries.slice(0, 50).map((delivery) => <tr key={delivery.id} className="border-b border-subtle"><td className="py-3 pr-4"><p className="font-semibold text-fg-primary">{delivery.event_type}</p><p className="mt-1 font-mono text-[10px] text-fg-muted">{shortId(delivery.id)}</p></td><td className="px-4 py-3 text-fg-secondary">{delivery.webhook_subscriptions?.name ?? shortId(delivery.subscription_id)}</td><td className="px-4 py-3"><StatusBadge value={delivery.status === "failed" ? "dead_letter" : delivery.status} /></td><td className="px-4 py-3 text-fg-muted">{delivery.response_status ?? "—"}</td><td className="px-4 py-3 text-fg-muted">{delivery.attempt_count}</td><td className="px-4 py-3 text-[10px] text-fg-muted">{date(delivery.created_at)}</td></tr>)}</tbody></table></div>
      </section>

      <div className="ui-alert ui-alert-info mt-6"><strong>Worker boundary:</strong> run <code className="rounded bg-field px-1.5 py-0.5">npm run worker:delivery</code> in a persistent worker/container/process. The worker connects directly to PostgreSQL and processes publish, scheduled-release, webhook, search-index, image-processing, health-scan and analytics-sync jobs.</div>
    </div>
    </AdminLayout>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <div className="min-w-0"><div className="flex items-center gap-2 text-fg-muted">{icon}<p className="text-[11px] font-medium">{label}</p></div><p className="mt-2 text-3xl font-semibold text-fg-primary">{value}</p></div>;
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="border-t border-subtle py-2"><p className="text-[10px] font-medium text-fg-muted">{label}</p><p className={`mt-1 break-all text-fg-secondary ${mono ? "font-mono" : ""}`}>{value}</p></div>;
}
