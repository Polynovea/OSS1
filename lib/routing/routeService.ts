import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";

export interface RouteRow {
  id: string;
  workspace_id: string;
  parent_route_id: string | null;
  entry_id: string | null;
  locale: string;
  path: string;
  title: string | null;
  node_type: "routable_entry" | "virtual_folder" | "external_link" | "custom_path";
  is_canonical: boolean;
  status: "active" | "draft" | "archived";
  order_index: number;
  indexing_policy: "inherit" | "index" | "noindex";
  sitemap_included: boolean;
  sitemap_priority: number | null;
  sitemap_changefreq: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never" | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  children?: RouteRow[];
}

export interface RouteHistoryRow {
  id: string;
  workspace_id: string;
  route_id: string;
  entry_id: string | null;
  locale: string;
  old_path: string;
  new_path: string;
  changed_by: string | null;
  created_at: string;
}

const RESERVED_PREFIXES = ["/admin", "/api", "/preview", "/auth", "/_next", "/favicon.ico", "/robots.txt", "/sitemap.xml"];

/**
 * Hardened Path Normalization Policy:
 * 1. Leading slash: ALWAYS required
 * 2. Trailing slash: ALWAYS stripped (except root "/")
 * 3. Case policy: ALWAYS lowercased
 * 4. Duplicate slashes: ALWAYS collapsed
 * 5. Query strings / fragments: FORBIDDEN
 * 6. Reserved system prefixes: FORBIDDEN
 */
export function normalizePath(rawPath: string): { ok: true; path: string } | { ok: false; error: string } {
  if (!rawPath || typeof rawPath !== "string") {
    return { ok: false, error: "Path cannot be empty" };
  }

  let trimmed = rawPath.trim();
  if (trimmed.includes("?") || trimmed.includes("#")) {
    return { ok: false, error: "URL path cannot contain query parameters or fragments" };
  }

  // Ensure leading slash
  if (!trimmed.startsWith("/")) {
    trimmed = `/${trimmed}`;
  }

  // Collapse duplicate slashes and lowercase
  let normalized = trimmed.replace(/\/+/g, "/").toLowerCase();

  // Strip trailing slash unless root
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  // Check reserved system prefixes
  for (const prefix of RESERVED_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return { ok: false, error: `Path '${normalized}' uses a reserved system prefix (${prefix})` };
    }
  }

  // Slug segment validation: allow a-z, 0-9, -, _, ., /
  if (!/^\/[a-z0-9_.\-\/]*$/.test(normalized)) {
    return { ok: false, error: "Path contains invalid characters (only alphanumeric, dashes, dots and slashes allowed)" };
  }

  return { ok: true, path: normalized };
}

export async function checkPathCollision(params: {
  workspaceId: string;
  locale: string;
  path: string;
  excludeRouteId?: string;
}): Promise<{ isCollision: boolean; conflictingRoute?: RouteRow | null; normalizedPath: string; error?: string }> {
  const norm = normalizePath(params.path);
  if (!norm.ok) {
    return { isCollision: true, error: norm.error, normalizedPath: params.path };
  }

  const db = createServiceRoleClient();
  let query = db
    .from("content_routes")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("locale", params.locale)
    .eq("path", norm.path)
    .neq("status", "archived");

  if (params.excludeRouteId) {
    query = query.neq("id", params.excludeRouteId);
  }

  const { data } = await query.maybeSingle();
  return {
    isCollision: Boolean(data),
    conflictingRoute: (data as RouteRow) ?? null,
    normalizedPath: norm.path,
  };
}

export async function listRoutes(workspaceId: string, locale?: string): Promise<RouteRow[]> {
  const db = createServiceRoleClient();
  let query = db
    .from("content_routes")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("status", "archived")
    .order("order_index", { ascending: true })
    .order("path", { ascending: true });

  if (locale) {
    query = query.eq("locale", locale);
  }

  const { data } = await query;
  return (data as RouteRow[]) ?? [];
}

export async function getSiteTree(workspaceId: string, locale: string = "en"): Promise<RouteRow[]> {
  const routes = await listRoutes(workspaceId, locale);
  const routeMap = new Map<string, RouteRow>();

  for (const r of routes) {
    r.children = [];
    routeMap.set(r.id, r);
  }

  const rootNodes: RouteRow[] = [];
  for (const r of routes) {
    if (r.parent_route_id && routeMap.has(r.parent_route_id)) {
      routeMap.get(r.parent_route_id)!.children!.push(r);
    } else {
      rootNodes.push(r);
    }
  }

  return rootNodes;
}

export async function registerRoute(params: {
  workspaceId: string;
  actorAdminUserId: string;
  locale: string;
  path: string;
  title?: string | null;
  entryId?: string | null;
  parentRouteId?: string | null;
  nodeType?: "routable_entry" | "virtual_folder" | "external_link" | "custom_path";
  isCanonical?: boolean;
  orderIndex?: number;
  metadata?: Record<string, unknown>;
}): Promise<RouteRow> {
  const norm = normalizePath(params.path);
  if (!norm.ok) throw new Error(norm.error);

  const collision = await checkPathCollision({
    workspaceId: params.workspaceId,
    locale: params.locale,
    path: norm.path,
  });
  if (collision.isCollision) {
    throw new Error(`Route collision: path '${norm.path}' is already in use in locale '${params.locale}'`);
  }

  const db = createServiceRoleClient();
  const isCanonical = params.isCanonical ?? true;

  // If this is canonical for an entry, un-canonicalize any existing route for this entry/locale
  if (isCanonical && params.entryId) {
    await db
      .from("content_routes")
      .update({ is_canonical: false, updated_at: new Date().toISOString() })
      .eq("workspace_id", params.workspaceId)
      .eq("entry_id", params.entryId)
      .eq("locale", params.locale);
  }

  const { data: route, error } = await db
    .from("content_routes")
    .insert({
      workspace_id: params.workspaceId,
      parent_route_id: params.parentRouteId || null,
      entry_id: params.entryId || null,
      locale: params.locale,
      path: norm.path,
      title: params.title?.trim() || null,
      node_type: params.nodeType || "routable_entry",
      is_canonical: isCanonical,
      status: "active",
      order_index: params.orderIndex ?? 0,
      metadata_json: params.metadata || {},
    })
    .select()
    .single();

  if (error || !route) throw new Error(error?.message || "Could not create route");

  await syncRouteRelations(params.workspaceId, route.id, route.entry_id, params.metadata);

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "routing.route.created",
    entityType: "route",
    entityId: route.id,
    metadata: { path: route.path, locale: route.locale, entryId: route.entry_id },
  });

  return route as RouteRow;
}

/**
 * Synchronize generic dependency graph edges for a content route.
 */
export async function syncRouteRelations(
  workspaceId: string,
  routeId: string,
  entryId?: string | null,
  metadata?: Record<string, unknown>
): Promise<void> {
  const db = createServiceRoleClient();

  const rows: Array<{
    workspace_id: string;
    source_route_id: string;
    source_entity_type: string;
    target_entity_type: string;
    relation_type: string;
    target_entry_id?: string | null;
    target_term_id?: string | null;
    target_asset_id?: string | null;
    target_route_id?: string | null;
    target_menu_id?: string | null;
  }> = [];

  if (entryId) {
    rows.push({
      workspace_id: workspaceId,
      source_route_id: routeId,
      source_entity_type: "route",
      target_entity_type: "entry",
      relation_type: "route_entry",
      target_entry_id: entryId,
    });
  }

  const termId = (metadata?.targetTermId || metadata?.target_term_id || metadata?.termId) as string | undefined;
  if (termId) {
    rows.push({
      workspace_id: workspaceId,
      source_route_id: routeId,
      source_entity_type: "route",
      target_entity_type: "term",
      relation_type: "route_taxonomy",
      target_term_id: termId,
    });
  }

  const assetId = (metadata?.targetAssetId || metadata?.target_asset_id || metadata?.assetId) as string | undefined;
  if (assetId) {
    rows.push({
      workspace_id: workspaceId,
      source_route_id: routeId,
      source_entity_type: "route",
      target_entity_type: "asset",
      relation_type: "route_asset",
      target_asset_id: assetId,
    });
  }

  const targetRouteId = (metadata?.targetRouteId || metadata?.target_route_id) as string | undefined;
  if (targetRouteId) {
    rows.push({
      workspace_id: workspaceId,
      source_route_id: routeId,
      source_entity_type: "route",
      target_entity_type: "route",
      relation_type: "route_link",
      target_route_id: targetRouteId,
    });
  }

  const targetMenuId = (metadata?.targetMenuId || metadata?.target_menu_id || metadata?.menuId) as string | undefined;
  if (targetMenuId) {
    rows.push({
      workspace_id: workspaceId,
      source_route_id: routeId,
      source_entity_type: "route",
      target_entity_type: "menu",
      relation_type: "route_menu",
      target_menu_id: targetMenuId,
    });
  }

  // Atomic stored procedure to maintain generic dependency graph edges without non-atomic fallback
  const { error } = await db.rpc("cms_replace_source_relations", {
    p_workspace_id: workspaceId,
    p_source_type: "route",
    p_source_id: routeId,
    p_relations: rows,
  });
  if (error) {
    throw new Error(`Failed to replace route relations: ${error.message}`);
  }
}

/**
 * Atomic Route Path Change:
 * 1. Validates and normalizes new path without collision.
 * 2. Updates route path in content_routes.
 * 3. Records previous path in content_route_history.
 * 4. Automatically creates a 301 permanent redirect from old_path to new_path in content_redirects.
 * 5. Logs platform audit event inside the PostgreSQL transaction.
 */
export async function updateRoutePath(params: {
  workspaceId: string;
  actorAdminUserId: string;
  routeId: string;
  newPath: string;
  title?: string;
  parentRouteId?: string | null;
  orderIndex?: number;
}): Promise<{ route: RouteRow; redirectCreated: boolean }> {
  const norm = normalizePath(params.newPath);
  if (!norm.ok) throw new Error(norm.error);

  const db = createServiceRoleClient();
  const { data, error } = await db.rpc("cms_update_route_path", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_route_id: params.routeId,
    p_new_path: norm.path,
    p_title: params.title?.trim() || null,
    p_parent_route_id: params.parentRouteId !== undefined ? params.parentRouteId : null,
    p_order_index: params.orderIndex ?? null,
    p_parent_route_id_supplied: params.parentRouteId !== undefined,
  });

  if (error || !data) throw new Error(error?.message || "Could not update route path");

  const result = data as { route: RouteRow; redirectCreated: boolean };
  await syncRouteRelations(params.workspaceId, result.route.id, result.route.entry_id, result.route.metadata_json);

  return result;
}

export async function updateRouteDiscoverability(params: {
  workspaceId: string;
  actorAdminUserId: string;
  routeId: string;
  indexingPolicy: "inherit" | "index" | "noindex";
  sitemapIncluded: boolean;
  sitemapPriority?: number | null;
  sitemapChangefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never" | null;
}): Promise<RouteRow> {
  const { data, error } = await createServiceRoleClient().rpc("cms_update_route_discoverability", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_route_id: params.routeId,
    p_indexing_policy: params.indexingPolicy,
    p_sitemap_included: params.sitemapIncluded,
    p_sitemap_priority: params.sitemapPriority ?? null,
    p_sitemap_changefreq: params.sitemapChangefreq ?? null,
  });
  if (error || !data) throw new Error(error?.message || "Could not update route discoverability");
  return data as RouteRow;
}

export async function deleteRoute(params: {
  workspaceId: string;
  actorAdminUserId: string;
  routeId: string;
}): Promise<{ ok: true }> {
  const db = createServiceRoleClient();
  const { error } = await db
    .from("content_routes")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.routeId);

  if (error) throw new Error(error.message);

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "routing.route.deleted",
    entityType: "route",
    entityId: params.routeId,
    metadata: {},
  });

  return { ok: true };
}
