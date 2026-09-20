import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getPagesForPeriod, getPagesForPeriodWithCredentials } from "@/lib/admin/ga4";
import { enqueueDeliveryJob } from "@/lib/operations/deliveryJobService";
import { logPlatformEvent } from "@/lib/platform/audit";
import { resolveConnectionCredentials } from "@/lib/infrastructure/credentialProvider";

const DAY = 86_400_000;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);

function periodEndingYesterday(days: number, offsetDays = 0) {
  const end = new Date(Date.now() - (1 + offsetDays) * DAY);
  const start = new Date(end.getTime() - (days - 1) * DAY);
  return { start: isoDate(start), end: isoDate(end) };
}

export async function ensureWorkspaceGa4Connector(params: { workspaceId: string; actorId: string }) {
  const db = createServiceRoleClient();
  const { data: existing } = await db
    .from("analytics_connectors")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("provider", "ga4")
    .eq("name", "GA4")
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await db.from("analytics_connectors").insert({
    workspace_id: params.workspaceId,
    provider: "ga4",
    name: "GA4",
    credential_mode: "environment",
    active: true,
    created_by: params.actorId,
  }).select().single();
  if (error || !data) throw new Error(error?.message || "Could not create GA4 connector");
  await db.from("analytics_sync_state").insert({ connector_id: data.id, workspace_id: params.workspaceId, status: "never_synced" });
  return data;
}

export async function getAnalyticsOverview(workspaceId: string) {
  const db = createServiceRoleClient();
  const [{ data: connectors }, { data: states }, { data: snapshots }] = await Promise.all([
    db.from("analytics_connectors").select("id, provider, name, credential_mode, active, created_at, updated_at").eq("workspace_id", workspaceId).order("created_at"),
    db.from("analytics_sync_state").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    db.from("content_analytics_snapshots").select("entry_id, version_id, destination_url, source, period_start, period_end, page_views, users_count, engagement_seconds, conversions, metrics_json, captured_at, data_fresh_through, connector_id").eq("workspace_id", workspaceId).order("period_end", { ascending: false }).limit(500),
  ]);
  return { connectors: connectors ?? [], syncStates: states ?? [], snapshots: snapshots ?? [] };
}

export async function queueAnalyticsSync(params: { workspaceId: string; actorId: string; connectorId: string }) {
  const db = createServiceRoleClient();
  const { data: connector } = await db.from("analytics_connectors").select("id, provider, active").eq("workspace_id", params.workspaceId).eq("id", params.connectorId).maybeSingle();
  if (!connector?.active) throw new Error("Active analytics connector not found");
  const freshThrough = periodEndingYesterday(28).end;
  const correlationId = randomUUID();
  const job = await enqueueDeliveryJob({
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    kind: "analytics_sync",
    idempotencyKey: `analytics:${connector.id}:${freshThrough}`,
    payload: { connectorId: connector.id, freshThrough },
    safeMetadata: { provider: connector.provider, connectorId: connector.id, freshThrough },
    queueName: "intelligence",
    correlationId,
    maxAttempts: 3,
  });
  await db.from("analytics_sync_state").upsert({
    connector_id: connector.id,
    workspace_id: params.workspaceId,
    status: "queued",
    correlation_id: correlationId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "connector_id" });
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "analytics.sync_queued", entityType: "analytics_connector", entityId: connector.id, metadata: { correlationId, freshThrough } });
  return job;
}

export async function runGa4AnalyticsSync(params: { workspaceId: string; connectorId: string; correlationId?: string | null }) {
  const db = createServiceRoleClient();
  const { data: connector } = await db.from("analytics_connectors").select("*").eq("workspace_id", params.workspaceId).eq("id", params.connectorId).eq("provider", "ga4").eq("active", true).maybeSingle();
  if (!connector) throw new Error("Active GA4 connector not found");
  const correlationId = params.correlationId || randomUUID();
  await db.from("analytics_sync_state").upsert({ connector_id: connector.id, workspace_id: params.workspaceId, status: "running", last_attempt_at: new Date().toISOString(), correlation_id: correlationId, last_error: null, updated_at: new Date().toISOString() }, { onConflict: "connector_id" });

  try {
    const pagesFor = async (start: string, end: string) => {
      if (!connector.connection_id) return getPagesForPeriod(start, end);
      const { data: connection } = await db.from("workspace_connections").select("id,config_json,status,active").eq("workspace_id", params.workspaceId).eq("id", connector.connection_id).maybeSingle();
      if (!connection?.active || connection.status === "disabled") throw new Error("Linked GA4 connection is disabled or unavailable");
      const credentials = await resolveConnectionCredentials(params.workspaceId, connection.id);
      const propertyId = String(connection.config_json?.propertyId ?? "").trim();
      if (!propertyId || !credentials.client_email || !credentials.private_key) throw new Error("Linked GA4 connection is missing required configuration or credentials");
      return getPagesForPeriodWithCredentials({ propertyId, clientEmail: credentials.client_email, privateKey: credentials.private_key }, start, end);
    };
    const current = periodEndingYesterday(28);
    const previous = periodEndingYesterday(28, 28);
    const [currentPages, previousPages, routesResult] = await Promise.all([
      pagesFor(current.start, current.end),
      pagesFor(previous.start, previous.end),
      db.from("content_routes").select("path, entry_id, locale").eq("workspace_id", params.workspaceId).eq("is_canonical", true).eq("status", "active").not("entry_id", "is", null),
    ]);
    const routes = routesResult.data ?? [];
    const entryIds = [...new Set(routes.map((route) => route.entry_id).filter((id): id is string => Boolean(id)))];
    const { data: entries } = entryIds.length ? await db.from("content_entries").select("id, published_version_id").eq("workspace_id", params.workspaceId).in("id", entryIds) : { data: [] as Array<{ id: string; published_version_id: string | null }> };
    const versionByEntry = new Map((entries ?? []).map((entry) => [entry.id, entry.published_version_id]));
    const currentByPath = new Map(currentPages.map((page) => [page.path.replace(/\?.*$/, "").replace(/\/$/, "") || "/", page]));
    const previousByPath = new Map(previousPages.map((page) => [page.path.replace(/\?.*$/, "").replace(/\/$/, "") || "/", page]));
    let written = 0;
    for (const route of routes) {
      if (!route.entry_id) continue;
      const path = route.path.replace(/\/$/, "") || "/";
      const versionId = versionByEntry.get(route.entry_id) ?? null;
      for (const period of [{ range: current, page: currentByPath.get(path), label: "current_28d" }, { range: previous, page: previousByPath.get(path), label: "previous_28d" }]) {
        const page = period.page;
        const { error } = await db.from("content_analytics_snapshots").upsert({
          workspace_id: params.workspaceId,
          entry_id: route.entry_id,
          version_id: versionId,
          destination_url: path,
          source: "ga4",
          period_start: period.range.start,
          period_end: period.range.end,
          page_views: page?.pageViews ?? 0,
          users_count: page?.users ?? 0,
          engagement_seconds: page?.engagementSeconds ?? 0,
          conversions: null,
          metrics_json: { sessions: page?.sessions ?? 0, pageTitle: page?.title ?? null, comparisonWindow: period.label, interpretation: "observational" },
          connector_id: connector.id,
          sync_correlation_id: correlationId,
          data_fresh_through: current.end,
          captured_at: new Date().toISOString(),
        }, { onConflict: "workspace_id,entry_id,version_id,source,period_start,period_end" });
        if (error) throw new Error(error.message);
        written += 1;
      }
    }
    await db.from("analytics_sync_state").upsert({ connector_id: connector.id, workspace_id: params.workspaceId, status: "fresh", last_success_at: new Date().toISOString(), fresh_through: current.end, correlation_id: correlationId, last_error: null, updated_at: new Date().toISOString() }, { onConflict: "connector_id" });
    return { connectorId: connector.id, correlationId, freshThrough: current.end, routes: routes.length, snapshotsWritten: written };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GA4 synchronization failed";
    await db.from("analytics_sync_state").upsert({ connector_id: connector.id, workspace_id: params.workspaceId, status: "failed", last_attempt_at: new Date().toISOString(), correlation_id: correlationId, last_error: message, updated_at: new Date().toISOString() }, { onConflict: "connector_id" });
    throw error;
  }
}

export async function getEntryPerformanceComparison(workspaceId: string, entryId: string) {
  const { data, error } = await createServiceRoleClient().from("content_analytics_snapshots")
    .select("period_start, period_end, page_views, users_count, engagement_seconds, conversions, metrics_json, data_fresh_through, captured_at, version_id")
    .eq("workspace_id", workspaceId).eq("entry_id", entryId).eq("source", "ga4").order("period_end", { ascending: false }).limit(12);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const current = rows.find((row) => row.metrics_json?.comparisonWindow === "current_28d") ?? rows[0] ?? null;
  const previous = rows.find((row) => row.metrics_json?.comparisonWindow === "previous_28d") ?? rows[1] ?? null;
  const pct = (a: number | null, b: number | null) => b && a !== null ? ((a - b) / b) * 100 : null;
  return {
    current,
    previous,
    delta: current && previous ? {
      pageViewsPct: pct(Number(current.page_views ?? 0), Number(previous.page_views ?? 0)),
      usersPct: pct(Number(current.users_count ?? 0), Number(previous.users_count ?? 0)),
      engagementPct: pct(Number(current.engagement_seconds ?? 0), Number(previous.engagement_seconds ?? 0)),
    } : null,
    interpretation: "observational" as const,
    note: "Before/after analytics are observational. They do not establish that the content change caused the measured outcome.",
  };
}
