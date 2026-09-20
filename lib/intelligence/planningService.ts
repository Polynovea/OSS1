import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { verifyConnection } from "@/lib/infrastructure/connectionService";
import { runComponentAction, runSystemDoctor } from "@/lib/infrastructure/operabilityService";
import { sha256Canonical } from "@/lib/intelligence/operationalCanonical";
import { assessDataAwareSchemaChange } from "@/lib/intelligence/migrationIntelligenceService";
import { deployAssessedCanonicalSchema } from "@/lib/intelligence/schemaDeploymentService";
import { chooseAutomaticMigrationStrategy, executeAssessedMigrationStrategy, migrationStrategyClassification } from "@/lib/intelligence/migrationStrategyService";
import { recordPlanPredictionOutcomes } from "@/lib/intelligence/operationalMlService";
import { refreshOnlineModelEvaluations } from "@/lib/intelligence/operationalMlGovernanceService";
import { buildExecutionDagShape, isSafelyParallelizable, prerequisiteFailureIds, topologicalExecutionOrder as orderExecutionDag } from "@/lib/intelligence/executionDag";
import type {
  OperationalAutonomyMode,
  OperationalDeterministicClassification,
  OperationalPlanDocument,
  OperationalPlanNodeDefinition,
} from "@/lib/intelligence/operationalTypes";
import { getActiveDesiredState, reconcileOperationalState } from "@/lib/intelligence/reconciliationService";
import { getOperationalWorldModel, refreshOperationalWorldModel } from "@/lib/intelligence/worldModelService";
import { logPlatformEvent } from "@/lib/platform/audit";
import { getVersion } from "@/lib/schema/modelService";

const CLASSIFICATION_ORDER: Record<OperationalDeterministicClassification, number> = {
  safe: 0,
  requires_lock: 1,
  requires_backfill: 2,
  requires_data_migration: 3,
  potentially_destructive: 4,
  destructive: 5,
};

function maxClassification(values: OperationalDeterministicClassification[]) {
  return values.reduce<OperationalDeterministicClassification>((highest, current) => CLASSIFICATION_ORDER[current] > CLASSIFICATION_ORDER[highest] ? current : highest, "safe");
}

function classificationForDrift(drift: any): OperationalDeterministicClassification {
  if (drift.category === "schema") return "potentially_destructive";
  if (drift.category === "migration") return "requires_data_migration";
  if (drift.category === "runtime") return "requires_lock";
  return "safe";
}

function operationForDrift(drift: any, worldNode: any): Omit<OperationalPlanNodeDefinition, "ordinal" | "dependsOn"> {
  const classification = classificationForDrift(drift);
  if (drift.drift_key.endsWith(".stale")) {
    return {
      nodeKey: `refresh:${drift.drift_key}`,
      operation: "world.refresh",
      targetType: "workspace_environment",
      targetId: drift.environment_id,
      classification: "safe",
      approvalClass: "none",
      retrySemantics: "safe_retry",
      timeoutSeconds: 120,
      preconditions: [{ type: "environment_exists", environmentId: drift.environment_id }],
      input: { reason: drift.drift_key },
      verification: { postcondition: "observation is fresh" },
      compensation: {},
    };
  }
  if (drift.category === "connection") {
    const connectionId = String(drift.drift_key).split(".")[1] || worldNode?.source_entity_id || null;
    return {
      nodeKey: `connection-verify:${connectionId}`,
      operation: connectionId ? "connection.verify" : "manual.action",
      targetType: "workspace_connection",
      targetId: connectionId,
      classification: "safe",
      approvalClass: "none",
      retrySemantics: connectionId ? "safe_retry" : "manual_retry",
      timeoutSeconds: 120,
      preconditions: [{ type: "connection_exists", connectionId }],
      input: { connectionId },
      verification: { postcondition: "connection.status=active" },
      compensation: {},
    };
  }
  if (drift.category === "capability") {
    const componentId = worldNode?.source_entity_id ?? null;
    return {
      nodeKey: `component-check:${componentId ?? drift.drift_key}`,
      operation: componentId ? "component.check" : "manual.action",
      targetType: "environment_component",
      targetId: componentId,
      classification: "safe",
      approvalClass: "none",
      retrySemantics: componentId ? "safe_retry" : "manual_retry",
      timeoutSeconds: 120,
      preconditions: [{ type: "component_exists", componentId }],
      input: { componentId, driftKey: drift.drift_key },
      verification: { postcondition: "component state is re-observed" },
      compensation: {},
    };
  }
  if (drift.category === "environment") {
    return {
      nodeKey: "system-doctor",
      operation: "system.doctor",
      targetType: "workspace_environment",
      targetId: drift.environment_id,
      classification: "safe",
      approvalClass: "none",
      retrySemantics: "safe_retry",
      timeoutSeconds: 180,
      preconditions: [{ type: "environment_exists", environmentId: drift.environment_id }],
      input: {},
      verification: { postcondition: "fresh system doctor evidence exists" },
      compensation: {},
    };
  }
  return {
    nodeKey: `manual:${drift.drift_key}`,
    operation: "manual.action",
    targetType: drift.category,
    targetId: worldNode?.source_entity_id ?? null,
    classification,
    approvalClass: drift.action_class === "approval_required" ? "high_risk" : "environment",
    retrySemantics: "manual_retry",
    timeoutSeconds: 60,
    preconditions: [{ type: "provider_or_specialized_planner_required", driftKey: drift.drift_key }],
    input: { driftKey: drift.drift_key, current: drift.current_json, desired: drift.desired_json },
    verification: { postcondition: "drift item resolves after provider/specialized planner action" },
    compensation: { note: "No rollback is implied. A specialized deterministic planner must declare compensation before execution." },
  };
}

function dedupeNodes(nodes: OperationalPlanNodeDefinition[]) {
  const byKey = new Map<string, OperationalPlanNodeDefinition>();
  for (const node of nodes) if (!byKey.has(node.nodeKey)) byKey.set(node.nodeKey, node);
  return [...byKey.values()].map((node, index) => ({ ...node, ordinal: index }));
}

export async function getAutonomyPolicy(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const { data: existing, error } = await db.from("operational_autonomy_policies").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).maybeSingle();
  if (error) throw new Error(error.message);
  if (existing) return existing;
  const { data: created, error: createError } = await db.from("operational_autonomy_policies").insert({ workspace_id: workspaceId, environment_id: environmentId, mode: "diagnose_only" }).select().single();
  if (createError || !created) throw new Error(createError?.message || "Could not create operational autonomy policy");
  return created;
}

export async function updateAutonomyPolicy(params: {
  workspaceId: string;
  environmentId: string;
  actorId: string;
  mode: OperationalAutonomyMode;
  allowedRemediationKeys?: string[];
  maxDeterministicClassification?: "safe" | "requires_lock" | "requires_backfill";
  settings?: Record<string, unknown>;
}) {
  const db = createServiceRoleClient();
  const { data: environment } = await db.from("workspace_environments").select("kind").eq("workspace_id", params.workspaceId).eq("id", params.environmentId).maybeSingle();
  if (!environment) throw Object.assign(new Error("Environment not found"), { status: 404 });
  if (environment.kind === "production" && params.mode === "policy_auto_repair" && (params.maxDeterministicClassification ?? "safe") !== "safe") {
    throw Object.assign(new Error("Production policy auto-repair may only cover deterministically SAFE remediations"), { status: 409 });
  }
  const { data, error } = await db.from("operational_autonomy_policies").upsert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    mode: params.mode,
    allowed_remediation_keys: [...new Set(params.allowedRemediationKeys ?? [])],
    max_deterministic_classification: params.maxDeterministicClassification ?? "safe",
    require_approval_for_production: true,
    settings_json: params.settings ?? {},
    updated_by: params.actorId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "environment_id" }).select().single();
  if (error || !data) throw new Error(error?.message || "Could not update autonomy policy");
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "operational.autonomy_policy.updated", entityType: "workspace_environment", entityId: params.environmentId, metadata: { mode: data.mode, maxDeterministicClassification: data.max_deterministic_classification, allowedRemediationKeys: data.allowed_remediation_keys } });
  return data;
}

export async function createOperationalPlan(params: {
  workspaceId: string;
  environmentId: string;
  actorId: string;
  desiredStateRevisionId?: string | null;
  reconciliationRunId?: string | null;
  name?: string | null;
}) {
  const db = createServiceRoleClient();
  const [{ data: environment }, desiredState, world] = await Promise.all([
    db.from("workspace_environments").select("id,kind,status").eq("workspace_id", params.workspaceId).eq("id", params.environmentId).maybeSingle(),
    params.desiredStateRevisionId
      ? db.from("operational_desired_state_revisions").select("*").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("id", params.desiredStateRevisionId).maybeSingle().then((result: any) => result.data)
      : getActiveDesiredState(params.workspaceId, params.environmentId),
    getOperationalWorldModel(params.workspaceId, params.environmentId),
  ]);
  if (!environment) throw Object.assign(new Error("Environment not found"), { status: 404 });
  if (!desiredState) throw Object.assign(new Error("No desired state is available for planning"), { status: 409 });
  if (!world.latestDiscovery) throw Object.assign(new Error("Run operational discovery before planning"), { status: 409 });

  let reconciliationRunId = params.reconciliationRunId ?? null;
  if (!reconciliationRunId) {
    const reconciliation = await reconcileOperationalState({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, desiredStateRevisionId: desiredState.id, refreshWorld: false });
    reconciliationRunId = reconciliation.run.id;
  }

  const [{ data: drifts, error: driftError }, { data: worldNodes, error: nodesError }] = await Promise.all([
    db.from("operational_drift_items").select("*").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("desired_state_revision_id", desiredState.id).in("state", ["open", "acknowledged", "planned"]).order("severity"),
    db.from("operational_world_nodes").select("id,node_key,source_entity_type,source_entity_id,state,provider,attributes_json").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId),
  ]);
  if (driftError) throw new Error(driftError.message);
  if (nodesError) throw new Error(nodesError.message);
  const worldNodeById = new Map((worldNodes ?? []).map((node) => [node.id, node]));

  const actionNodes: OperationalPlanNodeDefinition[] = [];
  for (const drift of drifts ?? []) {
    if (drift.category === "schema") {
      const modelId = String(drift.drift_key).split(".")[1] || null;
      const desiredVersion = Number(drift.desired_json?.version ?? 0);
      if (modelId && desiredVersion > 0) {
        const canonicalVersion = await getVersion(modelId, desiredVersion);
        if (canonicalVersion) {
          try {
            const assessed = await assessDataAwareSchemaChange({
              workspaceId: params.workspaceId,
              environmentId: params.environmentId,
              modelId,
              actorId: params.actorId,
              proposedSchema: canonicalVersion.schema_json,
            });
            const analysis = assessed.analysis;
            const automaticStrategy = chooseAutomaticMigrationStrategy(assessed.assessment, canonicalVersion.schema_json);
            const directDeploy = automaticStrategy?.strategyKey === "direct_metadata_change";
            const automatedMigration = Boolean(automaticStrategy && automaticStrategy.strategyKey !== "direct_metadata_change");
            const nodeClassification = directDeploy
              ? analysis.deterministicClassification
              : automatedMigration && automaticStrategy
                ? migrationStrategyClassification(automaticStrategy.strategyKey, assessed.assessment)
                : analysis.deterministicClassification;
            actionNodes.push({
              nodeKey: directDeploy
                ? `schema-deploy:${modelId}:v${desiredVersion}`
                : automatedMigration && automaticStrategy
                  ? `schema-migrate:${automaticStrategy.strategyKey}:${modelId}:v${desiredVersion}`
                  : `schema-review:${modelId}:v${desiredVersion}`,
              ordinal: actionNodes.length,
              operation: directDeploy ? "schema.deploy_assessed" : automatedMigration ? "schema.migrate_assessed" : "manual.action",
              targetType: "content_model",
              targetId: modelId,
              classification: nodeClassification,
              approvalClass: environment.kind === "production" || nodeClassification !== "safe" ? "high_risk" : "environment",
              retrySemantics: directDeploy || automatedMigration ? "safe_retry" : "manual_retry",
              timeoutSeconds: automatedMigration ? 600 : 180,
              preconditions: [
                { type: "assessment_fresh", assessmentId: assessed.assessment.id, maxAgeSeconds: 900 },
                { type: "canonical_schema_version", modelId, version: desiredVersion, schemaHash: canonicalVersion.schema_hash },
              ],
              input: {
                assessmentId: assessed.assessment.id,
                modelId,
                schemaVersion: desiredVersion,
                schemaHash: canonicalVersion.schema_hash,
                alternatives: analysis.alternatives,
                migrationStrategy: automaticStrategy?.strategyKey ?? null,
                migrationInput: automaticStrategy?.input ?? {},
                automaticStrategyReason: automaticStrategy?.reason ?? null,
                directDeployBlocked: !directDeploy,
              },
              verification: { postcondition: `environment schema deployment for ${modelId} equals v${desiredVersion} and drift resolves` },
              compensation: directDeploy
                ? { type: "metadata_reconcile", note: "No raw content values are mutated by direct canonical deployment." }
                : automaticStrategy?.strategyKey === "deprecate_retain"
                  ? { type: "schema_reintroduce", note: "Removed field payload values are retained; reintroducing the field schema reverses authoring visibility." }
                  : automatedMigration
                    ? { type: "version_history", note: "Backfill/transform creates new immutable content versions; source versions remain available for governed restoration." }
                    : { note: "Explicit migration/backfill strategy required before execution." },
              dependsOn: [],
            });
            continue;
          } catch (cause) {
            actionNodes.push({
              nodeKey: `schema-assessment-required:${modelId}:v${desiredVersion}`,
              ordinal: actionNodes.length,
              operation: "manual.action",
              targetType: "content_model",
              targetId: modelId,
              classification: "requires_data_migration",
              approvalClass: environment.kind === "production" ? "high_risk" : "environment",
              retrySemantics: "manual_retry",
              timeoutSeconds: 60,
              preconditions: [{ type: "data_aware_assessment_required", modelId, version: desiredVersion }],
              input: { modelId, schemaVersion: desiredVersion, assessmentError: cause instanceof Error ? cause.message : "Data-aware assessment unavailable" },
              verification: { postcondition: "fresh data-aware assessment exists before schema execution" },
              compensation: { note: "No schema execution occurs until target-data assessment succeeds." },
              dependsOn: [],
            });
            continue;
          }
        }
      }
    }
    actionNodes.push({ ...operationForDrift(drift, drift.node_id ? worldNodeById.get(drift.node_id) : null), ordinal: actionNodes.length, dependsOn: [] });
  }
  const actionKeys = [...new Set(actionNodes.map((node) => node.nodeKey))];
  const verificationNodes: OperationalPlanNodeDefinition[] = [
    {
      nodeKey: "verify:world-refresh",
      ordinal: actionNodes.length,
      operation: "world.refresh",
      targetType: "workspace_environment",
      targetId: params.environmentId,
      classification: "safe",
      approvalClass: "none",
      retrySemantics: "safe_retry",
      timeoutSeconds: 180,
      preconditions: [],
      input: { verification: true },
      verification: { postcondition: "world model refreshed after actions" },
      compensation: {},
      dependsOn: actionKeys,
    },
    {
      nodeKey: "verify:reconcile",
      ordinal: actionNodes.length + 1,
      operation: "drift.recalculate",
      targetType: "workspace_environment",
      targetId: params.environmentId,
      classification: "safe",
      approvalClass: "none",
      retrySemantics: "safe_retry",
      timeoutSeconds: 180,
      preconditions: [],
      input: { desiredStateRevisionId: desiredState.id },
      verification: { postcondition: "post-action drift is independently recalculated" },
      compensation: {},
      dependsOn: ["verify:world-refresh"],
    },
  ];
  const nodes = dedupeNodes([...actionNodes, ...verificationNodes]).map((node, index) => ({ ...node, ordinal: index }));
  const classification = maxClassification(nodes.map((node) => node.classification));
  const requiresApproval = (drifts ?? []).some((drift) => drift.action_class === "approval_required") || (environment.kind === "production" && classification !== "safe");
  const createdAt = new Date().toISOString();
  const planDocument: OperationalPlanDocument = {
    format: "polynovea-operational-plan",
    formatVersion: 1,
    environmentId: params.environmentId,
    desiredStateRevisionId: desiredState.id,
    sourceDiscoveryRunId: world.latestDiscovery.id,
    sourceReconciliationRunId: reconciliationRunId,
    classification,
    requiresApproval,
    createdAt,
    nodes,
  };
  const checksum = sha256Canonical(planDocument);

  const { data: existing, error: existingError } = await db.from("operational_change_plans").select("*").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("plan_checksum_sha256", checksum).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return getOperationalPlan(params.workspaceId, existing.id);

  const { data: plan, error: planError } = await db.from("operational_change_plans").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    desired_state_revision_id: desiredState.id,
    source_reconciliation_run_id: reconciliationRunId,
    source_discovery_run_id: world.latestDiscovery.id,
    name: params.name?.trim() || `Reconcile ${environment.kind} environment`,
    status: "planned",
    deterministic_classification: classification,
    requires_approval: requiresApproval,
    immutable_plan_json: planDocument,
    plan_checksum_sha256: checksum,
    created_by: params.actorId,
    created_at: createdAt,
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }).select().single();
  if (planError || !plan) throw new Error(planError?.message || "Could not persist operational plan");

  const persistedNodeRows = nodes.map((node) => ({
    plan_id: plan.id,
    node_key: node.nodeKey,
    ordinal: node.ordinal,
    operation: node.operation,
    target_type: node.targetType,
    target_id: node.targetId ?? null,
    deterministic_classification: node.classification,
    approval_class: node.approvalClass,
    retry_semantics: node.retrySemantics,
    idempotency_key: `${checksum}:${node.nodeKey}`,
    timeout_seconds: node.timeoutSeconds,
    preconditions_json: node.preconditions,
    input_json: node.input,
    verification_json: node.verification,
    compensation_json: node.compensation,
  }));
  const { data: persistedNodes, error: persistedNodesError } = await db.from("operational_change_plan_nodes").insert(persistedNodeRows).select("id,node_key");
  if (persistedNodesError) throw new Error(persistedNodesError.message);
  const idByKey = new Map((persistedNodes ?? []).map((node) => [node.node_key, node.id]));
  const edgeRows = nodes.flatMap((node) => node.dependsOn.map((dependencyKey) => ({ plan_id: plan.id, from_node_id: idByKey.get(dependencyKey), to_node_id: idByKey.get(node.nodeKey), edge_kind: "depends_on" }))).filter((edge) => edge.from_node_id && edge.to_node_id);
  if (edgeRows.length) {
    const { error } = await db.from("operational_change_plan_edges").insert(edgeRows);
    if (error) throw new Error(error.message);
  }
  if ((drifts ?? []).length) await db.from("operational_drift_items").update({ state: "planned" }).eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("desired_state_revision_id", desiredState.id).in("state", ["open", "acknowledged"]);

  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "operational.plan.created", entityType: "operational_change_plan", entityId: plan.id, metadata: { environmentId: params.environmentId, checksum, classification, requiresApproval, nodeCount: nodes.length, driftCount: (drifts ?? []).length } });
  return getOperationalPlan(params.workspaceId, plan.id);
}

export async function getOperationalPlan(workspaceId: string, planId: string) {
  const db = createServiceRoleClient();
  const [{ data: plan, error: planError }, { data: nodes, error: nodesError }, { data: edges, error: edgesError }] = await Promise.all([
    db.from("operational_change_plans").select("*").eq("workspace_id", workspaceId).eq("id", planId).maybeSingle(),
    db.from("operational_change_plan_nodes").select("*").eq("plan_id", planId).order("ordinal"),
    db.from("operational_change_plan_edges").select("*").eq("plan_id", planId),
  ]);
  if (planError) throw new Error(planError.message);
  if (nodesError) throw new Error(nodesError.message);
  if (edgesError) throw new Error(edgesError.message);
  if (!plan) throw Object.assign(new Error("Operational plan not found"), { status: 404 });
  return { plan, nodes: nodes ?? [], edges: edges ?? [] };
}

async function findApprovedPlanRequest(workspaceId: string, environmentId: string, planId: string, requestId?: string | null) {
  const db = createServiceRoleClient();
  let query = db.from("infrastructure_approval_requests").select("id,status,expires_at,reviewed_at").eq("workspace_id", workspaceId).eq("environment_id", environmentId).eq("operation", "change_execute").eq("entity_id", planId).eq("status", "approved");
  if (requestId) query = query.eq("id", requestId);
  const { data, error } = await query.order("reviewed_at", { ascending: false }).limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []).find((row) => !row.expires_at || new Date(row.expires_at) > new Date()) ?? null;
}

export async function simulateOperationalPlan(params: { workspaceId: string; environmentId: string; actorId: string; planId: string; approvalRequestId?: string | null }) {
  const db = createServiceRoleClient();
  const { plan, nodes } = await getOperationalPlan(params.workspaceId, params.planId);
  if (plan.environment_id !== params.environmentId) throw Object.assign(new Error("Plan belongs to a different environment"), { status: 409 });
  const [{ data: latestDiscovery }, activeDesired, policy] = await Promise.all([
    db.from("operational_discovery_runs").select("id,started_at,status").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("status", "succeeded").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    getActiveDesiredState(params.workspaceId, params.environmentId),
    getAutonomyPolicy(params.workspaceId, params.environmentId),
  ]);
  const blockers: Array<Record<string, unknown>> = [];
  const warnings: Array<Record<string, unknown>> = [];
  if (plan.expires_at && new Date(plan.expires_at) <= new Date()) blockers.push({ code: "PLAN_EXPIRED", message: "Plan freshness window has expired. Reconcile and plan again." });
  if (latestDiscovery?.id && plan.source_discovery_run_id && latestDiscovery.id !== plan.source_discovery_run_id) blockers.push({ code: "WORLD_MODEL_CHANGED", message: "A newer discovery run exists. Immutable plan must be regenerated against current evidence.", sourceDiscoveryRunId: plan.source_discovery_run_id, latestDiscoveryRunId: latestDiscovery.id });
  if (!activeDesired || activeDesired.id !== plan.desired_state_revision_id) blockers.push({ code: "DESIRED_STATE_CHANGED", message: "Plan does not target the currently active desired-state revision." });
  for (const node of nodes) if (node.operation === "manual.action") blockers.push({ code: "SPECIALIZED_PLANNER_REQUIRED", nodeKey: node.node_key, targetType: node.target_type, message: "This drift requires a provider/specialized deterministic planner before execution can be automated." });
  for (const node of nodes.filter((item) => item.operation === "schema.deploy_assessed")) {
    const assessmentId = String(node.input_json?.assessmentId ?? "");
    if (!assessmentId) {
      blockers.push({ code: "SCHEMA_ASSESSMENT_MISSING", nodeKey: node.node_key, message: "Schema deployment node is missing its target-data assessment." });
      continue;
    }
    const { data: assessment } = await db.from("operational_change_assessments").select("id,status,deterministic_classification,hard_blockers_json,warnings_json,created_at,proposed_schema_hash").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("id", assessmentId).maybeSingle();
    if (!assessment) blockers.push({ code: "SCHEMA_ASSESSMENT_NOT_FOUND", nodeKey: node.node_key, assessmentId });
    else if (Date.now() - new Date(assessment.created_at).getTime() > 15 * 60 * 1000) blockers.push({ code: "SCHEMA_ASSESSMENT_STALE", nodeKey: node.node_key, assessmentId, message: "Target-data evidence is older than the 15-minute execution freshness window." });
    else if (assessment.status === "blocked" || (Array.isArray(assessment.hard_blockers_json) && assessment.hard_blockers_json.length)) blockers.push({ code: "SCHEMA_DATA_BLOCKERS", nodeKey: node.node_key, assessmentId, blockers: assessment.hard_blockers_json });
    else if (assessment.proposed_schema_hash !== node.input_json?.schemaHash) blockers.push({ code: "SCHEMA_ASSESSMENT_HASH_MISMATCH", nodeKey: node.node_key, assessmentId });
    if (assessment && Array.isArray(assessment.warnings_json) && assessment.warnings_json.length) warnings.push({ code: "SCHEMA_ASSESSMENT_WARNINGS", nodeKey: node.node_key, assessmentId, warnings: assessment.warnings_json });
  }
  for (const node of nodes.filter((item) => item.operation === "schema.migrate_assessed")) {
    const assessmentId = String(node.input_json?.assessmentId ?? "");
    const modelId = String(node.input_json?.modelId ?? node.target_id ?? "");
    const schemaVersion = Number(node.input_json?.schemaVersion ?? 0);
    const strategyKey = String(node.input_json?.migrationStrategy ?? "");
    if (!assessmentId || !modelId || !schemaVersion || !strategyKey) {
      blockers.push({ code: "MIGRATION_PLAN_INPUT_MISSING", nodeKey: node.node_key, message: "Assessed migration node is missing assessment/model/version/strategy input." });
      continue;
    }
    const [{ data: assessment }, canonicalVersion] = await Promise.all([
      db.from("operational_change_assessments").select("*").eq("workspace_id", params.workspaceId).eq("environment_id", params.environmentId).eq("id", assessmentId).maybeSingle(),
      getVersion(modelId, schemaVersion),
    ]);
    if (!assessment) { blockers.push({ code: "MIGRATION_ASSESSMENT_NOT_FOUND", nodeKey: node.node_key, assessmentId }); continue; }
    if (!canonicalVersion) { blockers.push({ code: "MIGRATION_TARGET_SCHEMA_NOT_FOUND", nodeKey: node.node_key, modelId, schemaVersion }); continue; }
    if (Date.now() - new Date(assessment.created_at).getTime() > 15 * 60 * 1000) { blockers.push({ code: "MIGRATION_ASSESSMENT_STALE", nodeKey: node.node_key, assessmentId }); continue; }
    if (String(assessment.target_schema_hash ?? assessment.proposed_schema_hash) !== String(node.input_json?.schemaHash ?? "")) { blockers.push({ code: "MIGRATION_TARGET_HASH_MISMATCH", nodeKey: node.node_key, assessmentId }); continue; }
    const automatic = chooseAutomaticMigrationStrategy(assessment, canonicalVersion.schema_json);
    if (!automatic || automatic.strategyKey !== strategyKey) {
      blockers.push({ code: "MIGRATION_STRATEGY_NO_LONGER_VALID", nodeKey: node.node_key, assessmentId, strategyKey, message: "Fresh target evidence no longer supports the immutable automatic migration strategy." });
      continue;
    }
    const handled = Array.isArray(assessment.hard_blockers_json) ? assessment.hard_blockers_json : [];
    if (handled.length) warnings.push({ code: "MIGRATION_STRATEGY_HANDLES_DATA_BLOCKERS", nodeKey: node.node_key, strategyKey, blockers: handled });
    if (Array.isArray(assessment.warnings_json) && assessment.warnings_json.length) warnings.push({ code: "MIGRATION_ASSESSMENT_WARNINGS", nodeKey: node.node_key, assessmentId, warnings: assessment.warnings_json });
  }
  let approval = null;
  if (plan.requires_approval) {
    approval = await findApprovedPlanRequest(params.workspaceId, params.environmentId, plan.id, params.approvalRequestId);
    if (!approval) blockers.push({ code: "APPROVAL_REQUIRED", message: "This immutable plan requires an approved change_execute request before execution." });
  }
  if (plan.deterministic_classification !== "safe") warnings.push({ code: "NON_SAFE_CLASSIFICATION", classification: plan.deterministic_classification, message: "Deterministic classification is authoritative regardless of any future ML prediction." });
  if (policy.mode === "diagnose_only") warnings.push({ code: "AUTONOMY_DIAGNOSE_ONLY", message: "Autonomous execution is disabled. Human execution remains subject to permissions and approvals." });
  const rollbackCovered = nodes.filter((node) => node.compensation_json && Object.keys(node.compensation_json).length > 0).length;
  const irreversible = nodes.filter((node) => ["potentially_destructive", "destructive", "requires_data_migration"].includes(node.deterministic_classification) && (!node.compensation_json || Object.keys(node.compensation_json).length === 0)).map((node) => node.node_key);
  if (irreversible.length) warnings.push({ code: "ROLLBACK_COVERAGE_INCOMPLETE", nodes: irreversible });
  const status = blockers.length ? "blocked" : warnings.length ? "warning" : "passed";
  const correlationId = randomUUID();
  const result = {
    planId: plan.id,
    planChecksum: plan.plan_checksum_sha256,
    sourceDiscoveryRunId: plan.source_discovery_run_id,
    desiredStateRevisionId: plan.desired_state_revision_id,
    classification: plan.deterministic_classification,
    nodeCount: nodes.length,
    manualNodeCount: nodes.filter((node) => node.operation === "manual.action").length,
    rollbackCoverage: { coveredNodes: rollbackCovered, totalNodes: nodes.length, explicitlyUncoveredHighRiskNodes: irreversible },
    policy: { mode: policy.mode, maxDeterministicClassification: policy.max_deterministic_classification },
  };
  const { data: simulation, error } = await db.from("operational_simulation_runs").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    plan_id: plan.id,
    status,
    hard_blockers_json: blockers,
    warnings_json: warnings,
    side_effects_json: nodes.map((node) => ({ nodeKey: node.node_key, operation: node.operation, targetType: node.target_type, targetId: node.target_id, classification: node.deterministic_classification })),
    approval_json: { required: plan.requires_approval, approvalRequestId: approval?.id ?? null },
    rollback_coverage_json: result.rollbackCoverage,
    result_json: result,
    correlation_id: correlationId,
    created_by: params.actorId,
    completed_at: new Date().toISOString(),
  }).select().single();
  if (error || !simulation) throw new Error(error?.message || "Could not persist operational simulation");
  await db.from("operational_change_plans").update({ status: blockers.length ? "reviewed" : approval ? "approved" : "reviewed", reviewed_at: new Date().toISOString() }).eq("id", plan.id);
  return simulation;
}

export function topologicalExecutionOrder<T extends { id: string; node_key: string; ordinal: number }>(nodes: T[], edges: Array<{ from_node_id: string; to_node_id: string }>): T[] {
  return orderExecutionDag(nodes, edges);
}

function safeResult(operation: string, value: any): Record<string, unknown> {
  if (operation === "world.refresh") return { discoveryRunId: value?.run?.id ?? null, status: value?.run?.status ?? null, summary: value?.summary ?? {} };
  if (operation === "drift.recalculate") return { reconciliationRunId: value?.run?.id ?? null, status: value?.run?.status ?? null, summary: value?.run?.summary_json ?? {}, driftCount: value?.drifts?.length ?? 0 };
  if (operation === "system.doctor") return { doctorRunId: value?.id ?? null, status: value?.status ?? null, summary: value?.summary_json ?? {} };
  if (operation === "component.check") return { componentRunId: value?.id ?? null, status: value?.status ?? null, result: value?.result_json ?? {} };
  if (operation === "connection.verify") return { verificationRunId: value?.id ?? value?.latestVerification?.id ?? null, status: value?.status ?? value?.latestVerification?.status ?? null };
  if (operation === "schema.deploy_assessed") return { deploymentId: value?.deployment?.id ?? null, assessmentId: value?.assessmentId ?? null, schemaVersion: value?.schemaVersion ?? null, schemaHash: value?.schemaHash ?? null, deterministicClassification: value?.deterministicClassification ?? null, status: "deployed" };
  if (operation === "schema.migrate_assessed") return { migrationRunId: value?.run?.id ?? null, migrationStatus: value?.run?.status ?? null, progress: value?.run?.progress_json ?? {}, deploymentId: value?.verification?.deployment?.deployment?.id ?? value?.deployment?.deployment?.id ?? null, status: value?.run?.status ?? "unknown" };
  return { status: "completed" };
}

async function executePlanNode(params: { workspaceId: string; environmentId: string; actorId: string; desiredStateRevisionId: string; node: any }) {
  const operation = String(params.node.operation);
  if (operation === "world.refresh") return refreshOperationalWorldModel({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, source: "controller" });
  if (operation === "drift.recalculate") return reconcileOperationalState({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, desiredStateRevisionId: params.desiredStateRevisionId, refreshWorld: false });
  if (operation === "system.doctor") return runSystemDoctor({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId });
  if (operation === "component.check") {
    if (!params.node.target_id) throw Object.assign(new Error("Component check is missing target component"), { status: 409 });
    return runComponentAction({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, componentId: params.node.target_id, operation: "check" });
  }
  if (operation === "connection.verify") {
    if (!params.node.target_id) throw Object.assign(new Error("Connection verification is missing target connection"), { status: 409 });
    return verifyConnection({ workspaceId: params.workspaceId, actorId: params.actorId, connectionId: params.node.target_id });
  }
  if (operation === "schema.deploy_assessed") {
    const modelId = String(params.node.input_json?.modelId ?? params.node.target_id ?? "");
    const assessmentId = String(params.node.input_json?.assessmentId ?? "");
    if (!modelId || !assessmentId) throw Object.assign(new Error("Assessed schema deployment is missing modelId or assessmentId"), { status: 409 });
    return deployAssessedCanonicalSchema({ workspaceId: params.workspaceId, environmentId: params.environmentId, modelId, actorId: params.actorId, assessmentId });
  }
  if (operation === "schema.migrate_assessed") {
    const assessmentId = String(params.node.input_json?.assessmentId ?? "");
    const strategyKey = String(params.node.input_json?.migrationStrategy ?? "") as any;
    if (!assessmentId || !strategyKey) throw Object.assign(new Error("Assessed schema migration is missing assessmentId or migrationStrategy"), { status: 409 });
    const result = await executeAssessedMigrationStrategy({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, assessmentId, strategyKey, input: params.node.input_json?.migrationInput ?? {}, maxBatches: 100 });
    if (result.resumeRequired) throw Object.assign(new Error("Resumable migration reached the bounded execution cap and must be resumed before reconciliation can complete"), { status: 409, migrationRunId: result.run?.id });
    return result;
  }
  throw Object.assign(new Error(`Operation ${operation} is not executable by the deterministic controller yet`), { status: 409 });
}

export async function executeOperationalPlan(params: { workspaceId: string; environmentId: string; actorId: string; planId: string; approvalRequestId?: string | null }) {
  const db = createServiceRoleClient();
  const graph = await getOperationalPlan(params.workspaceId, params.planId);
  const plan = graph.plan;
  if (plan.environment_id !== params.environmentId) throw Object.assign(new Error("Plan belongs to a different environment"), { status: 409 });
  const simulation = await simulateOperationalPlan({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, planId: params.planId, approvalRequestId: params.approvalRequestId });
  const approvalRequestId = plan.requires_approval ? (simulation.approval_json?.approvalRequestId ?? params.approvalRequestId ?? null) : null;

  if (simulation.status === "blocked") {
    const { data: blocked, error } = await db.from("operational_execution_runs").insert({ workspace_id: params.workspaceId, environment_id: params.environmentId, plan_id: plan.id, simulation_run_id: simulation.id, approval_request_id: approvalRequestId, status: "blocked", started_by: params.actorId, completed_at: new Date().toISOString(), result_json: { blockers: simulation.hard_blockers_json } }).select().single();
    if (error || !blocked) throw new Error(error?.message || "Could not record blocked execution");
    return { execution: blocked, simulation, evidencePackage: null };
  }

  const immutableChecksum = sha256Canonical(plan.immutable_plan_json);
  if (immutableChecksum !== plan.plan_checksum_sha256) throw Object.assign(new Error("Immutable plan checksum verification failed"), { status: 409 });
  const dag = buildExecutionDagShape(graph.nodes, graph.edges);
  const ordered = dag.ordered;
  const correlationId = randomUUID();
  const { data: execution, error: executionError } = await db.from("operational_execution_runs").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    plan_id: plan.id,
    simulation_run_id: simulation.id,
    approval_request_id: approvalRequestId,
    status: "running",
    correlation_id: correlationId,
    started_by: params.actorId,
  }).select().single();
  if (executionError || !execution) throw new Error(executionError?.message || "Could not start operational execution");
  await db.from("operational_change_plans").update({ status: "executing" }).eq("id", plan.id);

  const pendingRows = ordered.map((node) => ({ execution_run_id: execution.id, plan_node_id: node.id, status: "pending", safe_input_json: node.input_json ?? {} }));
  const { error: pendingError } = await db.from("operational_execution_node_runs").insert(pendingRows);
  if (pendingError) throw new Error(pendingError.message);

  const nodeResults: Array<Record<string, unknown>> = [];
  const nodeStatuses = new Map<string, string>();
  const failures: Error[] = [];

  const runNode = async (node: any) => {
    const failedPrerequisites = prerequisiteFailureIds(node.id, dag.prerequisitesByNodeId, nodeStatuses);
    if (failedPrerequisites.length) {
      nodeStatuses.set(node.id, "blocked");
      nodeResults.push({ nodeKey: node.node_key, operation: node.operation, status: "blocked", failedPrerequisiteIds: failedPrerequisites });
      await db.from("operational_execution_node_runs").update({ status: "blocked", error_code: "DEPENDENCY_FAILED", error_message: "A prerequisite execution node failed or was blocked", completed_at: new Date().toISOString() }).eq("execution_run_id", execution.id).eq("plan_node_id", node.id).eq("status", "pending");
      return;
    }

    await db.from("operational_execution_node_runs").update({ status: "running", attempt: 1, started_at: new Date().toISOString() }).eq("execution_run_id", execution.id).eq("plan_node_id", node.id);
    try {
      const raw = await executePlanNode({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, desiredStateRevisionId: plan.desired_state_revision_id, node });
      const result = safeResult(node.operation, raw);
      nodeStatuses.set(node.id, "succeeded");
      nodeResults.push({ nodeKey: node.node_key, operation: node.operation, result });
      await db.from("operational_execution_node_runs").update({ status: "succeeded", safe_result_json: result, verification_json: node.verification_json ?? {}, completed_at: new Date().toISOString() }).eq("execution_run_id", execution.id).eq("plan_node_id", node.id);
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error("Operational execution node failed");
      failures.push(failure);
      nodeStatuses.set(node.id, "failed");
      nodeResults.push({ nodeKey: node.node_key, operation: node.operation, error: failure.message });
      await db.from("operational_execution_node_runs").update({ status: "failed", error_code: "NODE_EXECUTION_FAILED", error_message: failure.message.slice(0, 2000), completed_at: new Date().toISOString() }).eq("execution_run_id", execution.id).eq("plan_node_id", node.id);
    }
  };

  for (const level of dag.levels) {
    const parallel = level.filter(isSafelyParallelizable);
    const serial = level.filter((node) => !isSafelyParallelizable(node));
    if (parallel.length) await Promise.all(parallel.map(runNode));
    for (const node of serial) await runNode(node);
  }

  let failure = failures[0] ?? null;

  let postDiscovery: any = null;
  let postReconciliation: any = null;
  try {
    postDiscovery = await refreshOperationalWorldModel({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, source: "controller" });
    postReconciliation = await reconcileOperationalState({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, desiredStateRevisionId: plan.desired_state_revision_id, refreshWorld: false });
  } catch (cause) {
    if (!failure) failure = cause instanceof Error ? cause : new Error("Postcondition verification failed");
  }

  const remainingDrifts = postReconciliation?.drifts ?? [];
  const finalStatus = failure ? "failed" : remainingDrifts.length ? "partial" : "succeeded";
  const completedAt = new Date().toISOString();
  const resultJson = { planChecksum: plan.plan_checksum_sha256, nodeResults, remainingDriftCount: remainingDrifts.length, verifiedConvergence: finalStatus === "succeeded", failure: failure?.message ?? null };
  const { data: completedExecution, error: completeError } = await db.from("operational_execution_runs").update({ status: finalStatus, completed_at: completedAt, result_json: resultJson }).eq("id", execution.id).select().single();
  if (completeError || !completedExecution) throw new Error(completeError?.message || "Could not finalize operational execution");
  await db.from("operational_change_plans").update({ status: finalStatus }).eq("id", plan.id);
  if (approvalRequestId && finalStatus !== "failed") await db.from("infrastructure_approval_requests").update({ status: "executed", executed_at: completedAt, updated_at: completedAt }).eq("workspace_id", params.workspaceId).eq("id", approvalRequestId).eq("status", "approved");

  const packageDocument = {
    format: "polynovea-operational-proof",
    formatVersion: 1,
    execution: { id: completedExecution.id, correlationId, status: finalStatus, startedAt: completedExecution.started_at, completedAt },
    actorId: params.actorId,
    environmentId: params.environmentId,
    desiredStateRevisionId: plan.desired_state_revision_id,
    immutablePlan: { id: plan.id, checksum: plan.plan_checksum_sha256, classification: plan.deterministic_classification, requiresApproval: plan.requires_approval },
    simulation: { id: simulation.id, status: simulation.status, blockers: simulation.hard_blockers_json, warnings: simulation.warnings_json, rollbackCoverage: simulation.rollback_coverage_json },
    approvalRequestId,
    preDiscoveryRunId: plan.source_discovery_run_id,
    postDiscoveryRunId: postDiscovery?.run?.id ?? null,
    postReconciliationRunId: postReconciliation?.run?.id ?? null,
    actualEffects: nodeResults,
    verification: { remainingDriftCount: remainingDrifts.length, converged: finalStatus === "succeeded", reconciliationSummary: postReconciliation?.run?.summary_json ?? null },
    generatedAt: completedAt,
    security: "No credential values or secret payloads are included in this proof package.",
  };
  const evidenceChecksum = sha256Canonical(packageDocument);
  const { data: evidencePackage, error: evidenceError } = await db.from("operational_evidence_packages").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    execution_run_id: completedExecution.id,
    plan_id: plan.id,
    desired_state_revision_id: plan.desired_state_revision_id,
    pre_discovery_run_id: plan.source_discovery_run_id,
    post_discovery_run_id: postDiscovery?.run?.id ?? null,
    post_reconciliation_run_id: postReconciliation?.run?.id ?? null,
    package_json: packageDocument,
    checksum_sha256: evidenceChecksum,
  }).select().single();
  if (evidenceError || !evidencePackage) throw new Error(evidenceError?.message || "Could not persist proof package");

  const startedAtMs = new Date(completedExecution.started_at).getTime();
  const completedAtMs = new Date(completedAt).getTime();
  const durationMs = Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs) ? Math.max(0, completedAtMs - startedAtMs) : null;
  await db.from("operational_events").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    event_type: "plan.execution",
    source_type: "operational_execution_run",
    source_id: completedExecution.id,
    correlation_id: correlationId,
    occurred_at: completedAt,
    features_json: { deterministicClassification: plan.deterministic_classification, nodeCount: graph.nodes.length, requiresApproval: plan.requires_approval, simulationStatus: simulation.status, warningCount: Array.isArray(simulation.warnings_json) ? simulation.warnings_json.length : 0 },
    outcome_json: { status: finalStatus, durationMs, remainingDriftCount: remainingDrifts.length, downstreamImpactCount: new Set(remainingDrifts.map((item: any) => item.node_id).filter(Boolean)).size || remainingDrifts.length, impactedCategories: [...new Set(remainingDrifts.map((item: any) => String(item.category ?? "other")))], failedNodeCount: nodeResults.filter((item: any) => item.error).length, converged: finalStatus === "succeeded", failed: finalStatus === "failed" },
    privacy_class: "operational_minimized",
    eligible_for_local_learning: true,
    eligible_for_cross_install_learning: false,
  });

  await recordPlanPredictionOutcomes({ workspaceId: params.workspaceId, environmentId: params.environmentId, planId: plan.id, executionRunId: completedExecution.id, status: finalStatus, durationMs, downstreamImpactCount: new Set(remainingDrifts.map((item: any) => item.node_id).filter(Boolean)).size || remainingDrifts.length, observedAt: completedAt });
  await refreshOnlineModelEvaluations(params.workspaceId, params.environmentId).catch(() => ({ evaluations: [] }));

  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "operational.plan.executed", entityType: "operational_change_plan", entityId: plan.id, metadata: { executionRunId: completedExecution.id, evidencePackageId: evidencePackage.id, correlationId, status: finalStatus, remainingDriftCount: remainingDrifts.length } });
  return { execution: completedExecution, simulation, evidencePackage, postReconciliation };
}

export async function listOperationalPlans(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const [plans, simulations, executions, evidence] = await Promise.all([
    db.from("operational_change_plans").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("created_at", { ascending: false }).limit(50),
    db.from("operational_simulation_runs").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("started_at", { ascending: false }).limit(50),
    db.from("operational_execution_runs").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("started_at", { ascending: false }).limit(50),
    db.from("operational_evidence_packages").select("id,execution_run_id,plan_id,checksum_sha256,created_at,package_json").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("created_at", { ascending: false }).limit(50),
  ]);
  return { plans: plans.data ?? [], simulations: simulations.data ?? [], executions: executions.data ?? [], evidencePackages: evidence.data ?? [] };
}
