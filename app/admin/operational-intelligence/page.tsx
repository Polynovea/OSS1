"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  GitBranch,
  Play,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import AdminLayout from "@/components/admin/AdminLayout";
import OperationalPredictionsPanel from "@/components/admin/OperationalPredictionsPanel";
import { getAuthHeaders } from "@/lib/admin/authCheck";

type Environment = { id: string; key: string; name: string; kind: string; status: string };
type WorldNode = { id: string; node_key: string; node_type: string; display_name: string; state: string; provider: string | null; capability_key: string | null; attributes_json: Record<string, unknown>; last_observed_at: string; valid_until: string | null; is_stale: boolean };
type WorldEdge = { id: string; from_node_id: string; to_node_id: string; relationship: string; is_stale: boolean };
type DesiredState = { id: string; revision: number; status: string; source: string; checksum_sha256: string; change_note: string | null; created_at: string; activated_at: string | null; desired_json: Record<string, unknown> };
type Drift = { id: string; drift_key: string; category: string; severity: string; action_class: string; state: string; current_json: Record<string, unknown>; desired_json: Record<string, unknown>; evidence_json: Record<string, unknown>; last_seen_at: string };
type Plan = { id: string; name: string; status: string; deterministic_classification: string; requires_approval: boolean; plan_checksum_sha256: string; created_at: string; expires_at: string | null; immutable_plan_json: { nodes?: unknown[] } };
type Simulation = { id: string; plan_id: string; status: string; hard_blockers_json: unknown[]; warnings_json: unknown[]; rollback_coverage_json: Record<string, unknown>; created_by: string | null; started_at: string; completed_at: string | null };
type Execution = { id: string; plan_id: string; status: string; correlation_id: string; result_json: Record<string, unknown>; started_at: string; completed_at: string | null };
type EvidencePackage = { id: string; execution_run_id: string; plan_id: string; checksum_sha256: string; created_at: string; package_json: Record<string, unknown> };
type Policy = { id: string; mode: string; allowed_remediation_keys: string[]; max_deterministic_classification: string; require_approval_for_production: boolean; updated_at: string };
type ChangeAssessment = { id: string; content_model_id: string; status: string; deterministic_classification: string; current_schema_version: number; proposed_schema_hash: string; hard_blockers_json: unknown[]; warnings_json: unknown[]; alternatives_json: Array<{ key?: string; title?: string; classification?: string }>; estimate_json: Record<string, unknown>; created_at: string };
type RemediationDefinition = { remediation_key: string; title: string; failure_class: string; deterministic_classification: string; enabled: boolean };
type RemediationRun = { id: string; remediation_key: string; target_type: string; target_id: string | null; status: string; execution_mode: string; deterministic_classification: string; started_at: string; completed_at: string | null };
type MigrationRun = { id: string; assessment_id: string; content_model_id: string; strategy_key: string; status: string; deterministic_classification: string; progress_json: Record<string, unknown>; postcondition_json: Record<string, unknown>; created_at: string; completed_at: string | null };
type PlanComparison = { id: string; plan_id: string; comparison_json: { scenarios?: Array<{ key: string; title: string; kind: string; deterministicClassification: string; executable: boolean; ranking?: Record<string, unknown>; predictions?: MlPrediction[] }>; rankedActionableScenarioKeys?: string[]; rankingMethod?: string }; selected_scenario_key: string | null; created_at: string };
type MlModel = { id: string; model_key: string; model_family: string; title: string; enabled: boolean; minimum_support: number };
type MlVersion = { id: string; model_id: string; version: number; status: string; technique: string; training_sample_count: number; validation_sample_count: number; holdout_sample_count: number; calibration_json: Record<string, unknown>; integrity_sha256: string; created_at: string };
type MlPrediction = { id: string; model_id: string; model_version_id: string | null; feature_snapshot_id: string | null; prediction_key: string; subject_type: string; subject_id: string | null; status: string; predicted_label: string | null; probability: number | null; estimate: number | null; interval_lower: number | null; interval_upper: number | null; confidence: number | null; support_count: number; calibration_state: string; distribution_state: string; prediction_json: Record<string, unknown>; explanation_json: Record<string, unknown>; created_at: string };
type MlEvaluation = { id: string; model_version_id: string; evaluation_kind: string; sample_count: number; metrics_json: Record<string, unknown>; status: string; evaluated_at: string };
type MlOverview = { available?: boolean; status?: string; reason?: string; policy: { local_learning_enabled: boolean; cross_install_learning_opt_in: boolean; content_level_features_enabled: boolean; retention_days: number } | null; models: MlModel[]; modelVersions: MlVersion[]; predictions: MlPrediction[]; featureSnapshots: Array<{ id: string; feature_family: string; sample_support: number; checksum_sha256: string; captured_at: string; expires_at: string | null; provenance_json: Record<string, unknown> }>; evaluations: MlEvaluation[] };
type Run = { id: string; status: string; started_at: string; completed_at: string | null; summary_json: Record<string, unknown> };
type Overview = {
  world: { nodes: WorldNode[]; edges: WorldEdge[]; latestDiscovery: Run | null };
  desiredStates: DesiredState[];
  activeDesiredState: DesiredState | null;
  drift: Drift[];
  policy: Policy | null;
  reconciliationRuns: Run[];
  discoveryRuns: Run[];
  plans: Plan[];
  simulations: Simulation[];
  executions: Execution[];
  evidencePackages: EvidencePackage[];
  changeAssessments: ChangeAssessment[];
  remediationRegistry: RemediationDefinition[];
  remediationRuns: RemediationRun[];
  operationalEvents: Array<{ id: string; event_type: string; occurred_at: string }>;
  migrationRuns: MigrationRun[];
  planComparisons: PlanComparison[];
  mlFeedback: unknown[];
  ml: MlOverview;
};

type Tab = "state" | "drift" | "plans" | "predictions" | "evidence" | "policy";

async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const auth = await getAuthHeaders();
  if (!auth.Authorization) throw new Error("Admin session unavailable. Please sign in again.");
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(auth)) headers.set(key, value);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(input, { ...init, headers, cache: "no-store" });
}

const humanize = (value: string) => value.replaceAll("_", " ");
const short = (value?: string | null) => value ? value.slice(0, 8) : "—";
const fmt = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";

function Status({ value }: { value: string }) {
  const good = ["healthy", "present", "supported", "active", "converged", "passed", "succeeded", "verified", "resolved"].includes(value);
  const bad = ["blocked", "failed", "destructive", "missing"].includes(value);
  const review = ["approval_required", "potentially_destructive", "requires_data_migration", "requires_lock", "warning", "partial", "drifted"].includes(value);
  const cls = good ? "ui-badge ui-badge-success" : bad ? "ui-badge ui-badge-danger" : review ? "ui-badge ui-badge-review" : "ui-badge ui-badge-warning";
  return <span className={cls}>{humanize(value)}</span>;
}

function Count({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return <div className="min-w-0 border-l border-subtle pl-4 first:border-l-0 first:pl-0"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">{label}</p><p className="mt-1 text-2xl font-semibold text-fg-primary">{value}</p>{note ? <p className="mt-1 text-[10px] text-fg-muted">{note}</p> : null}</div>;
}

export default function OperationalIntelligencePage() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<Tab>("state");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [policyMode, setPolicyMode] = useState("diagnose_only");
  const [allowedRemediations, setAllowedRemediations] = useState<string[]>([]);
  const [localLearning, setLocalLearning] = useState(true);
  const [crossInstallLearning, setCrossInstallLearning] = useState(false);
  const [contentLevelFeatures, setContentLevelFeatures] = useState(false);
  const [retentionDays, setRetentionDays] = useState(365);

  const load = useCallback(async (targetEnvironmentId?: string) => {
    setError("");
    try {
      const selected = targetEnvironmentId ?? environmentId;
      const query = selected ? `?environmentId=${encodeURIComponent(selected)}` : "";
      const response = await authFetch(`/api/operational-intelligence${query}`);
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Could not load operational intelligence");
      setEnvironments(body.data.environments ?? []);
      const resolved = body.data.environmentId ?? "";
      setEnvironmentId(resolved);
      setOverview(body.data.overview ?? null);
      if (body.data.overview?.policy?.mode) setPolicyMode(body.data.overview.policy.mode);
      setAllowedRemediations(body.data.overview?.policy?.allowed_remediation_keys ?? []);
      const mlPolicy = body.data.overview?.ml?.policy;
      if (mlPolicy) { setLocalLearning(Boolean(mlPolicy.local_learning_enabled)); setCrossInstallLearning(Boolean(mlPolicy.cross_install_learning_opt_in)); setContentLevelFeatures(Boolean(mlPolicy.content_level_features_enabled)); setRetentionDays(Number(mlPolicy.retention_days ?? 365)); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load operational intelligence");
    }
  }, [environmentId]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function operation(name: string, payload: Record<string, unknown> = {}) {
    if (!environmentId) throw new Error("Select an environment first");
    setBusy(name); setError(""); setNotice("");
    try {
      const response = await authFetch("/api/operational-intelligence", { method: "POST", body: JSON.stringify({ operation: name, environmentId, ...payload }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || `${humanize(name)} failed`);
      setLastResult(body.data);
      setNotice(`${humanize(name)} completed.`);
      await load(environmentId);
      return body.data;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : `${humanize(name)} failed`;
      setError(message);
      throw cause;
    } finally { setBusy(""); }
  }

  const activeDesired = overview?.activeDesiredState ?? null;
  const openDrift = useMemo(() => (overview?.drift ?? []).filter((item) => !["resolved", "ignored"].includes(item.state)), [overview]);
  const latestPlan = overview?.plans?.[0] ?? null;
  const nodeName = useMemo(() => new Map((overview?.world.nodes ?? []).map((node) => [node.id, node.display_name])), [overview]);
  const staleNodes = (overview?.world.nodes ?? []).filter((node) => node.is_stale).length;
  const blockingDrift = openDrift.filter((item) => item.severity === "blocking").length;
  const approvalDrift = openDrift.filter((item) => item.action_class === "approval_required").length;

  return <AdminLayout><div className="ui-page mx-auto max-w-[1500px]">
    <header className="ui-page-header">
      <div>
        <p className="ui-eyebrow">Phase 12.75 · Deterministic controller</p>
        <h1 className="ui-page-title">Operational Intelligence</h1>
        <p className="ui-page-description">Observed truth, desired state, deterministic drift, immutable change plans, simulation, governed execution and proof. Forecasts remain separate from facts and can never weaken deterministic safety.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void load(environmentId)} disabled={Boolean(busy)} className="ui-btn ui-btn-secondary"><RefreshCw size={14} className={busy ? "animate-spin" : ""}/>Refresh</button>
        <button onClick={() => void operation("discover")} disabled={!environmentId || Boolean(busy)} className="ui-btn ui-btn-primary"><ScanSearch size={14}/>Discover state</button>
      </div>
    </header>

    {error ? <div className="ui-alert ui-alert-danger mt-5">{error}</div> : null}
    {notice ? <div className="ui-alert ui-alert-success mt-5">{notice}</div> : null}

    <div className="mt-6 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted">Environment</label>
        <select value={environmentId} onChange={(event) => { setEnvironmentId(event.target.value); void load(event.target.value); }} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm">
          {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name} · {environment.kind}</option>)}
        </select>

        <div className="mt-5 divide-y divide-[var(--border-subtle)] text-[12px]">
          <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-fg-muted">Discovery</span>{overview?.world.latestDiscovery ? <Status value={overview.world.latestDiscovery.status}/> : <span className="text-fg-muted">—</span>}</div>
          <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-fg-muted">Desired rev</span><span className="font-mono text-fg-secondary">{activeDesired ? `v${activeDesired.revision}` : "—"}</span></div>
          <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-fg-muted">Open drift</span><span className={openDrift.length ? "text-warning" : "text-success"}>{openDrift.length}</span></div>
          <div className="flex items-center justify-between gap-3 py-2.5"><span className="text-fg-muted">Autonomy</span><span className="text-right text-fg-secondary">{humanize(overview?.policy?.mode ?? "diagnose_only")}</span></div>
        </div>

        <div className="mt-5 ui-alert ui-alert-info text-[11px] leading-5"><strong>ML status:</strong> {overview?.ml?.available === false ? `unavailable — ${overview.ml.reason ?? "deterministic-only mode"}` : localLearning ? "enabled when sufficient calibrated evidence exists" : "disabled by workspace policy"}. Deterministic truth and execution remain authoritative.</div>
        <Link href="/admin/infrastructure" className="mt-4 block text-[11px] text-link no-underline">Open Setup & Infrastructure →</Link>
      </aside>

      <main className="min-w-0">
        <div className="grid grid-cols-2 gap-4 border-y border-subtle py-4 md:grid-cols-5">
          <Count label="World nodes" value={overview?.world.nodes.length ?? 0}/>
          <Count label="Relations" value={overview?.world.edges.length ?? 0}/>
          <Count label="Open drift" value={openDrift.length} note={`${blockingDrift} blocking`}/>
          <Count label="Approval gated" value={approvalDrift}/>
          <Count label="Proof packages" value={overview?.evidencePackages.length ?? 0}/>
        </div>

        <nav className="mt-6 flex flex-wrap gap-1 border-b border-subtle pb-3">
          {([['state','World Model'],['drift','Desired State & Drift'],['plans','Plans & Simulation'],['predictions','Predictions'],['evidence','Evidence'],['policy','Policy']] as const).map(([key,label]) => <button key={key} onClick={() => setTab(key)} className={`rounded-lg px-3 py-2 text-[12px] font-medium ${tab===key?"bg-surface-2 text-fg-primary":"text-fg-muted hover:bg-surface-2 hover:text-fg-secondary"}`}>{label}</button>)}
        </nav>

        {tab === "state" ? <section className="ui-section border-0">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Activity size={16} className="text-icon-secondary"/><h2 className="ui-section-title">Canonical operational world model</h2></div><p className="ui-section-description">Every row is evidence-backed observed/declared state. Stale observations lose authority instead of living forever.</p></div><button onClick={() => void operation("discover")} disabled={Boolean(busy)} className="ui-btn ui-btn-secondary">Refresh discovery</button></div>
          {staleNodes ? <div className="ui-alert ui-alert-warning mt-4">{staleNodes} node(s) are stale and should be rediscovered before planning.</div> : null}
          <div className="mt-5 overflow-x-auto border-y border-subtle"><table className="ui-table w-full text-left text-xs"><thead><tr><th>Node</th><th>Type</th><th>State</th><th>Provider</th><th>Observed</th></tr></thead><tbody>{(overview?.world.nodes ?? []).map((node) => <tr key={node.id}><td><p className="font-medium text-fg-primary">{node.display_name}</p><p className="mt-1 font-mono text-[9px] text-fg-muted">{node.node_key}</p></td><td className="text-fg-secondary">{humanize(node.node_type)}</td><td><Status value={node.is_stale ? "stale" : node.state}/></td><td className="text-fg-muted">{node.provider ?? "—"}</td><td className="text-fg-muted">{fmt(node.last_observed_at)}</td></tr>)}{!overview?.world.nodes.length?<tr><td colSpan={5} className="py-10 text-center text-fg-muted">No world model yet. Run discovery.</td></tr>:null}</tbody></table></div>
          <div className="mt-7"><div className="flex items-center gap-2"><GitBranch size={15} className="text-icon-secondary"/><h3 className="text-[14px] font-semibold text-fg-primary">Topology relations</h3></div><div className="mt-3 divide-y divide-[var(--border-subtle)]">{(overview?.world.edges ?? []).slice(0,100).map((edge) => <div key={edge.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5 text-[11px]"><span className="truncate text-fg-secondary">{nodeName.get(edge.from_node_id) ?? short(edge.from_node_id)}</span><span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{humanize(edge.relationship)}</span><span className="truncate text-right text-fg-secondary">{nodeName.get(edge.to_node_id) ?? short(edge.to_node_id)}</span></div>)}{!overview?.world.edges.length?<p className="py-5 text-xs text-fg-muted">No relations discovered yet.</p>:null}</div></div>
        </section> : null}

        {tab === "drift" ? <section className="ui-section border-0">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="ui-section-title">Desired state & deterministic drift</h2><p className="ui-section-description">Desired state is versioned separately from observed reality. Reconciliation classifies each gap before any repair is considered.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => void operation("desired_generate", { activate: true })} disabled={Boolean(busy)} className="ui-btn ui-btn-secondary">Generate baseline</button><button onClick={() => void operation("reconcile")} disabled={!activeDesired || Boolean(busy)} className="ui-btn ui-btn-primary">Reconcile now</button></div></div>
          {activeDesired ? <div className="mt-5 grid gap-4 border-y border-subtle py-4 md:grid-cols-[110px_1fr_auto]"><div><p className="text-[10px] uppercase tracking-wider text-fg-muted">Active</p><p className="mt-1 text-lg font-semibold">v{activeDesired.revision}</p></div><div className="min-w-0"><p className="text-[10px] uppercase tracking-wider text-fg-muted">Checksum</p><p className="mt-1 truncate font-mono text-[11px] text-fg-secondary">{activeDesired.checksum_sha256}</p></div><div><Status value={activeDesired.status}/></div></div> : <div className="ui-empty mt-5 border-y border-subtle"><p className="ui-empty-title">No active desired state</p><p className="ui-empty-copy">Generate a canonical baseline or create a reviewed desired-state revision before reconciliation.</p></div>}
          <div className="mt-6 divide-y divide-[var(--border-subtle)]">{openDrift.map((item) => <div key={item.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(220px,1fr)_140px_170px]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Status value={item.severity}/><p className="font-mono text-[11px] text-fg-primary">{item.drift_key}</p></div><p className="mt-2 text-[11px] text-fg-muted">Current: {JSON.stringify(item.current_json)} → Desired: {JSON.stringify(item.desired_json)}</p></div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Category</p><p className="mt-1 text-xs text-fg-secondary">{humanize(item.category)}</p></div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Action class</p><div className="mt-1"><Status value={item.action_class}/></div></div></div>)}{!openDrift.length?<div className="ui-alert ui-alert-success"><CheckCircle2 size={14}/>No unresolved deterministic drift is recorded.</div>:null}</div>
        </section> : null}

        {tab === "plans" ? <section className="ui-section border-0">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="ui-section-title">Immutable change plans</h2><p className="ui-section-description">Plans are checksum-pinned DAGs. Simulation checks freshness, approvals and automation coverage before execution.</p></div><button onClick={() => void operation("plan")} disabled={!activeDesired || Boolean(busy)} className="ui-btn ui-btn-primary"><GitBranch size={14}/>Construct plan</button></div>
          <div className="mt-5 divide-y divide-[var(--border-subtle)]">{(overview?.plans ?? []).map((plan) => {const simulation=overview?.simulations.find((item)=>item.plan_id===plan.id);const execution=overview?.executions.find((item)=>item.plan_id===plan.id);return <div key={plan.id} className="py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-fg-primary">{plan.name}</p><p className="mt-1 font-mono text-[9px] text-fg-muted">{plan.plan_checksum_sha256}</p><div className="mt-2 flex flex-wrap gap-2"><Status value={plan.deterministic_classification}/><Status value={plan.status}/>{plan.requires_approval?<Status value="approval_required"/>:null}</div><p className="mt-2 text-[10px] text-fg-muted">Created {fmt(plan.created_at)} · expires {fmt(plan.expires_at)} · {(plan.immutable_plan_json?.nodes ?? []).length} graph node(s)</p>{simulation?<p className="mt-2 text-[11px] text-fg-secondary">Latest simulation: <span className="font-medium">{humanize(simulation.status)}</span> · {simulation.hard_blockers_json?.length ?? 0} blocker(s) · {simulation.warnings_json?.length ?? 0} warning(s)</p>:null}{execution?<p className="mt-1 text-[11px] text-fg-secondary">Execution: {humanize(execution.status)} · correlation {short(execution.correlation_id)}</p>:null}</div><div className="flex shrink-0 flex-wrap gap-2"><button onClick={() => void operation("simulate", { planId: plan.id })} disabled={Boolean(busy)} className="ui-btn ui-btn-secondary">Simulate</button><button onClick={() => void operation("plan_compare", { planId: plan.id })} disabled={Boolean(busy)} className="ui-btn ui-btn-secondary">Compare</button><button onClick={() => void operation("ml_predict_plan", { planId: plan.id })} disabled={Boolean(busy)} className="ui-btn ui-btn-secondary">Predict</button>{plan.requires_approval?<button onClick={() => void operation("approval_request", { planId: plan.id, planChecksum: plan.plan_checksum_sha256, reason: "Execute reviewed deterministic operational plan" })} disabled={Boolean(busy)} className="ui-btn ui-btn-secondary"><ShieldCheck size={13}/>Request approval</button>:null}<button onClick={() => void operation("execute", { planId: plan.id })} disabled={Boolean(busy)} className="ui-btn ui-btn-primary"><Play size={13}/>Execute</button></div></div></div>})}{!overview?.plans.length?<div className="ui-empty border-y border-subtle"><p className="ui-empty-title">No change plans yet</p><p className="ui-empty-copy">Reconcile the environment first, then construct an immutable plan from unresolved drift.</p></div>:null}</div>
          <div className="mt-8 border-t border-subtle pt-5"><div className="flex items-start justify-between gap-4"><div><h3 className="text-[14px] font-semibold text-fg-primary">Data-aware schema assessments</h3><p className="mt-1 text-[11px] text-fg-muted">Aggregate target-data evidence used by the deterministic planner. No raw content values are retained.</p></div><span className="text-[10px] text-fg-muted">{overview?.changeAssessments?.length ?? 0} recorded</span></div><div className="mt-3 divide-y divide-[var(--border-subtle)]">{(overview?.changeAssessments ?? []).slice(0,20).map((assessment) => <div key={assessment.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(220px,1fr)_140px_160px]"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Status value={assessment.status}/><Status value={assessment.deterministic_classification}/></div><p className="mt-2 font-mono text-[10px] text-fg-secondary">model {short(assessment.content_model_id)} · canonical v{assessment.current_schema_version}</p><p className="mt-1 text-[10px] text-fg-muted">{assessment.hard_blockers_json?.length ?? 0} blocker(s) · {assessment.warnings_json?.length ?? 0} warning(s) · {String(assessment.estimate_json?.tableSizeHuman ?? 'size unknown')}</p>{assessment.alternatives_json?.length ? <p className="mt-2 text-[10px] text-fg-muted">Strategies: {assessment.alternatives_json.slice(0,3).map((item)=>item.title ?? item.key ?? 'review').join(' · ')}</p> : null}</div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Assessment</p><p className="mt-1 font-mono text-[10px] text-fg-secondary">{short(assessment.id)}</p></div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Observed</p><p className="mt-1 text-[10px] text-fg-secondary">{fmt(assessment.created_at)}</p></div></div>)}{!(overview?.changeAssessments ?? []).length ? <p className="py-5 text-xs text-fg-muted">No schema assessments yet. Schema drift planning creates one automatically against the target database.</p> : null}</div></div>
          <div className="mt-8 border-t border-subtle pt-5"><div className="flex items-start justify-between gap-4"><div><h3 className="text-[14px] font-semibold text-fg-primary">Resumable migration runs</h3><p className="mt-1 text-[11px] text-fg-muted">Batch progress is durable and input-hash pinned. Raw customer values are not persisted in migration-run metadata.</p></div><span className="text-[10px] text-fg-muted">{overview?.migrationRuns?.length ?? 0} run(s)</span></div><div className="mt-3 divide-y divide-[var(--border-subtle)]">{(overview?.migrationRuns ?? []).slice(0,20).map((run)=><div key={run.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(220px,1fr)_150px_160px]"><div><div className="flex flex-wrap items-center gap-2"><Status value={run.status}/><Status value={run.deterministic_classification}/></div><p className="mt-2 text-[12px] font-medium text-fg-primary">{humanize(run.strategy_key)}</p><p className="mt-1 font-mono text-[9px] text-fg-muted">run {short(run.id)} · assessment {short(run.assessment_id)}</p></div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Progress</p><p className="mt-1 text-[10px] text-fg-secondary">{Number(run.progress_json?.processed ?? 0)} processed · {Number(run.progress_json?.failed ?? 0)} failed</p></div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Completed</p><p className="mt-1 text-[10px] text-fg-secondary">{fmt(run.completed_at)}</p></div></div>)}{!(overview?.migrationRuns ?? []).length?<p className="py-5 text-xs text-fg-muted">No migration strategy has executed yet.</p>:null}</div></div>
          {latestPlan?.requires_approval ? <div className="ui-alert ui-alert-warning mt-5"><CircleAlert size={14}/>Approval requests use the existing two-person infrastructure approval boundary. A requester cannot self-approve. <Link href="/admin/infrastructure" className="ml-1 text-link">Open approvals →</Link></div> : null}
        </section> : null}

        {tab === "predictions" ? <OperationalPredictionsPanel overview={overview} busy={busy} operation={operation} localLearning={localLearning} setLocalLearning={setLocalLearning} crossInstallLearning={crossInstallLearning} setCrossInstallLearning={setCrossInstallLearning} contentLevelFeatures={contentLevelFeatures} setContentLevelFeatures={setContentLevelFeatures} retentionDays={retentionDays} setRetentionDays={setRetentionDays}/> : null}

        {tab === "evidence" ? <section className="ui-section border-0">
          <div><h2 className="ui-section-title">Proof-carrying execution</h2><p className="ui-section-description">Command success is not completion. Every executed plan is independently rediscovered and reconciled before success is recorded.</p></div>
          <div className="mt-5 divide-y divide-[var(--border-subtle)]">{(overview?.evidencePackages ?? []).map((item) => <div key={item.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_180px_auto]"><div className="min-w-0"><p className="text-[12px] font-medium text-fg-primary">Proof package {short(item.id)}</p><p className="mt-1 truncate font-mono text-[9px] text-fg-muted">sha256:{item.checksum_sha256}</p><p className="mt-1 text-[10px] text-fg-muted">Execution {short(item.execution_run_id)} · Plan {short(item.plan_id)}</p></div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Created</p><p className="mt-1 text-[11px] text-fg-secondary">{fmt(item.created_at)}</p></div><div><Status value={Boolean((item.package_json as any)?.verification?.converged)?"verified":"partial"}/></div></div>)}{!overview?.evidencePackages.length?<div className="ui-empty border-y border-subtle"><p className="ui-empty-title">No execution proof yet</p><p className="ui-empty-copy">A proof package appears only after a governed execution path has been attempted and postconditions verified.</p></div>:null}</div>
          {lastResult && tab === "evidence" ? <pre className="mt-5 max-h-80 overflow-auto rounded-lg bg-field p-4 text-[10px] text-fg-muted">{JSON.stringify(lastResult, null, 2)}</pre> : null}
        </section> : null}

        {tab === "policy" ? <section className="ui-section border-0">
          <div><h2 className="ui-section-title">Policy-bounded autonomy</h2><p className="ui-section-description">Autonomy cannot invent permissions. Automatic repair is allowed only when deterministic classification and explicit environment policy both permit it.</p></div>
          <div className="mt-5 grid gap-6 border-y border-subtle py-5 lg:grid-cols-[minmax(260px,360px)_1fr]"><div><label><span className="block text-[11px] font-medium text-fg-secondary">Autonomy mode</span><select value={policyMode} onChange={(event)=>setPolicyMode(event.target.value)} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm"><option value="diagnose_only">Diagnose only</option><option value="recommend">Recommend</option><option value="approval_execute">Approval + execute</option><option value="policy_auto_repair">Policy auto-repair</option></select></label><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => void operation("policy_update", { mode: policyMode, allowedRemediationKeys: allowedRemediations, maxDeterministicClassification: "safe" })} disabled={Boolean(busy)} className="ui-btn ui-btn-primary">Save policy</button><button onClick={() => void operation("auto_repair")} disabled={Boolean(busy) || policyMode !== "policy_auto_repair" || allowedRemediations.length === 0} className="ui-btn ui-btn-secondary">Run allowed safe repairs</button></div><p className="mt-3 text-[10px] leading-4 text-fg-muted">Production auto-repair remains restricted to deterministically SAFE operations. Selecting a remediation here grants no extra permission or approval authority.</p></div><div><p className="text-[11px] font-medium text-fg-secondary">Allow-listed deterministic remediations</p><div className="mt-3 divide-y divide-[var(--border-subtle)]">{(overview?.remediationRegistry ?? []).map((item) => {const checked=allowedRemediations.includes(item.remediation_key);return <label key={item.remediation_key} className="flex cursor-pointer items-start gap-3 py-3"><input type="checkbox" checked={checked} onChange={(event)=>setAllowedRemediations((current)=>event.target.checked?[...new Set([...current,item.remediation_key])]:current.filter((key)=>key!==item.remediation_key))} className="mt-0.5"/><span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-fg-primary">{item.title}</span><span className="mt-0.5 block font-mono text-[9px] text-fg-muted">{item.remediation_key} · {humanize(item.failure_class)}</span></span><Status value={item.deterministic_classification}/></label>})}{!(overview?.remediationRegistry ?? []).length?<p className="py-4 text-xs text-fg-muted">No deterministic remediations are registered.</p>:null}</div></div></div><div className="mt-6"><div className="flex items-center justify-between gap-4"><div><h3 className="text-[14px] font-semibold text-fg-primary">Recent remediation runs</h3><p className="mt-1 text-[11px] text-fg-muted">Every repair records execution mode, deterministic classification and post-repair verification.</p></div><span className="text-[10px] text-fg-muted">{overview?.operationalEvents?.length ?? 0} learning-safe event(s)</span></div><div className="mt-3 divide-y divide-[var(--border-subtle)]">{(overview?.remediationRuns ?? []).slice(0,20).map((run)=><div key={run.id} className="grid gap-2 py-3 md:grid-cols-[1fr_140px_110px]"><div><p className="text-[12px] font-medium text-fg-primary">{humanize(run.remediation_key)}</p><p className="mt-1 text-[9px] font-mono text-fg-muted">{run.target_type}:{short(run.target_id)} · {humanize(run.execution_mode)}</p></div><div><Status value={run.deterministic_classification}/></div><div className="md:text-right"><Status value={run.status}/></div></div>)}{!(overview?.remediationRuns ?? []).length?<p className="py-4 text-xs text-fg-muted">No remediation has executed yet.</p>:null}</div></div>
          <div className="ui-alert ui-alert-info mt-5"><ShieldCheck size={14}/>ML will later rank or forecast deterministically valid choices. It will not receive an alternate execution path around this policy controller.</div>
        </section> : null}
      </main>
    </div>
  </div></AdminLayout>;
}
