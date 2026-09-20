import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";

export interface NavigationMenuRow {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  description: string | null;
  current_draft_version_id: string | null;
  published_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NavigationItemData {
  id: string;
  label: string;
  itemType: "internal_entry" | "internal_route" | "external_url";
  targetEntryId?: string | null;
  targetRouteId?: string | null;
  targetAssetId?: string | null;
  iconAssetId?: string | null;
  targetTermId?: string | null;
  targetMenuId?: string | null;
  url?: string | null;
  openInNewTab?: boolean;
  audienceRule?: "all" | "authenticated" | "guest";
  orderIndex?: number;
  isVisible?: boolean;
  localizations?: { locale: string; label: string; urlOverride?: string | null }[];
  children?: NavigationItemData[];
}

export interface NavigationVersionRow {
  id: string;
  workspace_id: string;
  menu_id: string;
  version_number: number;
  state: "draft" | "published" | "archived";
  items_jsonb: NavigationItemData[];
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ResolvedNavigationNode {
  id: string;
  label: string;
  url: string;
  openInNewTab: boolean;
  audienceRule: "all" | "authenticated" | "guest";
  children: ResolvedNavigationNode[];
}

export async function listMenus(workspaceId: string): Promise<NavigationMenuRow[]> {
  const { data } = await createServiceRoleClient()
    .from("navigation_menus")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  return (data as NavigationMenuRow[]) ?? [];
}

export async function getMenu(workspaceId: string, idOrKey: string): Promise<NavigationMenuRow | null> {
  const db = createServiceRoleClient();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);

  let query = db.from("navigation_menus").select("*").eq("workspace_id", workspaceId);
  if (isUuid) {
    query = query.eq("id", idOrKey);
  } else {
    query = query.eq("key", idOrKey);
  }

  const { data } = await query.maybeSingle();
  return (data as NavigationMenuRow) ?? null;
}

export async function createMenu(params: {
  workspaceId: string;
  actorAdminUserId: string;
  key: string;
  name: string;
  description?: string | null;
  initialItems?: NavigationItemData[];
}): Promise<{ menu: NavigationMenuRow; version: NavigationVersionRow }> {
  const db = createServiceRoleClient();
  const key = params.key.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "_");

  const { data: menu, error: menuErr } = await db
    .from("navigation_menus")
    .insert({
      workspace_id: params.workspaceId,
      key,
      name: params.name.trim(),
      description: params.description?.trim() || null,
    })
    .select()
    .single();

  if (menuErr || !menu) throw new Error(menuErr?.message || "Could not create menu");

  // Create initial draft version 1
  const { data: version, error: vErr } = await db
    .from("navigation_menu_versions")
    .insert({
      workspace_id: params.workspaceId,
      menu_id: menu.id,
      version_number: 1,
      state: "draft",
      items_jsonb: params.initialItems || [],
      change_summary: "Initial menu structure",
      created_by: params.actorAdminUserId,
    })
    .select()
    .single();

  if (vErr || !version) throw new Error(vErr?.message || "Could not create initial menu version");

  await db
    .from("navigation_menus")
    .update({ current_draft_version_id: version.id })
    .eq("id", menu.id);

  if (params.initialItems && params.initialItems.length) {
    await syncMenuRelations(params.workspaceId, menu.id, params.initialItems);
  }

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "navigation.menu.created",
    entityType: "navigation_menu",
    entityId: menu.id,
    metadata: { key: menu.key, name: menu.name },
  });

  return {
    menu: { ...menu, current_draft_version_id: version.id } as NavigationMenuRow,
    version: version as NavigationVersionRow,
  };
}

/**
 * Synchronize generic dependency graph edges for a navigation menu.
 */
export async function syncMenuRelations(
  workspaceId: string,
  menuId: string,
  items: NavigationItemData[]
): Promise<void> {
  const db = createServiceRoleClient();

  const rows: Array<{
    workspace_id: string;
    source_menu_id: string;
    source_entity_type: string;
    target_entity_type: string;
    relation_type: string;
    target_entry_id?: string | null;
    target_route_id?: string | null;
    target_asset_id?: string | null;
    target_term_id?: string | null;
    target_menu_id?: string | null;
  }> = [];

  function collect(itemNodes: NavigationItemData[]) {
    for (const item of itemNodes) {
      if (item.targetEntryId) {
        rows.push({
          workspace_id: workspaceId,
          source_menu_id: menuId,
          source_entity_type: "menu",
          target_entity_type: "entry",
          relation_type: "menu_entry",
          target_entry_id: item.targetEntryId,
        });
      }
      if (item.targetRouteId) {
        rows.push({
          workspace_id: workspaceId,
          source_menu_id: menuId,
          source_entity_type: "menu",
          target_entity_type: "route",
          relation_type: "menu_route",
          target_route_id: item.targetRouteId,
        });
      }
      const assetId = item.targetAssetId || item.iconAssetId;
      if (assetId) {
        rows.push({
          workspace_id: workspaceId,
          source_menu_id: menuId,
          source_entity_type: "menu",
          target_entity_type: "asset",
          relation_type: "menu_icon",
          target_asset_id: assetId,
        });
      }
      if (item.targetTermId) {
        rows.push({
          workspace_id: workspaceId,
          source_menu_id: menuId,
          source_entity_type: "menu",
          target_entity_type: "term",
          relation_type: "menu_term",
          target_term_id: item.targetTermId,
        });
      }
      if (item.targetMenuId) {
        rows.push({
          workspace_id: workspaceId,
          source_menu_id: menuId,
          source_entity_type: "menu",
          target_entity_type: "menu",
          relation_type: "menu_submenu",
          target_menu_id: item.targetMenuId,
        });
      }
      if (item.children?.length) {
        collect(item.children);
      }
    }
  }

  collect(items);

  // Atomic stored procedure to maintain generic dependency graph edges without non-atomic fallback
  const { error } = await db.rpc("cms_replace_source_relations", {
    p_workspace_id: workspaceId,
    p_source_type: "menu",
    p_source_id: menuId,
    p_relations: rows,
  });
  if (error) {
    throw new Error(`Failed to replace navigation menu relations: ${error.message}`);
  }
}

export async function saveMenuDraft(params: {
  workspaceId: string;
  actorAdminUserId: string;
  menuId: string;
  items: NavigationItemData[];
  changeSummary?: string;
}): Promise<NavigationVersionRow> {
  const db = createServiceRoleClient();
  const menu = await getMenu(params.workspaceId, params.menuId);
  if (!menu) throw new Error("Menu not found");

  // Get highest version number
  const { data: latest } = await db
    .from("navigation_menu_versions")
    .select("version_number")
    .eq("workspace_id", params.workspaceId)
    .eq("menu_id", params.menuId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersionNumber = (latest?.version_number ?? 0) + 1;

  const { data: newVersion, error } = await db
    .from("navigation_menu_versions")
    .insert({
      workspace_id: params.workspaceId,
      menu_id: params.menuId,
      version_number: nextVersionNumber,
      state: "draft",
      items_jsonb: params.items,
      change_summary: params.changeSummary || `Draft update v${nextVersionNumber}`,
      created_by: params.actorAdminUserId,
    })
    .select()
    .single();

  if (error || !newVersion) throw new Error(error?.message || "Could not save menu draft");

  await db
    .from("navigation_menus")
    .update({ current_draft_version_id: newVersion.id, updated_at: new Date().toISOString() })
    .eq("id", params.menuId);

  await syncMenuRelations(params.workspaceId, params.menuId, params.items);

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "navigation.menu.draft_saved",
    entityType: "navigation_menu",
    entityId: params.menuId,
    metadata: { versionNumber: nextVersionNumber },
  });

  return newVersion as NavigationVersionRow;
}

export async function publishMenu(params: {
  workspaceId: string;
  actorAdminUserId: string;
  menuId: string;
  versionNumber?: number;
}): Promise<NavigationVersionRow> {
  const db = createServiceRoleClient();
  const { data, error } = await db.rpc("cms_publish_navigation_menu", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_menu_id: params.menuId,
    p_version_number: params.versionNumber ?? null,
  });

  if (error || !data) throw new Error(error?.message || "Could not publish navigation menu");

  const published = data as NavigationVersionRow;
  if (published.items_jsonb) {
    await syncMenuRelations(params.workspaceId, params.menuId, published.items_jsonb);
  }

  return published;
}

export async function listMenuVersions(workspaceId: string, menuId: string): Promise<NavigationVersionRow[]> {
  const { data } = await createServiceRoleClient()
    .from("navigation_menu_versions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("menu_id", menuId)
    .order("version_number", { ascending: false });
  return (data as NavigationVersionRow[]) ?? [];
}

/**
 * Resolves Navigation Tree for Website or Preview delivery:
 * 1. Loads draft or published version items.
 * 2. Resolves localized labels for the specified locale.
 * 3. Resolves internal canonical routes or entry URLs.
 * 4. Filters out items not matching the audience rule.
 */
export async function getResolvedNavigationTree(params: {
  workspaceId: string;
  menuKey: string;
  locale?: string;
  mode?: "preview" | "published";
  audience?: "all" | "authenticated" | "guest";
}): Promise<ResolvedNavigationNode[]> {
  const db = createServiceRoleClient();
  const menu = await getMenu(params.workspaceId, params.menuKey);
  if (!menu) return [];

  const versionId = params.mode === "preview" ? menu.current_draft_version_id || menu.published_version_id : menu.published_version_id;
  if (!versionId) return [];

  const { data: version } = await db
    .from("navigation_menu_versions")
    .select("items_jsonb")
    .eq("workspace_id", params.workspaceId)
    .eq("id", versionId)
    .single();

  if (!version || !Array.isArray(version.items_jsonb)) return [];

  const locale = params.locale || "en";
  const audience = params.audience || "all";

  // Preload routes in workspace for URL resolution
  const { data: routes } = await db
    .from("content_routes")
    .select("id, entry_id, path, locale, is_canonical")
    .eq("workspace_id", params.workspaceId)
    .neq("status", "archived");

  const routeByEntry = new Map<string, string>();
  const routeById = new Map<string, string>();
  for (const r of (routes ?? [])) {
    routeById.set(r.id, r.path);
    if (r.entry_id && (r.locale === locale || !routeByEntry.has(r.entry_id))) {
      routeByEntry.set(r.entry_id, r.path);
    }
  }

  function resolveItem(item: NavigationItemData): ResolvedNavigationNode | null {
    if (item.isVisible === false) return null;

    // Audience filtering
    const itemAudience = item.audienceRule || "all";
    if (itemAudience !== "all" && audience !== "all" && itemAudience !== audience) {
      return null;
    }

    // Localized label resolution
    let label = item.label;
    let url = item.url || "/";

    if (item.localizations && item.localizations.length) {
      const loc = item.localizations.find((l) => l.locale === locale);
      if (loc) {
        if (loc.label) label = loc.label;
        if (loc.urlOverride) url = loc.urlOverride;
      }
    }

    if (item.itemType === "internal_entry" && item.targetEntryId) {
      url = routeByEntry.get(item.targetEntryId) || `/entry/${item.targetEntryId}`;
    } else if (item.itemType === "internal_route" && item.targetRouteId) {
      url = routeById.get(item.targetRouteId) || url;
    }

    const children: ResolvedNavigationNode[] = [];
    if (Array.isArray(item.children)) {
      for (const child of item.children) {
        const resolvedChild = resolveItem(child);
        if (resolvedChild) children.push(resolvedChild);
      }
    }

    return {
      id: item.id,
      label,
      url,
      openInNewTab: Boolean(item.openInNewTab),
      audienceRule: itemAudience,
      children,
    };
  }

  const resolvedTree: ResolvedNavigationNode[] = [];
  for (const rootItem of version.items_jsonb) {
    const resolved = resolveItem(rootItem);
    if (resolved) resolvedTree.push(resolved);
  }

  return resolvedTree;
}

export async function getNavigationWhereUsed(workspaceId: string, entryId: string): Promise<{ menuId: string; menuKey: string; menuName: string }[]> {
  const db = createServiceRoleClient();
  const { data: versions } = await db
    .from("navigation_menu_versions")
    .select("menu_id, items_jsonb, navigation_menus(id, key, name)")
    .eq("workspace_id", workspaceId);

  const matchedMenus = new Map<string, { menuId: string; menuKey: string; menuName: string }>();

  function scanItems(items: NavigationItemData[], menu: { id: string; key: string; name: string }) {
    for (const it of items) {
      if (it.targetEntryId === entryId) {
        matchedMenus.set(menu.id, { menuId: menu.id, menuKey: menu.key, menuName: menu.name });
      }
      if (Array.isArray(it.children)) {
        scanItems(it.children, menu);
      }
    }
  }

  for (const v of (versions ?? [])) {
    const menuObj = Array.isArray(v.navigation_menus) ? v.navigation_menus[0] : v.navigation_menus;
    if (menuObj && Array.isArray(v.items_jsonb)) {
      scanItems(v.items_jsonb, menuObj as { id: string; key: string; name: string });
    }
  }

  return Array.from(matchedMenus.values());
}
