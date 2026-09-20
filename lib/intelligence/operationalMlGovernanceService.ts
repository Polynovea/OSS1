import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getOperationalLearningPolicy } from "@/lib/intelligence/operationalMlService";
import { logPlatformEvent } from "@/lib/platform/audit";

function calibrationError(rows: Array<{ probability: number; outcome: number }>, bins = 5) {
  if (!rows.length) return null;
  let weighted = 0;
  for (let i = 0; i < bins; i++) {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const bucket = rows.filter((row) => row.probability >= lo && (i === bins - 1 ? row.probability <= hi : row.probability < hi));
    if (!bucket.length) continue;
    const confidence = bucket.reduce((sum, row) => sum + row.probability, 0) / bucket.length;
    const accuracy = bucket.reduce((sum, row) => sum + row.outcome, 0) / bucket.length;
    weighted += (bucket.length / rows.length) * Math.abs(confidence - accuracy);
  }
  return weighted;
}

export async function enforceOperationalLearningRetention(workspaceId: string) {
  const db = createServiceRoleClient();
  const policy = await getOperationalLearningPolicy(workspaceId);
  const cutoff = new Date(Date.now() - Number(policy.retention_days) * 86400000).toISOString();
  const [snapshots, predictions, events, evaluations] = await Promise.all([
    db.from("operational_feature_snapshots").delete().eq("workspace_id", workspaceId).lt("captured_at", cutoff).select("id"),
    db.from("operational_predictions").delete().eq("workspace_id", workspaceId).lt("created_at", cutoff).select("id"),
    db.from("operational_events").delete().eq("workspace_id", workspaceId).lt("occurred_at", cutoff).select("id"),
    db.from("operational_model_evaluations").delete().eq("workspace_id", workspaceId).lt("evaluated_at", cutoff).select("id"),
  ]);
  for (const result of [snapshots, predictions, events, evaluations]) if (result.error) throw new Error(result.error.message);
  return {
    cutoff,
    retentionDays: policy.retention_days,
    deleted: {
      featureSnapshots: snapshots.data?.length ?? 0,
      predictions: predictions.data?.length ?? 0,
      operationalEvents: events.data?.length ?? 0,
      evaluations: evaluations.data?.length ?? 0,
    },
  };
}

export async function recordPredictionFeedback(params: {
  workspaceId: string;
  actorId: string;
  predictionId: string;
  feedbackType: "accepted" | "rejected" | "corrected" | "overridden";
  correctedLabel?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = createServiceRoleClient();
  const { data: prediction } = await db.from("operational_predictions")
    .select("id,environment_id,status,model_id,model_version_id,feature_snapshot_id")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.predictionId)
    .maybeSingle();
  if (!prediction) throw Object.assign(new Error("Prediction not found"), { status: 404 });
  const { data, error } = await db.from("operational_prediction_feedback").insert({
    workspace_id: params.workspaceId,
    prediction_id: params.predictionId,
    feedback_type: params.feedbackType,
    corrected_label: params.correctedLabel ?? null,
    reason: params.reason?.slice(0, 2000) ?? null,
    metadata_json: params.metadata ?? {},
    created_by: params.actorId,
  }).select().single();
  if (error || !data) throw new Error(error?.message || "Could not record prediction feedback");
  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "operational.ml.feedback.recorded",
    entityType: "operational_prediction",
    entityId: params.predictionId,
    metadata: { feedbackType: params.feedbackType, modelVersionId: prediction.model_version_id, featureSnapshotId: prediction.feature_snapshot_id },
  });
  return data;
}

export async function refreshOnlineModelEvaluations(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const { data: predictions, error } = await db.from("operational_predictions")
    .select("id,prediction_key,model_version_id,probability,estimate,interval_lower,interval_upper")
    .eq("workspace_id", workspaceId)
    .eq("environment_id", environmentId)
    .not("model_version_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const ids = (predictions ?? []).map((row) => row.id);
  if (!ids.length) return { evaluations: [] };
  const { data: outcomes, error: outcomeError } = await db.from("operational_prediction_outcomes")
    .select("prediction_id,outcome_json,evaluation_json,observed_at")
    .eq("workspace_id", workspaceId)
    .in("prediction_id", ids);
  if (outcomeError) throw new Error(outcomeError.message);
  const outcomeByPrediction = new Map((outcomes ?? []).map((row) => [row.prediction_id, row]));
  const groups = new Map<string, Array<{ prediction: any; outcome: any }>>();
  for (const prediction of predictions ?? []) {
    const outcome = outcomeByPrediction.get(prediction.id);
    if (!outcome || !prediction.model_version_id) continue;
    const rows = groups.get(prediction.model_version_id) ?? [];
    rows.push({ prediction, outcome });
    groups.set(prediction.model_version_id, rows);
  }
  const evaluations: any[] = [];
  for (const [modelVersionId, rows] of groups) {
    const probabilityRows = rows.flatMap(({ prediction, outcome }) => { if (prediction.probability == null) return []; const target = String(prediction.prediction_key ?? "").startsWith("dependency_impact") ? (Number(outcome.outcome_json?.downstreamImpactCount ?? 0) > 0 ? 1 : 0) : (outcome.outcome_json?.adverseOutcome ? 1 : 0); return [{ probability: Number(prediction.probability), outcome: target }]; });
    const durationRows = rows.flatMap(({ prediction, outcome }) => prediction.estimate == null || outcome.outcome_json?.durationMs == null ? [] : [{ predicted: Number(prediction.estimate), actual: Number(outcome.outcome_json.durationMs), inside: prediction.interval_lower != null && prediction.interval_upper != null ? Number(outcome.outcome_json.durationMs) >= Number(prediction.interval_lower) && Number(outcome.outcome_json.durationMs) <= Number(prediction.interval_upper) : null }]);
    const brier = probabilityRows.length ? probabilityRows.reduce((sum, row) => sum + (row.probability - row.outcome) ** 2, 0) / probabilityRows.length : null;
    const ece = calibrationError(probabilityRows);
    const mae = durationRows.length ? durationRows.reduce((sum, row) => sum + Math.abs(row.predicted - row.actual), 0) / durationRows.length : null;
    const intervalRows = durationRows.filter((row) => row.inside !== null);
    const intervalCoverage = intervalRows.length ? intervalRows.filter((row) => row.inside).length / intervalRows.length : null;
    const reviewRequired = rows.length >= 20 && ((brier != null && brier > 0.30) || (ece != null && ece > 0.15) || (intervalCoverage != null && intervalCoverage < 0.60));
    const metrics = { sampleCount: rows.length, brierScore: brier, expectedCalibrationError: ece, meanAbsoluteErrorMs: mae, intervalCoverage, reviewRequired };
    const { data: evaluation, error: insertError } = await db.from("operational_model_evaluations").insert({
      workspace_id: workspaceId,
      model_version_id: modelVersionId,
      evaluation_kind: "online",
      sample_count: rows.length,
      metrics_json: metrics,
      distribution_json: { environmentId, reviewRequired, automaticRetraining: false },
      status: reviewRequired ? "warning" : "recorded",
    }).select().single();
    if (insertError || !evaluation) throw new Error(insertError?.message || "Could not persist online model evaluation");
    evaluations.push(evaluation);
  }
  return { evaluations };
}

export async function listOperationalMlFeedback(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const { data: predictions } = await db.from("operational_predictions").select("id").eq("workspace_id", workspaceId).eq("environment_id", environmentId).limit(500);
  const ids = (predictions ?? []).map((item) => item.id);
  if (!ids.length) return [];
  const { data, error } = await db.from("operational_prediction_feedback").select("*").eq("workspace_id", workspaceId).in("prediction_id", ids).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}
