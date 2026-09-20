import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { sha256Canonical } from "@/lib/intelligence/operationalCanonical";
import type { OperationalDesiredState, OperationalDriftCandidate } from "@/lib/intelligence/operationalTypes";
import { buildGeneratedDesiredState, getOperationalWorldModel, refreshOperationalWorldModel } from "@/lib/intelligence/worldModelService";

function assertDesiredState(value: unknown): asserts value is OperationalDesiredState {
  if (!value || typeof value !== "object") throw Object.assign(new Error("Desired state must be an object"), { status: 400 });
  const desired = value as Partial<OperationalDesiredState>;
  if (desired.schemaVersion !== 1) throw Object.assign(new Error("Unsupported desired-state schema version"), { status: 400 });
  if (!desired.environment || !desired.capabilities || !desired.connections || !desired.schemas || !desired.runtime || !desired.websites) {
    throw Object.assign(new Error("Desired state is missing required sections"), { status: 400 });
  }
}

export async function listDesiredStateRevisions(workspaceId: string, environmentId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("operational_desired_state_revisions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("environment_id", environmentId)
    .order("revision", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getActiveDesiredState(workspaceId: string, environmentId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("operational_desired_state_revisions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("environment_id", environmentId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function createDesiredStateRevision(params: {
  workspaceId: string;
  environmentId: string;
  actorId: string;
  desired?: OperationalDesiredState | null;
  activate?: boolean;
  source?: "user" | "generated_baseline" | "api" | "import";
  changeNote?: string | null;
}) {
  const db = createServiceRoleClient();
  const desired = params.desired ?? (await buildGeneratedDesiredState(params.workspaceId, params.environmentId));
  assertDesiredState(desired);
  const checksum = sha256Canonical(desired);

  const { data: existing, error: existingError } = await db
    .from("operational_desired_state_revisions")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("environment_id", params.environmentId)
    .eq("checksum_sha256", checksum)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    if (params.activate && existing.status !== "active") return activateDesiredStateRevision({ workspaceId: params.workspaceId, environmentId: params.environmentId, revisionId: existing.id, actorId: params.actorId });
    return existing;
  }

  const { data: latest, error: latestError } = await db
    .from("operational_desired_state_revisions")
    .select("revision")
    .eq("workspace_id", params.workspaceId)
    .eq("environment_id", params.environmentId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(latestError.message);
  const revision = Number(latest?.revision ?? 0) + 1;

  const { data: created, error } = await db.from("operational_desired_state_revisions").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    revision,
    status: "draft",
    source: params.source ?? (params.desired ? "user" : "generated_baseline"),
    desired_json: desired,
    checksum_sha256: checksum,
    change_note: params.changeNote ?? null,
    created_by: params.actorId,
  }).select().single();
  if (error || !created) throw new Error(error?.message || "Could not create desired-state revision");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "operational.desired_state.created",
    entityType: "operational_desired_state",
    entityId: created.id,
    metadata: { environmentId: params.environmentId, revision, checksum, source: created.source },
  });

  return params.activate
    ? activateDesiredStateRevision({ workspaceId: params.workspaceId, environmentId: params.environmentId, revisionId: created.id, actorId: params.actorId })
    : created;
}

export async function activateDesiredStateRevision(params: { workspaceId: string; environmentId: string; revisionId: string; actorId: string }) {
  const { data, error } = await createServiceRoleClient().rpc("cms_activate_operational_desired_state", {
    p_workspace_id: params.workspaceId,
    p_environment_id: params.environmentId,
    p_revision_id: params.revisionId,
    p_actor_id: params.actorId,
  });
  if (error || !data) throw Object.assign(new Error(error?.message || "Could not activate desired-state revision"), { status: error?.code === "P0002" ? 404 : 400 });
  return data;
}

function actionForEnvironment(kind: string, severity: "warning" | "blocking"): OperationalDriftCandidate["actionClass"] {
  if (kind === "production" && severity === "blocking") return "approval_required";
  return "recommend";
}

export function calculateDriftCandidates(params: {
  desired: OperationalDesiredState;
  environment: { id: string; kind: string; status: string };
  worldNodes: Array<any>;
}): OperationalDriftCandidate[] {
  const { desired, environment, worldNodes } = params;
  const byKey = new Map(worldNodes.map((node) => [String(node.node_key), node]));
  const drifts: OperationalDriftCandidate[] = [];
  const envNode = byKey.get(`environment:${environment.id}`);
  const observedEnvironmentStatus = String(envNode?.attributes_json?.declaredStatus ?? environment.status ?? "unknown");

  if (desired.environment.status && observedEnvironmentStatus !== desired.environment.status) {
    const severity = observedEnvironmentStatus === "blocked" ? "blocking" : "warning";
    drifts.push({
      driftKey: "environment.status",
      category: "environment",
      severity,
      actionClass: actionForEnvironment(environment.kind, severity),
      nodeId: envNode?.id ?? null,
      current: { status: observedEnvironmentStatus },
      desired: { status: desired.environment.status },
      evidence: { nodeKey: envNode?.node_key ?? null, lastObservedAt: envNode?.last_observed_at ?? null, stale: Boolean(envNode?.is_stale) },
    });
  }

  for (const [componentKey, target] of Object.entries(desired.capabilities)) {
    const node = byKey.get(`component:${componentKey}`);
    const currentState = String(node?.state ?? "missing");
    const required = target.required !== false;
    if (node?.is_stale) {
      drifts.push({
        driftKey: `capability.${componentKey}.stale`,
        category: "capability",
        severity: required ? "warning" : "info",
        actionClass: "safe_auto_repair",
        nodeId: node.id,
        current: { state: currentState, stale: true },
        desired: { state: target.state, stale: false },
        evidence: { lastObservedAt: node.last_observed_at, validUntil: node.valid_until },
      });
      continue;
    }
    if (!["present", "supported", "healthy"].includes(currentState)) {
      const severity: "warning" | "blocking" = required ? "blocking" : "warning";
      const actionClass: OperationalDriftCandidate["actionClass"] = currentState === "unsupported" || !node?.provider
        ? "manual_provider_action_required"
        : environment.kind === "production" && severity === "blocking"
          ? "approval_required"
          : "recommend";
      drifts.push({
        driftKey: `capability.${componentKey}.state`,
        category: "capability",
        severity,
        actionClass,
        nodeId: node?.id ?? null,
        current: { state: currentState, provider: node?.provider ?? null },
        desired: target as Record<string, unknown>,
        evidence: { nodeKey: node?.node_key ?? null, lastObservedAt: node?.last_observed_at ?? null },
      });
    }
  }

  for (const [connectionId, target] of Object.entries(desired.connections)) {
    const node = byKey.get(`connection:${connectionId}`);
    const currentStatus = String(node?.attributes_json?.status ?? "missing");
    if (node?.is_stale) {
      drifts.push({
        driftKey: `connection.${connectionId}.stale`,
        category: "connection",
        severity: "warning",
        actionClass: "safe_auto_repair",
        nodeId: node.id,
        current: { status: currentStatus, stale: true },
        desired: { status: target.status, stale: false },
        evidence: { lastObservedAt: node.last_observed_at, validUntil: node.valid_until },
      });
    } else if (currentStatus !== target.status) {
      drifts.push({
        driftKey: `connection.${connectionId}.status`,
        category: "connection",
        severity: "warning",
        actionClass: "recommend",
        nodeId: node?.id ?? null,
        current: { status: currentStatus },
        desired: target as Record<string, unknown>,
        evidence: { provider: node?.provider ?? null, lastObservedAt: node?.last_observed_at ?? null },
      });
    }
  }

  for (const [modelId, target] of Object.entries(desired.schemas)) {
    const node = byKey.get(`schema:${modelId}`);
    const deployedVersionRaw = node?.attributes_json?.deployedVersion;
    const deployedVersion = deployedVersionRaw === null || deployedVersionRaw === undefined ? null : Number(deployedVersionRaw);
    const deployedHash = (node?.attributes_json?.deployedHash as string | null | undefined) ?? null;
    if (deployedVersion !== target.version || (target.hash && deployedHash !== target.hash)) {
      drifts.push({
        driftKey: `schema.${modelId}.revision`,
        category: "schema",
        severity: "blocking",
        actionClass: environment.kind === "production" ? "approval_required" : "manual_provider_action_required",
        nodeId: node?.id ?? null,
        current: { version: deployedVersion, hash: deployedHash, state: node?.state ?? "missing" },
        desired: target as Record<string, unknown>,
        evidence: { apiKey: target.apiKey ?? null, lastObservedAt: node?.last_observed_at ?? null },
      });
    }
  }

  const runtimeNode = byKey.get("runtime:cms");
  const currentRuntime = runtimeNode?.attributes_json ?? {};
  if (desired.runtime.migration && currentRuntime.schemaMigration !== desired.runtime.migration) {
    drifts.push({
      driftKey: "runtime.migration",
      category: "migration",
      severity: "blocking",
      actionClass: environment.kind === "production" ? "approval_required" : "manual_provider_action_required",
      nodeId: runtimeNode?.id ?? null,
      current: { migration: currentRuntime.schemaMigration ?? null },
      desired: { migration: desired.runtime.migration },
      evidence: { lastObservedAt: runtimeNode?.last_observed_at ?? null },
    });
  }
  if (desired.runtime.appVersion && currentRuntime.appVersion !== desired.runtime.appVersion) {
    drifts.push({
      driftKey: "runtime.app_version",
      category: "runtime",
      severity: "warning",
      actionClass: "manual_provider_action_required",
      nodeId: runtimeNode?.id ?? null,
      current: { appVersion: currentRuntime.appVersion ?? null },
      desired: { appVersion: desired.runtime.appVersion },
      evidence: { lastObservedAt: runtimeNode?.last_observed_at ?? null },
    });
  }
  if (desired.runtime.workerVersion && currentRuntime.workerVersion !== desired.runtime.workerVersion) {
    drifts.push({
      driftKey: "runtime.worker_version",
      category: "worker",
      severity: "warning",
      actionClass: "manual_provider_action_required",
      nodeId: runtimeNode?.id ?? null,
      current: { workerVersion: currentRuntime.workerVersion ?? null },
      desired: { workerVersion: desired.runtime.workerVersion },
      evidence: { lastObservedAt: runtimeNode?.last_observed_at ?? null },
    });
  }

  for (const [bindingId, target] of Object.entries(desired.websites)) {
    const node = byKey.get(`website-binding:${bindingId}`);
    const currentStatus = String(node?.attributes_json?.status ?? "missing");
    if (currentStatus !== target.status) {
      drifts.push({
        driftKey: `website.${bindingId}.status`,
        category: "website",
        severity: "warning",
        actionClass: "recommend",
        nodeId: node?.id ?? null,
        current: { status: currentStatus },
        desired: target as Record<string, unknown>,
        evidence: { lastObservedAt: node?.last_observed_at ?? null },
      });
    }
  }

  return drifts;
}

export async function reconcileOperationalState(params: {
  workspaceId: string;
  environmentId: string;
  actorId: string;
  desiredStateRevisionId?: string | null;
  refreshWorld?: boolean;
}) {
  const db = createServiceRoleClient();
  let discoveryRunId: string | null = null;
  if (params.refreshWorld !== false) {
    const discovery = await refreshOperationalWorldModel({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, source: "controller" });
    discoveryRunId = discovery.run.id;
  }

  const [{ data: environment }, desiredState, world] = await Promise.all([
    db.from("workspace_environments").select("id,kind,status").eq("workspace_id", params.workspaceId).eq("id", params.environmentId).maybeSingle(),
    params.desiredStateRevisionId
      ? db.from("operational_desired_state_revisions").select("*").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("id", params.desiredStateRevisionId).maybeSingle().then((result: any) => result.data)
      : getActiveDesiredState(params.workspaceId, params.environmentId),
    getOperationalWorldModel(params.workspaceId, params.environmentId),
  ]);
  if (!environment) throw Object.assign(new Error("Environment not found"), { status: 404 });
  if (!desiredState) throw Object.assign(new Error("No active desired state exists for this environment"), { status: 409 });
  assertDesiredState(desiredState.desired_json);
  discoveryRunId = discoveryRunId ?? world.latestDiscovery?.id ?? null;

  const { data: run, error: runError } = await db.from("operational_reconciliation_runs").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    desired_state_revision_id: desiredState.id,
    discovery_run_id: discoveryRunId,
    status: "running",
    created_by: params.actorId,
  }).select().single();
  if (runError || !run) throw new Error(runError?.message || "Could not start reconciliation");

  try {
    const drifts = calculateDriftCandidates({ desired: desiredState.desired_json, environment, worldNodes: world.nodes });
    const now = new Date().toISOString();
    if (drifts.length) {
      const rows = drifts.map((drift) => ({
        workspace_id: params.workspaceId,
        environment_id: params.environmentId,
        desired_state_revision_id: desiredState.id,
        reconciliation_run_id: run.id,
        node_id: drift.nodeId ?? null,
        drift_key: drift.driftKey,
        category: drift.category,
        severity: drift.severity,
        action_class: drift.actionClass,
        state: "open",
        current_json: drift.current,
        desired_json: drift.desired,
        evidence_json: drift.evidence ?? {},
        last_seen_at: now,
        resolved_at: null,
      }));
      const { error } = await db.from("operational_drift_items").upsert(rows, { onConflict: "environment_id,desired_state_revision_id,drift_key" });
      if (error) throw new Error(error.message);
    }

    const { data: prior, error: priorError } = await db.from("operational_drift_items")
      .select("id,drift_key,state")
      .eq("workspace_id", params.workspaceId)
      .eq("environment_id", params.environmentId)
      .eq("desired_state_revision_id", desiredState.id)
      .in("state", ["open", "acknowledged", "planned"]);
    if (priorError) throw new Error(priorError.message);
    const currentKeys = new Set(drifts.map((item) => item.driftKey));
    const resolvedIds = (prior ?? []).filter((item) => !currentKeys.has(item.drift_key)).map((item) => item.id);
    for (const id of resolvedIds) {
      const { error } = await db.from("operational_drift_items").update({ state: "resolved", resolved_at: now, last_seen_at: now }).eq("id", id);
      if (error) throw new Error(error.message);
    }

    const blocking = drifts.filter((item) => item.severity === "blocking").length;
    const warnings = drifts.filter((item) => item.severity === "warning").length;
    const manual = drifts.filter((item) => item.actionClass === "manual_provider_action_required").length;
    const approvals = drifts.filter((item) => item.actionClass === "approval_required").length;
    const autoRepairable = drifts.filter((item) => item.actionClass === "safe_auto_repair").length;
    const status = drifts.length === 0 ? "converged" : "drifted";
    const summary = { total: drifts.length, blocking, warnings, manual, approvals, autoRepairable, resolved: resolvedIds.length };
    const { data: completed, error: completeError } = await db.from("operational_reconciliation_runs").update({ status, summary_json: summary, completed_at: now }).eq("id", run.id).select().single();
    if (completeError || !completed) throw new Error(completeError?.message || "Could not complete reconciliation");

    await logPlatformEvent({
      workspaceId: params.workspaceId,
      actorAdminUserId: params.actorId,
      action: "operational.reconciliation.completed",
      entityType: "workspace_environment",
      entityId: params.environmentId,
      metadata: { reconciliationRunId: run.id, desiredStateRevisionId: desiredState.id, discoveryRunId, status, ...summary },
    });
    return { run: completed, drifts, desiredState, discoveryRunId };
  } catch (error) {
    await db.from("operational_reconciliation_runs").update({ status: "failed", summary_json: { error: error instanceof Error ? error.message : "Reconciliation failed" }, completed_at: new Date().toISOString() }).eq("id", run.id);
    throw error;
  }
}

export async function listOperationalDrift(workspaceId: string, environmentId: string) {
  const { data, error } = await createServiceRoleClient().from("operational_drift_items")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("environment_id", environmentId)
    .order("last_seen_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
