import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { verifyConnection } from "@/lib/infrastructure/connectionService";
import { runComponentAction, runSystemDoctor } from "@/lib/infrastructure/operabilityService";
import { replayDeliveryJob } from "@/lib/operations/deliveryJobService";
import { refreshOperationalWorldModel } from "@/lib/intelligence/worldModelService";
import { getAutonomyPolicy } from "@/lib/intelligence/planningService";
import { getActiveDesiredState, reconcileOperationalState } from "@/lib/intelligence/reconciliationService";
import type { OperationalDeterministicClassification } from "@/lib/intelligence/operationalTypes";
import { logPlatformEvent } from "@/lib/platform/audit";

const CLASSIFICATION_ORDER: Record<OperationalDeterministicClassification, number> = {
  safe: 0,
  requires_lock: 1,
  requires_backfill: 2,
  requires_data_migration: 3,
  potentially_destructive: 4,
  destructive: 5,
};

export async function listRemediationRegistry() {
  const { data, error } = await createServiceRoleClient().from("operational_remediation_registry").select("*").eq("enabled", true).order("remediation_key");
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function resolveRegistry(remediationKey: string) {
  const { data, error } = await createServiceRoleClient().from("operational_remediation_registry").select("*").eq("remediation_key", remediationKey).eq("enabled", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw Object.assign(new Error(`Remediation ${remediationKey} is not registered/enabled`), { status: 409 });
  return data;
}

function safeResult(remediationKey: string, raw: any): Record<string, unknown> {
  if (remediationKey === "connection.reverify") return { status: raw?.status ?? raw?.latestVerification?.status ?? null, verificationRunId: raw?.id ?? raw?.latestVerification?.id ?? null };
  if (remediationKey === "component.recheck") return { status: raw?.status ?? null, componentRunId: raw?.id ?? null, result: raw?.result_json ?? {} };
  if (remediationKey === "system.doctor") return { status: raw?.status ?? null, doctorRunId: raw?.id ?? null, summary: raw?.summary_json ?? {} };
  if (remediationKey === "world.rediscover") return { status: raw?.run?.status ?? null, discoveryRunId: raw?.run?.id ?? null, summary: raw?.summary ?? {} };
  if (remediationKey === "delivery.replay") return { status: raw?.status ?? "queued", replayJobId: raw?.id ?? null, replayOfJobId: raw?.replay_of_job_id ?? null };
  return { status: "completed" };
}

async function verifyAfter(params: { workspaceId: string; environmentId: string; actorId: string; remediationKey: string; targetId?: string | null; desiredStateRevisionId?: string | null }) {
  const discovery = await refreshOperationalWorldModel({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, source: "controller" });
  const desired = params.desiredStateRevisionId
    ? { id: params.desiredStateRevisionId }
    : await getActiveDesiredState(params.workspaceId, params.environmentId);
  const reconciliation = desired?.id
    ? await reconcileOperationalState({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, desiredStateRevisionId: desired.id, refreshWorld: false })
    : null;
  const unresolvedForTarget = (reconciliation?.drifts ?? []).filter((drift: any) => {
    if (params.remediationKey === "connection.reverify") return String(drift.drift_key).includes(String(params.targetId ?? ""));
    if (params.remediationKey === "component.recheck") return String(drift.drift_key).includes(String(params.targetId ?? ""));
    if (params.remediationKey === "world.rediscover") return String(drift.drift_key).endsWith(".stale");
    if (params.remediationKey === "system.doctor") return drift.category === "environment";
    return false;
  });
  return {
    discoveryRunId: discovery.run.id,
    reconciliationRunId: reconciliation?.run?.id ?? null,
    unresolvedTargetDriftCount: unresolvedForTarget.length,
    convergedForTarget: unresolvedForTarget.length === 0,
  };
}

export async function executeDeterministicRemediation(params: {
  workspaceId: string;
  environmentId: string;
  actorId: string;
  remediationKey: string;
  targetType: string;
  targetId?: string | null;
  sourceDriftItemId?: string | null;
  executionMode?: "manual" | "approval_execute" | "policy_auto_repair";
  desiredStateRevisionId?: string | null;
}) {
  const db = createServiceRoleClient();
  const [registry, policy, environment] = await Promise.all([
    resolveRegistry(params.remediationKey),
    getAutonomyPolicy(params.workspaceId, params.environmentId),
    db.from("workspace_environments").select("id,kind").eq("workspace_id", params.workspaceId).eq("id", params.environmentId).maybeSingle().then((r: any) => r.data),
  ]);
  if (!environment) throw Object.assign(new Error("Environment not found"), { status: 404 });

  const classification = String(registry.deterministic_classification) as OperationalDeterministicClassification;
  const executionMode = params.executionMode ?? "manual";
  if (executionMode === "policy_auto_repair") {
    if (policy.mode !== "policy_auto_repair") throw Object.assign(new Error("Environment autonomy policy does not allow policy auto-repair"), { status: 409 });
    if (!(policy.allowed_remediation_keys ?? []).includes(params.remediationKey)) throw Object.assign(new Error(`Remediation ${params.remediationKey} is not allow-listed by environment policy`), { status: 409 });
    const policyMax = String(policy.max_deterministic_classification || "safe") as OperationalDeterministicClassification;
    if (CLASSIFICATION_ORDER[classification] > CLASSIFICATION_ORDER[policyMax]) throw Object.assign(new Error(`Remediation classification ${classification} exceeds policy maximum ${policyMax}`), { status: 409 });
    if (environment.kind === "production" && classification !== "safe") throw Object.assign(new Error("Production auto-repair is restricted to deterministically SAFE remediations"), { status: 409 });
  }

  const correlationId = randomUUID();
  const { data: run, error: runError } = await db.from("operational_remediation_runs").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    remediation_key: params.remediationKey,
    source_drift_item_id: params.sourceDriftItemId ?? null,
    target_type: params.targetType,
    target_id: params.targetId ?? null,
    deterministic_classification: classification,
    execution_mode: executionMode,
    status: "running",
    correlation_id: correlationId,
    safe_input_json: { remediationKey: params.remediationKey, targetType: params.targetType, targetId: params.targetId ?? null },
    started_by: params.actorId,
  }).select().single();
  if (runError || !run) throw new Error(runError?.message || "Could not start remediation run");

  try {
    let raw: any;
    if (params.remediationKey === "connection.reverify") {
      if (!params.targetId) throw Object.assign(new Error("connection.reverify requires targetId"), { status: 409 });
      raw = await verifyConnection({ workspaceId: params.workspaceId, actorId: params.actorId, connectionId: params.targetId });
    } else if (params.remediationKey === "component.recheck") {
      if (!params.targetId) throw Object.assign(new Error("component.recheck requires targetId"), { status: 409 });
      raw = await runComponentAction({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, componentId: params.targetId, operation: "check" });
    } else if (params.remediationKey === "system.doctor") {
      raw = await runSystemDoctor({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId });
    } else if (params.remediationKey === "world.rediscover") {
      raw = await refreshOperationalWorldModel({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, source: "controller" });
    } else if (params.remediationKey === "delivery.replay") {
      if (!params.targetId) throw Object.assign(new Error("delivery.replay requires targetId"), { status: 409 });
      raw = await replayDeliveryJob({ workspaceId: params.workspaceId, actorId: params.actorId, jobId: params.targetId });
    } else {
      throw Object.assign(new Error(`Registered remediation ${params.remediationKey} has no deterministic executor`), { status: 409 });
    }

    const result = safeResult(params.remediationKey, raw);
    const verification = params.remediationKey === "delivery.replay"
      ? { replayQueued: Boolean((result as any).replayJobId), convergedForTarget: Boolean((result as any).replayJobId) }
      : await verifyAfter({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, remediationKey: params.remediationKey, targetId: params.targetId, desiredStateRevisionId: params.desiredStateRevisionId });
    const status = verification.convergedForTarget ? "succeeded" : "partial";
    const completedAt = new Date().toISOString();
    const { data: completed, error } = await db.from("operational_remediation_runs").update({ status, safe_result_json: result, verification_json: verification, completed_at: completedAt }).eq("id", run.id).select().single();
    if (error || !completed) throw new Error(error?.message || "Could not finalize remediation run");

    await db.from("operational_events").insert({
      workspace_id: params.workspaceId,
      environment_id: params.environmentId,
      event_type: "remediation.outcome",
      source_type: "operational_remediation_run",
      source_id: completed.id,
      correlation_id: correlationId,
      occurred_at: completedAt,
      features_json: { remediationKey: params.remediationKey, classification, executionMode, environmentKind: environment.kind, targetType: params.targetType },
      outcome_json: { status, convergedForTarget: verification.convergedForTarget, unresolvedTargetDriftCount: "unresolvedTargetDriftCount" in verification ? verification.unresolvedTargetDriftCount : null },
      privacy_class: "operational_minimized",
      eligible_for_local_learning: true,
      eligible_for_cross_install_learning: false,
    });
    await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "operational.remediation.completed", entityType: "operational_remediation_run", entityId: completed.id, metadata: { environmentId: params.environmentId, remediationKey: params.remediationKey, classification, executionMode, status, correlationId } });
    return completed;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Deterministic remediation failed";
    const completedAt = new Date().toISOString();
    await db.from("operational_remediation_runs").update({ status: "failed", error_code: "REMEDIATION_FAILED", error_message: message.slice(0, 2000), completed_at: completedAt }).eq("id", run.id);
    await db.from("operational_events").insert({
      workspace_id: params.workspaceId,
      environment_id: params.environmentId,
      event_type: "remediation.outcome",
      source_type: "operational_remediation_run",
      source_id: run.id,
      correlation_id: correlationId,
      occurred_at: completedAt,
      features_json: { remediationKey: params.remediationKey, classification, executionMode, environmentKind: environment.kind, targetType: params.targetType },
      outcome_json: { status: "failed", errorClass: "REMEDIATION_FAILED" },
      privacy_class: "operational_minimized",
      eligible_for_local_learning: true,
      eligible_for_cross_install_learning: false,
    });
    throw Object.assign(new Error(message), { status: Number((cause as any)?.status) || 400 });
  }
}

function remediationForDrift(drift: any, node: any): { key: string; targetType: string; targetId: string | null } | null {
  if (String(drift.drift_key).endsWith(".stale")) return { key: "world.rediscover", targetType: "workspace_environment", targetId: drift.environment_id };
  if (drift.category === "connection") return { key: "connection.reverify", targetType: "workspace_connection", targetId: String(drift.drift_key).split(".")[1] || node?.source_entity_id || null };
  if (drift.category === "capability" && node?.source_entity_id) return { key: "component.recheck", targetType: "environment_component", targetId: node.source_entity_id };
  if (drift.category === "environment") return { key: "system.doctor", targetType: "workspace_environment", targetId: drift.environment_id };
  return null;
}

export async function runPolicyAutoRepair(params: { workspaceId: string; environmentId: string; actorId: string }) {
  const db = createServiceRoleClient();
  const policy = await getAutonomyPolicy(params.workspaceId, params.environmentId);
  if (policy.mode !== "policy_auto_repair") throw Object.assign(new Error("Environment is not configured for policy auto-repair"), { status: 409 });
  const desired = await getActiveDesiredState(params.workspaceId, params.environmentId);
  if (!desired) throw Object.assign(new Error("No active desired state exists"), { status: 409 });

  const [{ data: drifts }, { data: nodes }] = await Promise.all([
    db.from("operational_drift_items").select("*").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("desired_state_revision_id", desired.id).eq("state", "open").eq("action_class", "safe_auto_repair").order("severity"),
    db.from("operational_world_nodes").select("id,source_entity_id").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId),
  ]);
  const nodeById = new Map((nodes ?? []).map((node: any) => [node.id, node]));
  const results: Array<Record<string, unknown>> = [];
  for (const drift of drifts ?? []) {
    const mapped = remediationForDrift(drift, drift.node_id ? nodeById.get(drift.node_id) : null);
    if (!mapped) {
      results.push({ driftId: drift.id, status: "skipped", reason: "no_safe_deterministic_remediation" });
      continue;
    }
    if (!(policy.allowed_remediation_keys ?? []).includes(mapped.key)) {
      results.push({ driftId: drift.id, remediationKey: mapped.key, status: "skipped", reason: "not_allow_listed" });
      continue;
    }
    try {
      const run = await executeDeterministicRemediation({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, remediationKey: mapped.key, targetType: mapped.targetType, targetId: mapped.targetId, sourceDriftItemId: drift.id, executionMode: "policy_auto_repair", desiredStateRevisionId: desired.id });
      results.push({ driftId: drift.id, remediationKey: mapped.key, remediationRunId: run.id, status: run.status });
    } catch (cause) {
      results.push({ driftId: drift.id, remediationKey: mapped.key, status: "failed", error: cause instanceof Error ? cause.message : "auto-repair failed" });
    }
  }
  return { attempted: results.filter((item) => item.status !== "skipped").length, candidates: (drifts ?? []).length, results };
}
