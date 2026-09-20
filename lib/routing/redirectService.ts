import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { normalizePath } from "@/lib/routing/routeService";

export interface RedirectRow {
  id: string;
  workspace_id: string;
  locale: string | null;
  source_path: string;
  target_path: string;
  status_code: 301 | 302 | 307 | 308;
  is_active: boolean;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RedirectValidationResult {
  valid: boolean;
  error?: string;
  isLoop: boolean;
  isBrokenTarget: boolean;
}

export interface BulkImportItem {
  sourcePath: string;
  targetPath: string;
  statusCode?: number;
  locale?: string | null;
  description?: string;
}

export interface BulkImportReport {
  dryRun: boolean;
  totalRows: number;
  validCount: number;
  errorCount: number;
  errors: { row: number; sourcePath: string; error: string }[];
  imported: RedirectRow[];
}

/**
 * Loop Detection Algorithm:
 * Follows the redirect chain from targetPath up to maxHops (10).
 * If it circles back to sourcePath or forms a closed loop, returns isLoop = true.
 */
export async function detectRedirectLoop(
  workspaceId: string,
  sourcePath: string,
  targetPath: string,
  locale?: string | null
): Promise<{ isLoop: boolean; loopPath?: string[]; error?: string }> {
  const normSource = normalizePath(sourcePath);
  if (!normSource.ok) return { isLoop: true, error: normSource.error };

  // If target is an external URL, no internal loop can happen
  if (targetPath.startsWith("http://") || targetPath.startsWith("https://")) {
    return { isLoop: false };
  }

  const normTarget = normalizePath(targetPath);
  if (!normTarget.ok) return { isLoop: true, error: normTarget.error };

  if (normSource.path === normTarget.path) {
    return {
      isLoop: true,
      loopPath: [normSource.path, normTarget.path],
      error: `Self-redirect loop: source and target are identical (${normSource.path})`,
    };
  }

  const db = createServiceRoleClient();
  let query = db
    .from("content_redirects")
    .select("source_path, target_path, locale")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  if (locale) {
    query = query.or(`locale.eq.${locale},locale.is.null`);
  }

  const { data } = await query;
  const redirectMap = new Map<string, string>();
  for (const r of (data ?? [])) {
    redirectMap.set(r.source_path, r.target_path);
  }

  // Simulate inserting this new rule
  redirectMap.set(normSource.path, normTarget.path);

  // Traverse chain from normSource
  const visited = new Set<string>();
  const chain: string[] = [normSource.path];
  let current: string | undefined = normSource.path;

  while (current && redirectMap.has(current)) {
    if (visited.has(current)) {
      return {
        isLoop: true,
        loopPath: [...chain, current],
        error: `Circular redirect loop detected: ${[...chain, current].join(" -> ")}`,
      };
    }
    visited.add(current);
    const next = redirectMap.get(current);
    if (!next || next.startsWith("http://") || next.startsWith("https://")) {
      break;
    }
    const normNext = normalizePath(next);
    if (!normNext.ok) break;
    chain.push(normNext.path);
    current = normNext.path;

    if (chain.length > 12) {
      return {
        isLoop: true,
        loopPath: chain,
        error: "Redirect chain exceeds 10 hops",
      };
    }
  }

  return { isLoop: false };
}

export async function validateRedirectTarget(
  workspaceId: string,
  targetPath: string,
  locale?: string | null
): Promise<{ isBrokenTarget: boolean; targetType: "internal_route" | "external_url" | "broken" }> {
  if (targetPath.startsWith("http://") || targetPath.startsWith("https://")) {
    return { isBrokenTarget: false, targetType: "external_url" };
  }

  const norm = normalizePath(targetPath);
  if (!norm.ok) return { isBrokenTarget: true, targetType: "broken" };

  const db = createServiceRoleClient();
  let query = db
    .from("content_routes")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("path", norm.path)
    .neq("status", "archived");

  if (locale) {
    query = query.eq("locale", locale);
  }

  const { data } = await query.maybeSingle();
  return {
    isBrokenTarget: !data,
    targetType: data ? "internal_route" : "broken",
  };
}

export async function listRedirects(workspaceId: string, locale?: string): Promise<RedirectRow[]> {
  const db = createServiceRoleClient();
  let query = db
    .from("content_redirects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (locale) {
    query = query.or(`locale.eq.${locale},locale.is.null`);
  }

  const { data } = await query;
  return (data as RedirectRow[]) ?? [];
}

export async function getRedirect(workspaceId: string, id: string): Promise<RedirectRow | null> {
  const { data } = await createServiceRoleClient()
    .from("content_redirects")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  return (data as RedirectRow) ?? null;
}

export async function createRedirect(params: {
  workspaceId: string;
  actorAdminUserId: string;
  sourcePath: string;
  targetPath: string;
  statusCode?: 301 | 302 | 307 | 308;
  locale?: string | null;
  description?: string | null;
  isActive?: boolean;
}): Promise<RedirectRow> {
  const normSource = normalizePath(params.sourcePath);
  if (!normSource.ok) throw new Error(normSource.error);

  const loopCheck = await detectRedirectLoop(
    params.workspaceId,
    normSource.path,
    params.targetPath,
    params.locale
  );
  if (loopCheck.isLoop) {
    throw new Error(loopCheck.error || "Cannot create redirect: creates a loop");
  }

  const db = createServiceRoleClient();
  const statusCode = params.statusCode || 301;

  const { data, error } = await db
    .from("content_redirects")
    .insert({
      workspace_id: params.workspaceId,
      locale: params.locale || null,
      source_path: normSource.path,
      target_path: params.targetPath.trim(),
      status_code: statusCode,
      is_active: params.isActive ?? true,
      description: params.description?.trim() || null,
      created_by: params.actorAdminUserId,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Could not create redirect");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "redirect.created",
    entityType: "redirect",
    entityId: data.id,
    metadata: {
      sourcePath: data.source_path,
      targetPath: data.target_path,
      statusCode: data.status_code,
    },
  });

  return data as RedirectRow;
}

export async function updateRedirect(params: {
  workspaceId: string;
  actorAdminUserId: string;
  id: string;
  sourcePath?: string;
  targetPath?: string;
  statusCode?: 301 | 302 | 307 | 308;
  isActive?: boolean;
  description?: string | null;
}): Promise<RedirectRow> {
  const db = createServiceRoleClient();
  const current = await getRedirect(params.workspaceId, params.id);
  if (!current) throw new Error("Redirect not found in workspace");

  const sourcePath = params.sourcePath ? normalizePath(params.sourcePath) : { ok: true as const, path: current.source_path };
  if (!sourcePath.ok) throw new Error(sourcePath.error);

  const targetPath = params.targetPath ? params.targetPath.trim() : current.target_path;

  if (params.sourcePath || params.targetPath) {
    const loopCheck = await detectRedirectLoop(
      params.workspaceId,
      sourcePath.path,
      targetPath,
      current.locale
    );
    if (loopCheck.isLoop) {
      throw new Error(loopCheck.error || "Cannot update redirect: creates a loop");
    }
  }

  // 1. Record history
  await db.from("content_redirect_history").insert({
    workspace_id: params.workspaceId,
    redirect_id: current.id,
    old_source_path: current.source_path,
    new_source_path: sourcePath.path,
    old_target_path: current.target_path,
    new_target_path: targetPath,
    old_status_code: current.status_code,
    new_status_code: params.statusCode || current.status_code,
    changed_by: params.actorAdminUserId,
  });

  const updates: Record<string, unknown> = {
    source_path: sourcePath.path,
    target_path: targetPath,
    updated_at: new Date().toISOString(),
  };
  if (params.statusCode !== undefined) updates.status_code = params.statusCode;
  if (params.isActive !== undefined) updates.is_active = params.isActive;
  if (params.description !== undefined) updates.description = params.description?.trim() || null;

  const { data, error } = await db
    .from("content_redirects")
    .update(updates)
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.id)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Could not update redirect");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "redirect.updated",
    entityType: "redirect",
    entityId: data.id,
    metadata: updates,
  });

  return data as RedirectRow;
}

export async function deleteRedirect(params: {
  workspaceId: string;
  actorAdminUserId: string;
  id: string;
}): Promise<{ ok: true }> {
  const db = createServiceRoleClient();
  const { error } = await db
    .from("content_redirects")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.id);

  if (error) throw new Error(error.message);

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "redirect.deleted",
    entityType: "redirect",
    entityId: params.id,
    metadata: {},
  });

  return { ok: true };
}

/**
 * Bulk Import with Dry-Run validation:
 * Validates syntax, normalizes paths, detects duplicate source paths in import,
 * and checks circular loops against existing redirects.
 */
export async function importRedirects(params: {
  workspaceId: string;
  actorAdminUserId: string;
  items: BulkImportItem[];
  dryRun?: boolean;
}): Promise<BulkImportReport> {
  const report: BulkImportReport = {
    dryRun: params.dryRun ?? true,
    totalRows: params.items.length,
    validCount: 0,
    errorCount: 0,
    errors: [],
    imported: [],
  };

  const validItems: {
    sourcePath: string;
    targetPath: string;
    statusCode: 301 | 302 | 307 | 308;
    locale: string | null;
    description: string | null;
  }[] = [];

  const seenSources = new Set<string>();

  for (let i = 0; i < params.items.length; i++) {
    const item = params.items[i];
    const normSource = normalizePath(item.sourcePath);
    if (!normSource.ok) {
      report.errorCount++;
      report.errors.push({ row: i + 1, sourcePath: item.sourcePath, error: normSource.error });
      continue;
    }

    if (seenSources.has(normSource.path)) {
      report.errorCount++;
      report.errors.push({ row: i + 1, sourcePath: item.sourcePath, error: "Duplicate source path in import payload" });
      continue;
    }
    seenSources.add(normSource.path);

    const loopCheck = await detectRedirectLoop(params.workspaceId, normSource.path, item.targetPath, item.locale);
    if (loopCheck.isLoop) {
      report.errorCount++;
      report.errors.push({ row: i + 1, sourcePath: item.sourcePath, error: loopCheck.error || "Circular loop" });
      continue;
    }

    const code = Number(item.statusCode) || 301;
    const validCodes = [301, 302, 307, 308];
    const statusCode = (validCodes.includes(code) ? code : 301) as 301 | 302 | 307 | 308;

    validItems.push({
      sourcePath: normSource.path,
      targetPath: item.targetPath.trim(),
      statusCode,
      locale: item.locale || null,
      description: item.description?.trim() || null,
    });
    report.validCount++;
  }

  if (!report.dryRun && validItems.length > 0) {
    const db = createServiceRoleClient();
    const rows = validItems.map((v) => ({
      workspace_id: params.workspaceId,
      locale: v.locale,
      source_path: v.sourcePath,
      target_path: v.targetPath,
      status_code: v.statusCode,
      is_active: true,
      description: v.description,
      created_by: params.actorAdminUserId,
    }));

    const { data, error } = await db
      .from("content_redirects")
      .upsert(rows, { onConflict: "workspace_id,locale,source_path" })
      .select();

    if (error) throw new Error(error.message);
    report.imported = (data as RedirectRow[]) ?? [];

    await logPlatformEvent({
      workspaceId: params.workspaceId,
      actorAdminUserId: params.actorAdminUserId,
      action: "redirect.bulk_imported",
      entityType: "redirect",
      entityId: params.workspaceId,
      metadata: { total: validItems.length },
    });
  }

  return report;
}
