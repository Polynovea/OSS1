import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { listOperationalPlans, getAutonomyPolicy } from "@/lib/intelligence/planningService";
import { listDesiredStateRevisions, listOperationalDrift } from "@/lib/intelligence/reconciliationService";
import { getOperationalWorldModel } from "@/lib/intelligence/worldModelService";
import { listDataAwareChangeAssessments } from "@/lib/intelligence/migrationIntelligenceService";
import { listRemediationRegistry } from "@/lib/intelligence/remediationService";
import { listMigrationRuns } from "@/lib/intelligence/migrationStrategyService";
import { listOperationalPlanComparisons } from "@/lib/intelligence/predictivePlanningService";
import { listOperationalMlFeedback } from "@/lib/intelligence/operationalMlGovernanceService";
import { listOperationalMlOverview } from "@/lib/intelligence/operationalMlService";

export async function getOperationalIntelligenceOverview(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const mlPromise = listOperationalMlOverview(workspaceId, environmentId).catch((error) => ({
    available: false,
    status: "unavailable",
    reason: error instanceof Error ? error.message : "Operational ML is unavailable",
    policy: null,
    models: [],
    modelVersions: [],
    predictions: [],
    featureSnapshots: [],
    evaluations: [],
  }));

  const [world, desiredStates, drift, planning, policy, reconciliation, discovery, assessments, remediationRuns, remediationRegistry, events, migrationRuns, planComparisons, mlFeedback, ml] = await Promise.all([
    getOperationalWorldModel(workspaceId, environmentId),
    listDesiredStateRevisions(workspaceId, environmentId),
    listOperationalDrift(workspaceId, environmentId),
    listOperationalPlans(workspaceId, environmentId),
    getAutonomyPolicy(workspaceId, environmentId),
    db.from("operational_reconciliation_runs").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("started_at", { ascending: false }).limit(30),
    db.from("operational_discovery_runs").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("started_at", { ascending: false }).limit(30),
    listDataAwareChangeAssessments(workspaceId, environmentId),
    db.from("operational_remediation_runs").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("started_at", { ascending: false }).limit(50),
    listRemediationRegistry(),
    db.from("operational_events").select("id,event_type,source_type,source_id,occurred_at,features_json,outcome_json,privacy_class,eligible_for_local_learning,eligible_for_cross_install_learning").eq("workspace_id", workspaceId).eq("environment_id", environmentId).order("occurred_at", { ascending: false }).limit(100),
    listMigrationRuns(workspaceId, environmentId),
    listOperationalPlanComparisons(workspaceId, environmentId),
    listOperationalMlFeedback(workspaceId, environmentId).catch(() => []),
    mlPromise,
  ]);

  return {
    world,
    desiredStates,
    activeDesiredState: desiredStates.find((item: any) => item.status === "active") ?? null,
    drift,
    policy,
    reconciliationRuns: reconciliation.data ?? [],
    discoveryRuns: discovery.data ?? [],
    changeAssessments: assessments,
    remediationRuns: remediationRuns.data ?? [],
    remediationRegistry,
    operationalEvents: events.data ?? [],
    migrationRuns,
    planComparisons,
    mlFeedback,
    ml: "available" in ml ? ml : { available: true, status: "available", ...ml },
    ...planning,
  };
}
