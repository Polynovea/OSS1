import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { sha256Canonical } from "@/lib/intelligence/operationalCanonical";
import { captureOperationalFeatureSnapshot, ensureOperationalModelRegistry, getOperationalLearningPolicy } from "@/lib/intelligence/operationalMlService";
import { logPlatformEvent } from "@/lib/platform/audit";

const CLASSIFICATION_ORDER: Record<string, number> = {
  safe: 0,
  requires_lock: 1,
  requires_backfill: 2,
  requires_data_migration: 3,
  potentially_destructive: 4,
  destructive: 5,
};

const FAMILIES = ["migration_change_risk", "execution_duration", "dependency_impact"] as const;
type Family = (typeof FAMILIES)[number];

interface Scenario {
  key: string;
  title: string;
  kind: "execute_now" | "execute_later" | "alternative" | "do_nothing";
  deterministicClassification: string;
  executable: boolean;
  deterministicReason: string;
  strategyKey?: string | null;
}

async function loadFamily(workspaceId: string, family: Family) {
  const db = createServiceRoleClient();
  const { data: model } = await db.from("operational_model_registry").select("*").eq("workspace_id", workspaceId).eq("model_family", family).eq("enabled", true).maybeSingle();
  if (!model) return { model: null, version: null, integrity: "unavailable" as const };
  const { data: version } = await db.from("operational_model_versions").select("*").eq("model_id", model.id).eq("status", "deployed").maybeSingle();
  if (!version) return { model, version: null, integrity: "unavailable" as const };
  const expected = sha256Canonical({ modelKey: model.model_key, version: version.version, technique: version.technique, artifact: version.artifact_json, featureContract: version.feature_contract_json });
  if (expected !== version.integrity_sha256) {
    await db.from("operational_model_versions").update({ status: "failed" }).eq("id", version.id).eq("status", "deployed");
    return { model, version: null, integrity: "failed" as const };
  }
  return { model, version, integrity: "verified" as const };
}

async function persistScenarioPrediction(params: {
  workspaceId: string;
  environmentId: string;
  planId: string;
  scenario: Scenario;
  family: Family;
  model: any;
  version: any | null;
  snapshot: any;
  status: string;
  probability?: number | null;
  estimate?: number | null;
  lower?: number | null;
  upper?: number | null;
  confidence?: number | null;
  supportCount?: number;
  calibrationState?: string;
  distributionState?: string;
  prediction?: Record<string, unknown>;
  explanation?: Record<string, unknown>;
}) {
  const { data, error } = await createServiceRoleClient().from("operational_predictions").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    model_id: params.model.id,
    model_version_id: params.version?.id ?? null,
    feature_snapshot_id: params.snapshot?.id ?? null,
    prediction_key: `${params.family}:${params.planId}:${params.scenario.key}`,
    subject_type: "operational_plan_scenario",
    subject_id: `${params.planId}:${params.scenario.key}`,
    status: params.status,
    probability: params.probability ?? null,
    estimate: params.estimate ?? null,
    interval_lower: params.lower ?? null,
    interval_upper: params.upper ?? null,
    confidence: params.confidence ?? null,
    support_count: params.supportCount ?? 0,
    calibration_state: params.calibrationState ?? "unavailable",
    distribution_state: params.distributionState ?? "unknown",
    prediction_json: { family: params.family, scenarioKey: params.scenario.key, ...(params.prediction ?? {}) },
    explanation_json: { deterministicClassification: params.scenario.deterministicClassification, deterministicSafetyAuthority: true, ...(params.explanation ?? {}) },
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  }).select().single();
  if (error || !data) throw new Error(error?.message || "Could not persist scenario prediction");
  return data;
}

function scenariosFromPlan(plan: any, nodes: any[]): Scenario[] {
  const scenarios: Scenario[] = [
    {
      key: "do_now",
      title: "Execute reviewed plan now",
      kind: "execute_now",
      deterministicClassification: String(plan.deterministic_classification),
      executable: true,
      deterministicReason: "Uses the immutable plan exactly as reviewed; permissions, freshness and approval remain mandatory.",
    },
    {
      key: "do_later",
      title: "Do later",
      kind: "execute_later",
      deterministicClassification: String(plan.deterministic_classification),
      executable: false,
      deterministicReason: "Defers execution; current drift remains and the immutable plan must be revalidated or regenerated when evidence changes.",
    },
    {
      key: "do_nothing",
      title: "Do nothing",
      kind: "do_nothing",
      deterministicClassification: "safe",
      executable: false,
      deterministicReason: "Makes no mutation, but intentionally leaves current deterministic drift unresolved.",
    },
  ];
  const seen = new Set<string>();
  for (const node of nodes) {
    const alternatives = Array.isArray(node.input_json?.alternatives) ? node.input_json.alternatives : [];
    for (const alternative of alternatives) {
      const strategyKey = String(alternative?.key ?? "").trim();
      if (!strategyKey || seen.has(strategyKey)) continue;
      seen.add(strategyKey);
      const classification = String(alternative?.classification ?? node.deterministic_classification ?? plan.deterministic_classification).toLowerCase();
      scenarios.push({
        key: `alternative:${strategyKey}`,
        title: String(alternative?.title ?? strategyKey.replaceAll("_", " ")),
        kind: "alternative",
        deterministicClassification: CLASSIFICATION_ORDER[classification] === undefined ? String(node.deterministic_classification) : classification,
        executable: ["direct_metadata_change", "staged_backfill", "copy_transform_verify", "deprecate_retain"].includes(strategyKey),
        deterministicReason: `Deterministic migration alternative ${strategyKey}; execution is permitted only if a fresh assessment still validates this strategy.`,
        strategyKey,
      });
    }
  }
  return scenarios;
}

function metricByFamily(predictions: any[], family: Family) {
  return predictions.find((prediction) => prediction.prediction_json?.family === family) ?? null;
}

export async function compareOperationalPlanScenarios(params: { workspaceId: string; environmentId: string; planId: string; actorId: string }) {
  const db = createServiceRoleClient();
  await ensureOperationalModelRegistry(params.workspaceId);
  const [{ data: plan }, { data: nodes }, policy] = await Promise.all([
    db.from("operational_change_plans").select("*").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("id", params.planId).maybeSingle(),
    db.from("operational_change_plan_nodes").select("*").eq("plan_id", params.planId).order("ordinal"),
    getOperationalLearningPolicy(params.workspaceId),
  ]);
  if (!plan) throw Object.assign(new Error("Operational plan not found"), { status: 404 });
  const scenarios = scenariosFromPlan(plan, nodes ?? []);
  const snapshot = await captureOperationalFeatureSnapshot({ workspaceId: params.workspaceId, environmentId: params.environmentId, featureFamily: "plan_comparison_v1" });
  const familyState = new Map<Family, Awaited<ReturnType<typeof loadFamily>>>();
  for (const family of FAMILIES) familyState.set(family, await loadFamily(params.workspaceId, family));

  const rendered: Array<Scenario & { predictions: any[]; ranking: Record<string, unknown> }> = [];
  for (const scenario of scenarios) {
    const predictions: any[] = [];
    if (scenario.kind !== "do_nothing") {
      for (const family of FAMILIES) {
        const resolved = familyState.get(family)!;
        if (!resolved.model) continue;
        const common = { workspaceId: params.workspaceId, environmentId: params.environmentId, planId: params.planId, scenario, family, model: resolved.model, version: resolved.version, snapshot };
        if (!policy.local_learning_enabled || !resolved.version) {
          predictions.push(await persistScenarioPrediction({ ...common, status: policy.local_learning_enabled ? "insufficient_data" : "disabled", supportCount: 0, distributionState: "low_support", explanation: { reason: resolved.integrity === "failed" ? "model_artifact_integrity_failed" : policy.local_learning_enabled ? "no_validated_deployed_model" : "local_learning_disabled" } }));
          continue;
        }
        const artifact = resolved.version.artifact_json ?? {};
        const classification = scenario.deterministicClassification;
        if (family === "execution_duration") {
          const group = artifact.byClassification?.[classification] ?? null;
          const support = Number(group?.support ?? 0);
          if (!group || support < Math.max(4, Math.floor(Number(resolved.model.minimum_support) / 4))) {
            predictions.push(await persistScenarioPrediction({ ...common, status: "out_of_distribution", supportCount: support, calibrationState: resolved.version.calibration_json?.state ?? "unavailable", distributionState: "out_of_distribution", explanation: { reason: "insufficient_duration_support_for_classification" } }));
          } else {
            predictions.push(await persistScenarioPrediction({ ...common, status: "ready", estimate: Number(group.median), lower: Number(group.p10), upper: Number(group.p90), confidence: Math.min(1, support / Math.max(Number(resolved.model.minimum_support), 1)), supportCount: support, calibrationState: resolved.version.calibration_json?.state ?? "provisional", distributionState: "in_distribution", prediction: { medianDurationMs: Number(group.median), intervalP10P90Ms: [Number(group.p10), Number(group.p90)] }, explanation: { technique: resolved.version.technique, support } }));
          }
          continue;
        }
        const group = family === "migration_change_risk" ? artifact.byClassification?.[classification]?.posterior ?? null : artifact.byClassification?.[classification] ?? null;
        const posterior = family === "migration_change_risk" ? group : group?.posterior ?? null;
        const support = Number(family === "migration_change_risk" ? posterior?.support ?? 0 : group?.support ?? 0);
        if (!posterior || support < Math.max(5, Math.floor(Number(resolved.model.minimum_support) / 4))) {
          predictions.push(await persistScenarioPrediction({ ...common, status: "out_of_distribution", supportCount: support, calibrationState: resolved.version.calibration_json?.state ?? "unavailable", distributionState: "out_of_distribution", explanation: { reason: "insufficient_support_for_classification" } }));
        } else {
          const probability = Number(posterior.mean);
          predictions.push(await persistScenarioPrediction({ ...common, status: "ready", probability, lower: Number(posterior.lower), upper: Number(posterior.upper), estimate: family === "dependency_impact" ? Number(group?.impactCountMedian ?? 0) : null, confidence: Math.min(1, support / Math.max(Number(resolved.model.minimum_support), 1)), supportCount: support, calibrationState: resolved.version.calibration_json?.state ?? "provisional", distributionState: "in_distribution", prediction: family === "migration_change_risk" ? { adverseOutcomeProbability: probability, interval: [Number(posterior.lower), Number(posterior.upper)] } : { downstreamImpactProbability: probability, impactCountMedian: Number(group?.impactCountMedian ?? 0), impactCountP90: Number(group?.impactCountP90 ?? 0), interval: [Number(posterior.lower), Number(posterior.upper)] }, explanation: { technique: resolved.version.technique, support } }));
        }
      }
    }
    const risk = metricByFamily(predictions, "migration_change_risk");
    const duration = metricByFamily(predictions, "execution_duration");
    const impact = metricByFamily(predictions, "dependency_impact");
    rendered.push({
      ...scenario,
      predictions,
      ranking: {
        deterministicOrder: CLASSIFICATION_ORDER[scenario.deterministicClassification] ?? 99,
        predictedAdverseProbability: risk?.status === "ready" ? risk.probability : null,
        predictedDurationMs: duration?.status === "ready" ? duration.estimate : null,
        predictedImpactProbability: impact?.status === "ready" ? impact.probability : null,
        mlStatus: predictions.length && predictions.every((item) => item.status === "ready") ? "supported" : policy.local_learning_enabled ? "insufficient_or_shifted" : "disabled",
      },
    });
  }

  const actionable = rendered.filter((scenario) => scenario.executable);
  actionable.sort((a, b) => {
    const ac = Number(a.ranking.deterministicOrder), bc = Number(b.ranking.deterministicOrder);
    if (ac !== bc) return ac - bc;
    const ar = a.ranking.predictedAdverseProbability == null ? Number.POSITIVE_INFINITY : Number(a.ranking.predictedAdverseProbability);
    const br = b.ranking.predictedAdverseProbability == null ? Number.POSITIVE_INFINITY : Number(b.ranking.predictedAdverseProbability);
    if (ar !== br) return ar - br;
    const ai = a.ranking.predictedImpactProbability == null ? Number.POSITIVE_INFINITY : Number(a.ranking.predictedImpactProbability);
    const bi = b.ranking.predictedImpactProbability == null ? Number.POSITIVE_INFINITY : Number(b.ranking.predictedImpactProbability);
    if (ai !== bi) return ai - bi;
    const ad = a.ranking.predictedDurationMs == null ? Number.POSITIVE_INFINITY : Number(a.ranking.predictedDurationMs);
    const bd = b.ranking.predictedDurationMs == null ? Number.POSITIVE_INFINITY : Number(b.ranking.predictedDurationMs);
    return ad - bd;
  });
  const rankedKeys = actionable.map((item) => item.key);
  const document = {
    format: "polynovea-operational-plan-comparison",
    formatVersion: 1,
    planId: plan.id,
    planChecksum: plan.plan_checksum_sha256,
    deterministicSafetyAuthority: true,
    featureSnapshotId: snapshot.id,
    scenarios: rendered,
    rankedActionableScenarioKeys: rankedKeys,
    rankingMethod: "lexicographic: deterministic classification first; calibrated risk, impact and duration only rank equally safe deterministic choices",
    createdAt: new Date().toISOString(),
  };
  const { data: comparison, error } = await db.from("operational_plan_comparisons").insert({ workspace_id: params.workspaceId, environment_id: params.environmentId, plan_id: plan.id, comparison_json: document, created_by: params.actorId }).select().single();
  if (error || !comparison) throw new Error(error?.message || "Could not persist operational plan comparison");
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "operational.plan.compared", entityType: "operational_change_plan", entityId: plan.id, metadata: { comparisonId: comparison.id, scenarioCount: rendered.length, rankedActionableScenarioKeys: rankedKeys, mlEnabled: Boolean(policy.local_learning_enabled) } });
  return comparison;
}

export async function selectOperationalPlanScenario(params: { workspaceId: string; environmentId: string; comparisonId: string; scenarioKey: string; actorId: string; reason?: string | null }) {
  const db = createServiceRoleClient();
  const { data: comparison } = await db.from("operational_plan_comparisons").select("*").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("id", params.comparisonId).maybeSingle();
  if (!comparison) throw Object.assign(new Error("Plan comparison not found"), { status: 404 });
  const scenarios = Array.isArray(comparison.comparison_json?.scenarios) ? comparison.comparison_json.scenarios : [];
  if (!scenarios.some((item: any) => item.key === params.scenarioKey)) throw Object.assign(new Error("Scenario is not part of this immutable comparison"), { status: 409 });
  const now = new Date().toISOString();
  const { data, error } = await db.from("operational_plan_comparisons").update({ selected_scenario_key: params.scenarioKey, selection_reason: params.reason?.slice(0, 2000) ?? null, selected_by: params.actorId, selected_at: now, updated_at: now }).eq("id", comparison.id).select().single();
  if (error || !data) throw new Error(error?.message || "Could not record selected plan scenario");
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "operational.plan.scenario_selected", entityType: "operational_plan_comparison", entityId: comparison.id, metadata: { planId: comparison.plan_id, scenarioKey: params.scenarioKey } });
  return data;
}

export async function listOperationalPlanComparisons(workspaceId: string, environmentId: string) {
  const { data, error } = await createServiceRoleClient().from("operational_plan_comparisons").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}
