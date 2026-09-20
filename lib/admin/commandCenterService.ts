import { createServiceRoleClient } from "@/lib/admin/serviceRole";

interface AttentionItem {
  key: string;
  severity: "blocking" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
  count: number;
}

async function countRows(
  db: ReturnType<typeof createServiceRoleClient>,
  table: string,
  workspaceId: string,
  apply?: (query: any) => any,
) {
  let query: any = db.from(table).select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

export async function getCommandCenterSnapshot(workspaceId: string, actorId: string) {
  const db = createServiceRoleClient();

  const [
    models,
    entries,
    draftEntries,
    reviewEntries,
    approvedEntries,
    scheduledEntries,
    publishedEntries,
    assets,
    releasesOpen,
    releasesScheduled,
    releasesFailed,
    jobsQueued,
    jobsRunning,
    jobsDead,
    findingsOpen,
    findingsBlocking,
    findingsWarning,
    assignmentsActive,
    approvalsPending,
    environmentsTotal,
    environmentsReady,
    environmentsProblem,
    connectionsTotal,
    connectionsActive,
    connectionsProblem,
    analyticsProblems,
  ] = await Promise.all([
    countRows(db, "content_models", workspaceId, (q) => q.eq("status", "active")),
    countRows(db, "content_entries", workspaceId, (q) => q.neq("status", "archived")),
    countRows(db, "content_entries", workspaceId, (q) => q.eq("status", "draft")),
    countRows(db, "content_entries", workspaceId, (q) => q.eq("status", "in_review")),
    countRows(db, "content_entries", workspaceId, (q) => q.eq("status", "approved")),
    countRows(db, "content_entries", workspaceId, (q) => q.eq("status", "scheduled")),
    countRows(db, "content_entries", workspaceId, (q) => q.eq("status", "published")),
    countRows(db, "assets", workspaceId, (q) => q.is("archived_at", null)),
    countRows(db, "releases", workspaceId, (q) => q.in("status", ["draft", "approved", "scheduled", "publishing"])),
    countRows(db, "releases", workspaceId, (q) => q.eq("status", "scheduled")),
    countRows(db, "releases", workspaceId, (q) => q.eq("status", "partially_failed")),
    countRows(db, "delivery_jobs", workspaceId, (q) => q.in("status", ["queued", "retrying"])),
    countRows(db, "delivery_jobs", workspaceId, (q) => q.eq("status", "running")),
    countRows(db, "delivery_jobs", workspaceId, (q) => q.eq("status", "dead_letter")),
    countRows(db, "content_health_findings", workspaceId, (q) => q.in("state", ["open", "acknowledged"])),
    countRows(db, "content_health_findings", workspaceId, (q) => q.in("state", ["open", "acknowledged"]).eq("severity", "blocking")),
    countRows(db, "content_health_findings", workspaceId, (q) => q.in("state", ["open", "acknowledged"]).eq("severity", "warning")),
    countRows(db, "content_assignments", workspaceId, (q) => q.eq("assigned_to_admin_user_id", actorId).eq("status", "active")),
    countRows(db, "infrastructure_approval_requests", workspaceId, (q) => q.eq("status", "pending")),
    countRows(db, "workspace_environments", workspaceId),
    countRows(db, "workspace_environments", workspaceId, (q) => q.eq("status", "ready")),
    countRows(db, "workspace_environments", workspaceId, (q) => q.in("status", ["degraded", "blocked"])),
    countRows(db, "workspace_connections", workspaceId, (q) => q.eq("active", true)),
    countRows(db, "workspace_connections", workspaceId, (q) => q.eq("active", true).eq("status", "active")),
    countRows(db, "workspace_connections", workspaceId, (q) => q.eq("active", true).in("status", ["degraded", "failed"])),
    // Analytics is optional. A stale PostgREST schema cache or an install that
    // has not enabled analytics must not take the whole command center down.
    countRows(db, "analytics_sync_state", workspaceId, (q) => q.in("status", ["stale", "failed"]))
      .catch(() => 0),
  ]);

  const [environmentResult, auditResult, jobsResult, findingsResult, releasesResult] = await Promise.all([
    db.from("workspace_environments")
      .select("id,key,name,kind,status,is_default,health_json,last_health_check_at,deployed_schema_revision")
      .eq("workspace_id", workspaceId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
    db.from("platform_audit_events")
      .select("id,action,entity_type,entity_id,metadata_json,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    db.from("delivery_jobs")
      .select("id,kind,status,queue_name,attempt_count,max_attempts,last_error_code,last_error_message,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(6),
    db.from("content_health_findings")
      .select("id,severity,state,title,detail,entity_type,entity_id,last_detected_at")
      .eq("workspace_id", workspaceId)
      .in("state", ["open", "acknowledged"])
      .order("last_detected_at", { ascending: false })
      .limit(6),
    db.from("releases")
      .select("id,name,status,scheduled_for,published_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(6),
  ]);

  for (const result of [environmentResult, auditResult, jobsResult, findingsResult, releasesResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const attention: AttentionItem[] = [];
  if (!environmentsTotal) attention.push({ key: "environment-missing", severity: "warning", title: "Finish workspace setup", detail: "No runtime environment is configured yet. Create one to enable provisioning, delivery health and deployment reconciliation.", href: "/admin/environments", count: 1 });
  if (environmentsProblem) attention.push({ key: "environment", severity: "blocking", title: "Environment health", detail: `${environmentsProblem} environment(s) are degraded or blocked.`, href: "/admin/infrastructure", count: environmentsProblem });
  if (connectionsProblem) attention.push({ key: "connection", severity: "blocking", title: "Connection failures", detail: `${connectionsProblem} active connection(s) are degraded or failed.`, href: "/admin/connections", count: connectionsProblem });
  if (jobsDead) attention.push({ key: "dead-letter", severity: "blocking", title: "Dead-letter jobs", detail: `${jobsDead} durable delivery job(s) require intervention.`, href: "/admin/operations", count: jobsDead });
  if (findingsBlocking) attention.push({ key: "assurance-blocking", severity: "blocking", title: "Blocking content findings", detail: `${findingsBlocking} blocking assurance/health finding(s) remain open.`, href: "/admin/assurance", count: findingsBlocking });
  if (approvalsPending) attention.push({ key: "approvals", severity: "warning", title: "Infrastructure approvals", detail: `${approvalsPending} high-risk operation(s) are waiting for review.`, href: "/admin/infrastructure", count: approvalsPending });
  if (reviewEntries) attention.push({ key: "reviews", severity: "info", title: "Editorial review", detail: `${reviewEntries} content item(s) are waiting in review.`, href: "/admin/my-work", count: reviewEntries });
  if (findingsWarning) attention.push({ key: "assurance-warning", severity: "warning", title: "Content health warnings", detail: `${findingsWarning} warning-level finding(s) remain open.`, href: "/admin/assurance", count: findingsWarning });
  if (analyticsProblems) attention.push({ key: "analytics", severity: "warning", title: "Analytics freshness", detail: `${analyticsProblems} analytics synchronization source(s) are stale or failed.`, href: "/admin/intelligence", count: analyticsProblems });

  const blockingCount = attention.filter((item) => item.severity === "blocking").reduce((sum, item) => sum + item.count, 0);
  const warningCount = attention.filter((item) => item.severity === "warning").reduce((sum, item) => sum + item.count, 0);
  const readiness = blockingCount > 0 ? "blocked" : warningCount > 0 ? "attention" : "healthy";
  const defaultEnvironment = (environmentResult.data ?? []).find((item) => item.is_default) ?? environmentResult.data?.[0] ?? null;

  return {
    readiness,
    attention,
    content: {
      models,
      entries,
      assets,
      byStatus: {
        draft: draftEntries,
        inReview: reviewEntries,
        approved: approvedEntries,
        scheduled: scheduledEntries,
        published: publishedEntries,
      },
    },
    workflow: {
      myAssignments: assignmentsActive,
      approvalsPending,
    },
    releases: {
      open: releasesOpen,
      scheduled: releasesScheduled,
      partiallyFailed: releasesFailed,
      recent: releasesResult.data ?? [],
    },
    delivery: {
      queued: jobsQueued,
      running: jobsRunning,
      deadLetter: jobsDead,
      recent: jobsResult.data ?? [],
    },
    assurance: {
      open: findingsOpen,
      blocking: findingsBlocking,
      warnings: findingsWarning,
      recent: findingsResult.data ?? [],
    },
    infrastructure: {
      environments: { total: environmentsTotal, ready: environmentsReady, problem: environmentsProblem },
      connections: { total: connectionsTotal, active: connectionsActive, problem: connectionsProblem },
      analyticsProblems,
      defaultEnvironment,
      environmentList: environmentResult.data ?? [],
    },
    recentActivity: auditResult.data ?? [],
    generatedAt: new Date().toISOString(),
  };
}
