"use client";

import { CircleAlert, ShieldCheck } from "lucide-react";

type Operation = (name: string, payload?: Record<string, unknown>) => Promise<unknown>;

type Props = {
  overview: any;
  busy: string;
  operation: Operation;
  localLearning: boolean;
  setLocalLearning: (value: boolean) => void;
  crossInstallLearning: boolean;
  setCrossInstallLearning: (value: boolean) => void;
  contentLevelFeatures: boolean;
  setContentLevelFeatures: (value: boolean) => void;
  retentionDays: number;
  setRetentionDays: (value: number) => void;
};

const humanize = (value: string) => value.replaceAll("_", " ");
const short = (value?: string | null) => value ? value.slice(0, 8) : "—";
const fmt = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const pct = (value?: number | null) => value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toFixed(1)}%`;

function Status({ value }: { value: string }) {
  const good = ["healthy", "present", "supported", "active", "converged", "passed", "succeeded", "verified", "resolved", "calibrated", "in_distribution", "deployed", "recorded"].includes(value);
  const bad = ["blocked", "failed", "destructive", "missing", "out_of_distribution"].includes(value);
  const review = ["approval_required", "potentially_destructive", "requires_data_migration", "requires_lock", "warning", "partial", "drifted", "provisional", "low_support", "insufficient_data"].includes(value);
  const cls = good ? "ui-badge ui-badge-success" : bad ? "ui-badge ui-badge-danger" : review ? "ui-badge ui-badge-review" : "ui-badge ui-badge-warning";
  return <span className={cls}>{humanize(value)}</span>;
}

export default function OperationalPredictionsPanel(props: Props) {
  const ml = props.overview?.ml;
  const models = ml?.models ?? [];
  const versions = ml?.modelVersions ?? [];
  const predictions = ml?.predictions ?? [];
  const evaluations = ml?.evaluations ?? [];
  const comparisons = props.overview?.planComparisons ?? [];
  const disabled = Boolean(props.busy);

  return <section className="ui-section border-0">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="ui-section-title">Machine predictions & counterfactual planning</h2>
        <p className="ui-section-description">Forecasts are advisory and visibly separate from observed truth. Insufficient-data, stale, low-support or out-of-distribution states never fabricate confidence or weaken deterministic policy.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void props.operation("ml_train")} disabled={disabled || !props.localLearning} className="ui-btn ui-btn-secondary">Train supported models</button>
        <button onClick={() => void props.operation("ml_evaluate_online")} disabled={disabled} className="ui-btn ui-btn-secondary">Evaluate outcomes</button>
        <button onClick={() => void props.operation("ml_retention_enforce")} disabled={disabled} className="ui-btn ui-btn-secondary">Enforce retention</button>
      </div>
    </div>

    {ml?.available === false ? <div className="ui-alert ui-alert-warning mt-5"><CircleAlert size={14}/>Operational ML is unavailable: {ml.reason ?? "unknown reason"}. World model, planning, simulation, approvals, execution and verification remain fully operational.</div> : null}

    <div className="mt-5 grid gap-5 border-y border-subtle py-5 lg:grid-cols-[minmax(280px,420px)_1fr]">
      <div>
        <p className="text-[11px] font-semibold text-fg-primary">Learning governance</p>
        <div className="mt-3 space-y-3 text-[11px] text-fg-secondary">
          <label className="flex items-center gap-2"><input type="checkbox" checked={props.localLearning} onChange={(event)=>props.setLocalLearning(event.target.checked)}/>Workspace-local learning</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={props.crossInstallLearning} onChange={(event)=>props.setCrossInstallLearning(event.target.checked)}/>Opt in to minimized cross-install learning</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={props.contentLevelFeatures} onChange={(event)=>props.setContentLevelFeatures(event.target.checked)}/>Content-level features (explicit opt-in)</label>
          <label className="block"><span className="block text-fg-muted">Retention days</span><input type="number" min={7} max={3650} value={props.retentionDays} onChange={(event)=>props.setRetentionDays(Number(event.target.value))} className="mt-1 w-32 rounded-lg px-3 py-2"/></label>
        </div>
        <button onClick={() => void props.operation("ml_policy_update", { localLearningEnabled: props.localLearning, crossInstallLearningOptIn: props.crossInstallLearning, contentLevelFeaturesEnabled: props.contentLevelFeatures, retentionDays: props.retentionDays })} disabled={disabled} className="ui-btn ui-btn-primary mt-4">Save learning policy</button>
      </div>
      <div className="text-[11px] leading-5 text-fg-secondary">
        <p><strong className="text-fg-primary">Safety authority:</strong> deterministic controller only.</p>
        <p className="mt-2">Cross-install learning is off by default. Model artifacts are integrity checked before inference. Every consequential prediction retains its model/version, feature snapshot, support, calibration and distribution state.</p>
        <p className="mt-2 text-fg-muted">No credential values or raw customer content are part of the default operational feature contract.</p>
        <div className="ui-alert ui-alert-info mt-4"><ShieldCheck size={14}/>ML may rank equally valid deterministic choices. It cannot downgrade a destructive classification, remove an approval, grant permission or establish execution success.</div>
      </div>
    </div>

    <div className="mt-7">
      <div className="flex items-center justify-between gap-4"><div><h3 className="text-[14px] font-semibold text-fg-primary">Specialist model registry</h3><p className="mt-1 text-[11px] text-fg-muted">A model family may correctly remain insufficient-data until its required evidence exists.</p></div><span className="text-[10px] text-fg-muted">{models.length} families</span></div>
      <div className="mt-3 divide-y divide-[var(--border-subtle)]">{models.map((model: any) => { const version = versions.find((item: any)=>item.model_id===model.id&&item.status==="deployed") ?? versions.find((item: any)=>item.model_id===model.id); return <div key={model.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(220px,1fr)_200px_150px]"><div><p className="text-[12px] font-medium text-fg-primary">{model.title}</p><p className="mt-1 font-mono text-[9px] text-fg-muted">{model.model_family} · min support {model.minimum_support}</p></div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Model version</p><p className="mt-1 text-[10px] text-fg-secondary">{version ? `v${version.version} · ${humanize(version.technique)}` : "No trained version"}</p>{version?<p className="mt-1 text-[9px] text-fg-muted">train {version.training_sample_count} · validation {version.validation_sample_count} · holdout {version.holdout_sample_count}</p>:null}</div><div>{version?<Status value={version.status}/>:<Status value="insufficient_data"/>}</div></div>; })}</div>
    </div>

    <div className="mt-7 border-t border-subtle pt-5">
      <div className="flex items-center justify-between gap-4"><div><h3 className="text-[14px] font-semibold text-fg-primary">Recent predictions</h3><p className="mt-1 text-[11px] text-fg-muted">Qualified probabilities/intervals only; unsupported cases remain explicit.</p></div><span className="text-[10px] text-fg-muted">{predictions.length} recorded</span></div>
      <div className="mt-3 divide-y divide-[var(--border-subtle)]">{predictions.slice(0,30).map((prediction: any)=><div key={prediction.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(250px,1fr)_180px_210px]"><div><div className="flex flex-wrap items-center gap-2"><Status value={prediction.status}/><Status value={prediction.calibration_state}/><Status value={prediction.distribution_state}/></div><p className="mt-2 font-mono text-[10px] text-fg-primary">{prediction.prediction_key}</p><p className="mt-1 text-[9px] text-fg-muted">model {short(prediction.model_version_id)} · features {short(prediction.feature_snapshot_id)} · support {prediction.support_count}</p></div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Prediction</p><p className="mt-1 text-[11px] text-fg-secondary">{prediction.probability != null ? `probability ${pct(prediction.probability)}` : prediction.estimate != null ? `estimate ${Math.round(prediction.estimate).toLocaleString()}` : prediction.predicted_label ? humanize(prediction.predicted_label) : "No qualified forecast"}</p>{prediction.interval_lower != null && prediction.interval_upper != null?<p className="mt-1 text-[9px] text-fg-muted">interval {Number(prediction.interval_lower).toFixed(2)}–{Number(prediction.interval_upper).toFixed(2)}</p>:null}</div><div><p className="text-[9px] uppercase tracking-wider text-fg-muted">Confidence / observed</p><p className="mt-1 text-[10px] text-fg-secondary">{pct(prediction.confidence)} · {fmt(prediction.created_at)}</p><div className="mt-2 flex gap-2"><button onClick={() => void props.operation("ml_feedback", { predictionId: prediction.id, feedbackType: "accepted" })} disabled={disabled} className="text-[10px] text-link">Accept</button><button onClick={() => void props.operation("ml_feedback", { predictionId: prediction.id, feedbackType: "rejected" })} disabled={disabled} className="text-[10px] text-link">Reject</button></div></div></div>)}{!predictions.length?<p className="py-5 text-xs text-fg-muted">No predictions recorded. Use Compare or Predict on an immutable plan; unsupported models explicitly return insufficient-data.</p>:null}</div>
    </div>

    <div className="mt-7 border-t border-subtle pt-5">
      <div><h3 className="text-[14px] font-semibold text-fg-primary">Counterfactual plan comparisons</h3><p className="mt-1 text-[11px] text-fg-muted">Do now, do later, do nothing and materially different strategies are retained. Deterministic classification ranks before ML metrics.</p></div>
      <div className="mt-3 divide-y divide-[var(--border-subtle)]">{comparisons.slice(0,10).map((comparison: any)=><div key={comparison.id} className="py-4"><p className="font-mono text-[10px] text-fg-secondary">comparison {short(comparison.id)} · plan {short(comparison.plan_id)}</p><p className="mt-1 text-[10px] text-fg-muted">{comparison.comparison_json?.rankingMethod ?? "Deterministic constraints remain authoritative."}</p><p className="mt-1 text-[9px] text-fg-muted">ranked: {(comparison.comparison_json?.rankedActionableScenarioKeys ?? []).join(" → ") || "no qualified actionable ranking"}</p><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{(comparison.comparison_json?.scenarios ?? []).map((scenario: any)=><div key={scenario.key} className="border-l border-subtle py-2 pl-3"><div className="flex flex-wrap items-center gap-2"><p className="text-[11px] font-medium text-fg-primary">{scenario.title}</p><Status value={scenario.deterministicClassification}/></div><p className="mt-1 text-[9px] text-fg-muted">{humanize(scenario.kind)} · {scenario.executable?"executable":"comparison only"}</p><p className="mt-1 text-[9px] text-fg-secondary">risk {scenario.ranking?.predictedAdverseProbability == null?"—":pct(Number(scenario.ranking.predictedAdverseProbability))} · impact {scenario.ranking?.predictedImpactProbability == null?"—":pct(Number(scenario.ranking.predictedImpactProbability))} · duration {scenario.ranking?.predictedDurationMs == null?"—":`${Math.round(Number(scenario.ranking.predictedDurationMs))} ms`}</p>{scenario.executable?<button onClick={() => void props.operation("plan_select", { comparisonId: comparison.id, scenarioKey: scenario.key, reason: "Selected from Operational Intelligence review" })} disabled={disabled} className="mt-2 text-[10px] text-link">{comparison.selected_scenario_key===scenario.key?"Selected":"Select scenario"}</button>:null}</div>)}</div></div>)}{!comparisons.length?<p className="py-5 text-xs text-fg-muted">No counterfactual comparison yet. Select Compare on a plan.</p>:null}</div>
    </div>

    <div className="mt-7 border-t border-subtle pt-5">
      <div><h3 className="text-[14px] font-semibold text-fg-primary">Evaluation & calibration</h3><p className="mt-1 text-[11px] text-fg-muted">Prediction-versus-actual metrics trigger review warnings; they never trigger uncontrolled retraining.</p></div>
      <div className="mt-3 divide-y divide-[var(--border-subtle)]">{evaluations.slice(0,20).map((evaluation: any)=><div key={evaluation.id} className="grid gap-3 py-3 md:grid-cols-[1fr_140px_auto]"><div><p className="text-[11px] font-medium text-fg-primary">{humanize(evaluation.evaluation_kind)} · model {short(evaluation.model_version_id)}</p><p className="mt-1 text-[9px] text-fg-muted">{JSON.stringify(evaluation.metrics_json)}</p></div><p className="text-[10px] text-fg-secondary">{evaluation.sample_count} samples</p><Status value={evaluation.status}/></div>)}{!evaluations.length?<p className="py-5 text-xs text-fg-muted">No evaluation records yet.</p>:null}</div>
    </div>
  </section>;
}
