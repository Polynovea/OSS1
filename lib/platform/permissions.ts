import { requireAdminRequest } from "@/lib/admin/serverAccess";
import type { AdminUser } from "@/lib/admin/types";
import { getDefaultWorkspace, getWorkspaceById, resolveActor } from "@/lib/platform/actor";
import type { CmsActor, Workspace } from "@/lib/platform/types";
import type { PermissionKey } from "@/lib/platform/permissionCatalog";

export function hasPermission(actor: CmsActor | null | undefined, permission: PermissionKey): boolean {
  if (!actor) return false;
  return actor.permissions.has(permission);
}

const ts = () => new Date().toISOString();

function deniedResponse(message: string, status: number): Response {
  return Response.json({ success: false, data: null, error: message, timestamp: ts() }, { status });
}

export interface PlatformRequestContext {
  actor: CmsActor;
  adminUser: AdminUser;
}

/**
 * The Milestone C+ equivalent of lib/admin/serverAccess.ts's
 * requireAdminRequest — built ON TOP of it (not a parallel reimplementation
 * of token validation) so every existing route keeps using
 * requireAdminRequest unchanged, while new generic-platform routes (content
 * models, entries, etc.) use this instead.
 */
export async function requirePlatformAccess(
  req: Request,
  options: { permission: PermissionKey | PermissionKey[] },
): Promise<{ data?: PlatformRequestContext; error?: Response }> {
  const auth = await requireAdminRequest(req);
  if (auth.error) return { error: auth.error };

  const explicitWorkspaceId = req.headers.get("x-workspace-id");
  let workspace: Workspace | null = null;
  if (explicitWorkspaceId) {
    workspace = await getWorkspaceById(explicitWorkspaceId);
    if (!workspace) {
      return { error: deniedResponse("Workspace not found", 404) };
    }
  } else {
    workspace = await getDefaultWorkspace();
  }

  const actor = await resolveActor(auth.data!.profile, workspace);

  if (!actor) {
    return { error: deniedResponse("Not a member of this workspace", 403) };
  }

  const required = Array.isArray(options.permission) ? options.permission : [options.permission];
  if (!required.some((permission) => hasPermission(actor, permission))) {
    return { error: deniedResponse("Missing required permission", 403) };
  }

  return { data: { actor, adminUser: auth.data!.profile } };
}
