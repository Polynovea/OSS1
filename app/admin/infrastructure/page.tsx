"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  CheckCircle2,
  CircleAlert,
  Database,
  ExternalLink,
  HardDrive,
  HeartPulse,
  RefreshCw,
  Rocket,
  ServerCog,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import AdminLayout from "@/components/admin/AdminLayout";
import { getAuthHeaders } from "@/lib/admin/authCheck";

type Component = {
  id: string;
  environment_id: string;
  capability_key: string;
  component_key: string;
  provider: string | null;
  required: boolean;
  state: string;
  current_version: string | null;
  required_version: string | null;
  last_checked_at: string | null;
  last_error: string | null;
};

type Env = {
  id: string;
  key: string;
  name: string;
  kind: string;
  status: string;
  is_default: boolean;
  database_provider: string | null;
  storage_provider: string | null;
  runtime_provider: string | null;
  components?: Component[];
  connectionSummary?: { total: number; healthy: number; degraded: number };
};

type Doctor = {
  id: string;
  environment_id: string;
  status: string;
  findings_json: Array<{ key: string; severity: string; message: string; owner: string; repairHref: string; evidence?: Record<string, unknown> }>;
  summary_json: Record<string, number>;
  checked_at: string;
};

type Backup = { id: string; environment_id: string; status: string; checksum_sha256: string | null; size_bytes: number | null; created_at: string; verified_at: string | null };
type Upgrade = { id: string; environment_id: string; status: string; risk: string; from_app_version: string | null; to_app_version: string | null; current_migration: string | null; target_migration: string | null; plan_json: any; created_at: string };
type Approval = { id: string; environment_id: string | null; operation: string; entity_type: string; entity_id: string; status: string; reason: string | null; requested_by: string | null; reviewed_by: string | null; created_at: string };
type Website = { id: string; environment_id: string; connection_id: string; integration_method: string; model_api_keys: string[]; status: string; last_test_job_id: string | null; last_test_at: string | null; last_error: string | null };
type Connection = { id: string; environment_id: string; connector_family: string; connector_type: string; name: string; status: string };
type ProvisioningRun = { id: string; provider_kind: string; operation: string; status: string; created_at: string };
type Overview = { doctorRuns: Doctor[]; provisioningRuns: ProvisioningRun[]; components: Component[]; backups: Backup[]; upgrades: Upgrade[]; approvals: Approval[]; websites: Website[] };

type Tab = "setup" | "components" | "website" | "doctor" | "backup" | "upgrade" | "approvals" | "local";

async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const auth = await getAuthHeaders();
  if (!auth.Authorization) throw new Error("Admin session unavailable. Please sign in again.");
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(auth)) headers.set(key, value);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(input, { ...init, headers });
}

const fmt = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const humanize = (value: string) => value.replaceAll("_", " ");

function Status({ value }: { value: string }) {
  const good = ["ready", "healthy", "active", "present", "verified", "succeeded", "approved", "fresh"].includes(value);
  const bad = ["blocked", "failed", "missing", "rejected", "destructive", "dead_letter"].includes(value);
  const review = ["review", "review_required", "awaiting_approval"].includes(value);
  const className = good ? "ui-badge ui-badge-success" : bad ? "ui-badge ui-badge-danger" : review ? "ui-badge ui-badge-review" : "ui-badge ui-badge-warning";
  return <span className={className}>{humanize(value)}</span>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block min-w-0"><span className="block text-[12px] font-medium text-fg-secondary">{label}</span>{children}{hint ? <span className="mt-1 block text-[11px] leading-4 text-fg-muted">{hint}</span> : null}</label>;
}

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "setup", label: "Setup" },
  { key: "components", label: "Components" },
  { key: "website", label: "Website" },
  { key: "doctor", label: "System Doctor" },
  { key: "backup", label: "Backup & restore" },
  { key: "upgrade", label: "Upgrade" },
  { key: "approvals", label: "Approvals" },
  { key: "local", label: "Local workspace" },
];

export default function InfrastructurePage() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [overview, setOverview] = useState<Overview>({ doctorRuns: [], provisioningRuns: [], components: [], backups: [], upgrades: [], approvals: [], websites: [] });
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<Tab>("setup");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [localEnabled, setLocalEnabled] = useState(false);
  const [localDir, setLocalDir] = useState("");
  const [localBackupFile, setLocalBackupFile] = useState("");
  const [lastResult, setLastResult] = useState<any>(null);

  const current = useMemo(() => envs.find((environment) => environment.id === selected) ?? envs[0] ?? null, [envs, selected]);

  const load = useCallback(async () => {
    setError("");
    try {
      const query = selected ? `?environmentId=${encodeURIComponent(selected)}` : "";
      const [infraResponse, connectionResponse] = await Promise.all([authFetch(`/api/infrastructure${query}`), authFetch("/api/connections")]);
      const [infraBody, connectionBody] = await Promise.all([infraResponse.json(), connectionResponse.json()]);
      if (!infraResponse.ok) throw new Error(infraBody.error || "Could not load infrastructure");
      setEnvs(infraBody.data.environments ?? []);
      setOverview(infraBody.data.overview ?? {});
      setLocalEnabled(Boolean(infraBody.data.localRuntimeControl));
      if (!selected && infraBody.data.environments?.[0]) setSelected(infraBody.data.environments[0].id);
      if (connectionResponse.ok) setConnections(connectionBody.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load infrastructure");
    }
  }, [selected]);

  useEffect(() => { void load(); }, [load]);

  async function op(operation: string, payload: Record<string, unknown> = {}) {
    if (!current && !operation.startsWith("local_")) throw new Error("Create an environment first");
    setBusy(operation);
    setError("");
    setNotice("");
    try {
      const response = await authFetch("/api/infrastructure", { method: "POST", body: JSON.stringify({ operation, environmentId: current?.id, ...payload }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Operation failed");
      setLastResult(body.data);
      if (operation === "local_backup" && body.data?.file) setLocalBackupFile(String(body.data.file));
      setNotice(`${humanize(operation)} completed.`);
      await load();
      return body.data;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed");
      throw cause;
    } finally {
      setBusy("");
    }
  }

  async function websiteBind(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await op("website_bind", {
      connectionId: data.get("connectionId"),
      integrationMethod: data.get("integrationMethod"),
      modelApiKeys: String(data.get("models") || "").split(",").map((value) => value.trim()).filter(Boolean),
    });
    form.reset();
  }

  async function approvalRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await op("approval_request", { approvalOperation: data.get("approvalOperation"), entityType: data.get("entityType"), entityId: data.get("entityId"), reason: data.get("reason") });
  }

  const latestDoctor = overview.doctorRuns?.[0] ?? null;

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        <header className="ui-page-header">
          <div>
            <p className="ui-eyebrow">Environment control plane</p>
            <h1 className="ui-page-title">Setup & Infrastructure</h1>
            <p className="ui-page-description">Provision, diagnose, connect, back up and upgrade the CMS without SQL or provider-CLI guesswork. Unsupported automation remains explicit instead of being reported as success.</p>
          </div>
          <button onClick={() => void load()} className="ui-btn ui-btn-secondary"><RefreshCw size={14} />Refresh</button>
        </header>

        {error ? <div className="ui-alert ui-alert-danger mt-5">{error}</div> : null}
        {notice ? <div className="ui-alert ui-alert-success mt-5">{notice}</div> : null}

        <div className="grid gap-8 pt-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <Field label="Environment">
              <select value={current?.id ?? ""} onChange={(event) => setSelected(event.target.value)} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm">
                {envs.map((environment) => <option key={environment.id} value={environment.id}>{environment.name} · {environment.kind}</option>)}
              </select>
            </Field>

            {current ? (
              <dl className="mt-5 divide-y divide-[var(--border-subtle)] text-[12px]">
                <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-fg-muted">State</dt><dd className="m-0"><Status value={current.status} /></dd></div>
                <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-fg-muted">Connections</dt><dd className="m-0 text-fg-secondary">{current.connectionSummary?.healthy ?? 0}/{current.connectionSummary?.total ?? 0}</dd></div>
                <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-fg-muted">Database</dt><dd className="m-0 truncate text-fg-secondary">{current.database_provider || "—"}</dd></div>
                <div className="flex items-center justify-between gap-3 py-2.5"><dt className="text-fg-muted">Runtime</dt><dd className="m-0 truncate text-fg-secondary">{current.runtime_provider || "—"}</dd></div>
              </dl>
            ) : <div className="ui-alert ui-alert-warning mt-5">Create an environment first.</div>}

            <div className="mt-5 space-y-1">
              <Link href="/admin/environments" className="block rounded-lg px-2.5 py-2 text-[12px] text-fg-muted no-underline hover:bg-surface-2 hover:text-fg-secondary">Manage environments</Link>
              <Link href="/admin/connections" className="block rounded-lg px-2.5 py-2 text-[12px] text-fg-muted no-underline hover:bg-surface-2 hover:text-fg-secondary">Manage connections</Link>
            </div>
          </aside>

          <main className="min-w-0">
            <nav className="flex flex-wrap gap-1 border-b border-subtle pb-3">
              {tabs.map((item) => (
                <button key={item.key} onClick={() => setTab(item.key)} className={`rounded-lg px-3 py-2 text-[12px] font-medium transition ${tab === item.key ? "bg-surface-2 text-fg-primary" : "text-fg-muted hover:bg-surface-2 hover:text-fg-secondary"}`}>{item.label}</button>
              ))}
            </nav>

            {tab === "setup" ? (
              <section className="ui-section border-0">
                <div className="grid gap-8 lg:grid-cols-2">
                  <div>
                    <ServerCog className="text-icon-secondary" size={20} />
                    <h2 className="ui-section-title mt-3">Guided environment setup</h2>
                    <p className="ui-section-description">Preflight → initialize/upgrade → verify. Every run is persisted and resumable.</p>
                    <div className="mt-5 grid grid-cols-2 gap-2">
                      {(["managed", "postgres", "supabase", "local"] as const).map((provider) => <button key={provider} disabled={Boolean(busy)} onClick={() => void op("provision", { providerKind: provider, provisionOperation: "preflight" })} className="ui-btn ui-btn-secondary justify-start capitalize">Preflight {provider}</button>)}
                    </div>
                  </div>
                  <div>
                    <Wrench className="text-icon-secondary" size={20} />
                    <h2 className="ui-section-title mt-3">First-run path</h2>
                    <ol className="mt-4 space-y-3 text-[13px] leading-5 text-fg-secondary">
                      <li><span className="mr-2 text-fg-muted">1</span>Create/select an environment.</li>
                      <li><span className="mr-2 text-fg-muted">2</span>Connect database, storage, analytics and website services.</li>
                      <li><span className="mr-2 text-fg-muted">3</span>Run provider preflight and component checks.</li>
                      <li><span className="mr-2 text-fg-muted">4</span>Design and apply schemas from Schema Studio.</li>
                      <li><span className="mr-2 text-fg-muted">5</span>Test website delivery through Delivery Ops.</li>
                      <li><span className="mr-2 text-fg-muted">6</span>Run System Doctor and create a verified backup.</li>
                    </ol>
                  </div>
                </div>
                {overview.provisioningRuns?.length ? <div className="mt-8 border-t border-subtle pt-4">{overview.provisioningRuns.slice(0, 8).map((run) => <div key={run.id} className="ui-list-row"><div className="min-w-0 flex-1"><div className="text-[12px] text-fg-secondary">{run.provider_kind} · {humanize(run.operation)}</div><div className="mt-0.5 text-[11px] text-fg-muted">{fmt(run.created_at)}</div></div><Status value={run.status} /></div>)}</div> : null}
              </section>
            ) : null}

            {tab === "components" ? (
              <section className="ui-section border-0">
                <div className="mb-5 flex items-end justify-between gap-4"><div><h2 className="ui-section-title">Deployment components</h2><p className="ui-section-description">Required capabilities, current provider state and explicit deployment actions.</p></div><button onClick={() => void op("components")} className="ui-btn ui-btn-secondary">Refresh capabilities</button></div>
                <div>{overview.components?.map((component) => <div key={component.id} className="ui-list-row items-start py-4"><div className="min-w-0 flex-1"><div className="font-mono text-[12px] text-fg-primary">{component.component_key}</div><div className="mt-1 text-[11px] text-fg-muted">{component.capability_key} · {component.provider || "No provider"} · {component.required ? "Required" : "Optional"}</div>{component.last_error ? <div className="mt-2 text-[11px] text-warning">{component.last_error}</div> : null}</div><div className="flex shrink-0 flex-wrap items-center justify-end gap-2"><Status value={component.state} /><button onClick={() => void op("component_action", { componentId: component.id, componentOperation: "check" })} className="ui-btn ui-btn-tertiary">Check</button><button onClick={() => void op("component_action", { componentId: component.id, componentOperation: "deploy" })} className="ui-btn ui-btn-secondary">Deploy / guide</button></div></div>)}</div>
              </section>
            ) : null}

            {tab === "website" ? (
              <section className="ui-section border-0">
                <div className="mb-5"><h2 className="ui-section-title">Website publishing bootstrap</h2><p className="ui-section-description">Bind a verified website/API connection to content models, then exercise the path through durable Delivery Ops.</p></div>
                <form onSubmit={websiteBind} className="grid gap-4 rounded-2xl bg-surface-1 p-5 md:grid-cols-3">
                  <Field label="Connection"><select name="connectionId" required className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm">{connections.filter((connection) => connection.environment_id === current?.id && ["website", "webhook", "custom"].includes(connection.connector_family)).map((connection) => <option key={connection.id} value={connection.id}>{connection.name} · {connection.status}</option>)}</select></Field>
                  <Field label="Integration method"><select name="integrationMethod" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm"><option value="polynovea_rest">Polynovea REST</option><option value="signed_webhook">Signed webhook</option><option value="custom_rest">Custom REST</option><option value="wordpress">WordPress</option></select></Field>
                  <Field label="Model API keys" hint="Comma-separated; leave blank for all models."><input name="models" placeholder="blog_post, page" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
                  <div className="md:col-span-3"><button className="ui-btn ui-btn-primary">Bind website</button></div>
                </form>
                <div className="mt-6">{overview.websites?.map((website) => <div key={website.id} className="ui-list-row items-start py-4"><div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-fg-primary">{humanize(website.integration_method)}</div><div className="mt-1 text-[11px] text-fg-muted">Models: {website.model_api_keys?.join(", ") || "all"} · Last test {fmt(website.last_test_at)}</div>{website.last_error ? <div className="mt-2 text-[11px] text-danger">{website.last_error}</div> : null}{website.last_test_job_id ? <Link href="/admin/operations" className="mt-2 inline-flex items-center gap-1 text-[11px] text-link no-underline">Open Delivery Ops <ExternalLink size={10} /></Link> : null}</div><div className="flex items-center gap-2"><Status value={website.status} /><button onClick={() => void op("website_test", { bindingId: website.id })} className="ui-btn ui-btn-secondary">Send test</button></div></div>)}</div>
              </section>
            ) : null}

            {tab === "doctor" ? (
              <section className="ui-section border-0">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><HeartPulse className="text-icon-secondary" size={20} /><h2 className="ui-section-title mt-3">System Doctor</h2><p className="ui-section-description max-w-2xl">Database, migrations, required capabilities, worker failures, connections, analytics freshness, encryption readiness and schema drift.</p></div><button onClick={() => void op("doctor")} className="ui-btn ui-btn-primary">Run system check</button></div>
                {latestDoctor ? <div className="mt-6"><div className="mb-3 flex items-center justify-between gap-3"><span className="text-[12px] text-fg-muted">Checked {fmt(latestDoctor.checked_at)}</span><Status value={latestDoctor.status} /></div>{(latestDoctor.findings_json ?? []).length ? latestDoctor.findings_json.map((finding, index) => <div key={`${finding.key}-${index}`} className="ui-list-row items-start py-4"><div className={`mt-0.5 ${finding.severity === "blocking" ? "text-danger" : finding.severity === "warning" ? "text-warning" : "text-info"}`}>{finding.severity === "blocking" ? <CircleAlert size={15} /> : <CheckCircle2 size={15} />}</div><div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-fg-primary">{finding.message}</div><div className="mt-1 text-[11px] text-fg-muted">Owner: {finding.owner}</div><Link href={finding.repairHref} className="mt-1 inline-block text-[11px] text-link no-underline">Open repair surface →</Link></div></div>) : <div className="ui-alert ui-alert-success mt-4">No findings were returned by the latest doctor run.</div>}</div> : <div className="ui-empty mt-6 rounded-xl bg-surface-1"><p className="ui-empty-title">No doctor run yet</p><p className="ui-empty-copy">Run System Doctor to establish live readiness evidence for this environment.</p></div>}
              </section>
            ) : null}

            {tab === "backup" ? (
              <section className="ui-section border-0">
                <div className="grid gap-6 md:grid-cols-2">
                  <button onClick={() => void op("backup")} className="ui-card p-5 text-left transition hover:bg-surface-2"><Archive className="text-icon-secondary" size={20} /><h3 className="mt-3 text-[14px] font-semibold text-fg-primary">Create verified backup</h3><p className="mt-1 text-[12px] leading-5 text-fg-muted">Portable content/governance plus non-secret environment metadata.</p></button>
                  <button onClick={() => void op("portability")} className="ui-card p-5 text-left transition hover:bg-surface-2"><HardDrive className="text-icon-secondary" size={20} /><h3 className="mt-3 text-[14px] font-semibold text-fg-primary">Run portability check</h3><p className="mt-1 text-[12px] leading-5 text-fg-muted">Find provider, asset, secret-reference and component blockers before a move.</p></button>
                </div>
                <div className="mt-6">{overview.backups?.map((backup) => <div key={backup.id} className="ui-list-row"><div className="min-w-0 flex-1"><div className="font-mono text-[12px] text-fg-secondary">{backup.id.slice(0, 8)}</div><div className="mt-0.5 text-[11px] text-fg-muted">{fmt(backup.created_at)} · {backup.size_bytes ? `${Math.round(backup.size_bytes / 1024)} KB` : "—"}</div></div><Status value={backup.status} /><button onClick={() => void op("restore", { backupId: backup.id, dryRun: true })} className="ui-btn ui-btn-tertiary">Restore dry-run</button></div>)}</div>
                {lastResult && tab === "backup" ? <pre className="mt-5 max-h-80 overflow-auto rounded-xl bg-field p-4 text-[11px] text-fg-muted">{JSON.stringify(lastResult, null, 2)}</pre> : null}
              </section>
            ) : null}

            {tab === "upgrade" ? (
              <section className="ui-section border-0">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><Rocket className="text-icon-secondary" size={20} /><h2 className="ui-section-title mt-3">Upgrade Manager</h2><p className="ui-section-description max-w-2xl">Compare application, database migration and worker state. Migration changes require verified backup evidence and approval.</p></div><button onClick={() => void op("upgrade_plan")} className="ui-btn ui-btn-primary">Check upgrade readiness</button></div>
                <div className="mt-6">{overview.upgrades?.map((upgrade) => <div key={upgrade.id} className="ui-list-row items-start py-4"><div className="min-w-0 flex-1"><div className="text-[13px] text-fg-primary">App {upgrade.from_app_version || "?"} → {upgrade.to_app_version || "?"}</div><div className="mt-1 text-[11px] text-fg-muted">Migration {upgrade.current_migration || "?"} → {upgrade.target_migration || "?"}</div>{upgrade.plan_json?.recommendation ? <div className="mt-2 text-[12px] leading-5 text-fg-secondary">{upgrade.plan_json.recommendation}</div> : null}</div><div className="flex gap-2"><Status value={upgrade.risk} /><Status value={upgrade.status} /></div></div>)}</div>
              </section>
            ) : null}

            {tab === "approvals" ? (
              <section className="ui-section border-0">
                <div className="mb-5"><ShieldCheck className="text-icon-secondary" size={20} /><h2 className="ui-section-title mt-3">High-risk approvals</h2><p className="ui-section-description">Request and review operations that require explicit governance rather than silent execution.</p></div>
                <form onSubmit={approvalRequest} className="grid gap-4 rounded-2xl bg-surface-1 p-5 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Operation"><select name="approvalOperation" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm"><option value="schema_promote">Schema promote</option><option value="restore">Restore</option><option value="credential_rotate">Credential rotate</option><option value="component_deploy">Component deploy</option><option value="upgrade">Upgrade</option><option value="provision">Provision</option></select></Field>
                  <Field label="Entity type"><input name="entityType" required placeholder="schema_deployment" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
                  <Field label="Entity ID"><input name="entityId" required placeholder="Entity ID" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
                  <Field label="Reason"><input name="reason" required placeholder="Why is this needed?" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
                  <div className="md:col-span-2 xl:col-span-4"><button className="ui-btn ui-btn-primary">Request approval</button></div>
                </form>
                <div className="mt-6">{overview.approvals?.map((approval) => <div key={approval.id} className="ui-list-row items-start py-4"><div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-fg-primary">{humanize(approval.operation)}</div><div className="mt-1 text-[11px] text-fg-muted">{approval.entity_type} · {approval.entity_id.slice(0, 24)} · {approval.reason || "No reason"}</div></div><Status value={approval.status} />{approval.status === "pending" ? <div className="flex gap-1"><button onClick={() => void op("approval_review", { requestId: approval.id, decision: "approved", note: "Approved from Setup & Infrastructure" })} className="ui-btn ui-btn-tertiary text-success">Approve</button><button onClick={() => void op("approval_review", { requestId: approval.id, decision: "rejected", note: "Rejected from Setup & Infrastructure" })} className="ui-btn ui-btn-tertiary text-danger">Reject</button></div> : null}</div>)}</div>
              </section>
            ) : null}

            {tab === "local" ? (
              <section className="ui-section border-0">
                <div className="mb-5"><Database className="text-icon-secondary" size={20} /><h2 className="ui-section-title mt-3">Local Workspace</h2><p className="ui-section-description max-w-2xl">PostgreSQL semantics, Supabase-compatible Auth/REST boundary, CMS and durable worker. Runtime control remains disabled on hosted installations.</p></div>
                <div className="rounded-2xl bg-surface-1 p-5">
                  <Field label="Workspace directory" hint="Optional. Must remain inside the allowed local workspace boundary."><input value={localDir} onChange={(event) => setLocalDir(event.target.value)} placeholder="Local workspace folder" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
                  <div className="mt-4 flex flex-wrap gap-2">{["local_init", "local_start", "local_status", "local_backup", "local_upgrade", "local_stop"].map((action) => <button key={action} disabled={!localEnabled || Boolean(busy)} onClick={() => void op(action, { directory: localDir || null })} className="ui-btn ui-btn-secondary disabled:opacity-40">{humanize(action.replace("local_", ""))}</button>)}</div>
                  <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]"><input value={localBackupFile} onChange={(event) => setLocalBackupFile(event.target.value)} placeholder="Local backup .sql file" className="rounded-lg px-3 py-2.5 text-sm" /><button disabled={!localEnabled || !localBackupFile || Boolean(busy)} onClick={() => void op("local_restore", { directory: localDir || null, backupFile: localBackupFile })} className="ui-btn ui-btn-secondary text-warning disabled:opacity-40">Restore local backup</button></div>
                  {!localEnabled ? <div className="ui-alert ui-alert-warning mt-5">Local process control is disabled here. On a local installation, set <code>POLYNOVEA_LOCAL_RUNTIME_CONTROL=1</code>; hosted deployments cannot spawn Docker on a user's computer.</div> : null}
                </div>
                {lastResult ? <pre className="mt-5 max-h-80 overflow-auto rounded-xl bg-field p-4 text-[11px] text-fg-muted">{JSON.stringify(lastResult, null, 2)}</pre> : null}
              </section>
            ) : null}
          </main>
        </div>
      </div>
    </AdminLayout>
  );
}
