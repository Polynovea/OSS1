import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import type { AdminUser } from "@/lib/admin/types";
import type { CmsActor, Workspace } from "@/lib/platform/types";

/**
 * Phase 1 is single-workspace. This resolves the one seeded "polynovea"
 * workspace by slug rather than hardcoding its id anywhere. Multi-workspace
 * selection (per-request workspace context) is Phase 2+ scope.
 */
export async function getDefaultWorkspace(): Promise<Workspace> {
  const db = createServiceRoleClient();
  const { data, error } = await db
    .from("workspaces")
    .select("*")
    .eq("slug", "polynovea")
    .single();

  if (error || !data) {
    throw new Error(
      "Default workspace not found — has supabase/migrations/0007_workspace_core.sql been applied?",
    );
  }
  return data as Workspace;
}

export async function getWorkspaceById(workspaceId: string): Promise<Workspace | null> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("workspaces")
    .select("*")
    .eq("id", workspaceId)
    .maybeSingle();

  return (data as Workspace) ?? null;
}

/**
 * Resolves an authenticated CMS actor for one admin identity within one
 * workspace. This is the one place that reads workspace_members/
 * member_roles/roles/role_permissions — nothing else should query those
 * tables directly (see ADR-013).
 *
 * Every identity, including the first owner/master, must have an auditable
 * admin_users row and active workspace membership. First-admin setup is
 * performed by the server-only bootstrap command rather than a code bypass.
 */
export async function resolveActor(
  adminUser: Pick<AdminUser, "id" | "email">,
  workspace: Workspace,
): Promise<CmsActor | null> {
  const db = createServiceRoleClient();

  const { data: member, error: memberError } = await db
    .from("workspace_members")
    .select("id, status")
    .eq("workspace_id", workspace.id)
    .eq("admin_user_id", adminUser.id)
    .maybeSingle();

  if (memberError || !member || member.status !== "active") {
    return null;
  }

  const { data: roleRows } = await db
    .from("member_roles")
    .select("role_id, roles(key)")
    .eq("workspace_member_id", member.id);

  const roleIds = (roleRows ?? []).map((row: { role_id: string }) => row.role_id);
  const roleKeys = (roleRows ?? [])
    .map((row: { roles: { key: string } | { key: string }[] | null }) =>
      Array.isArray(row.roles) ? row.roles[0]?.key : row.roles?.key,
    )
    .filter((key): key is string => Boolean(key));

  if (roleIds.length === 0) {
    return {
      adminUserId: adminUser.id,
      workspaceId: workspace.id,
      workspaceMemberId: member.id,
      roleKeys: [],
      permissions: new Set(),
      isMasterBypass: false,
    };
  }

  const { data: permissionRows } = await db
    .from("role_permissions")
    .select("permission_key")
    .in("role_id", roleIds);

  const permissions = new Set(
    (permissionRows ?? []).map((row: { permission_key: string }) => row.permission_key),
  );

  return {
    adminUserId: adminUser.id,
    workspaceId: workspace.id,
    workspaceMemberId: member.id,
    roleKeys,
    permissions,
    isMasterBypass: false,
  };
}

export interface WorkspaceRole {
  key: string;
  name: string;
  description: string | null;
}

/**
 * Lists a workspace's assignable roles (key/name/description only — no
 * membership or permission data). Used by the Visual Database Studio's
 * per-model permission-policy editor (ADR-016) so a schema author picks
 * from real role keys instead of typing free text that could drift from
 * what `resolveActor` actually grants.
 */
export async function listWorkspaceRoles(workspaceId: string): Promise<WorkspaceRole[]> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("roles")
    .select("key, name, description")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  return data ?? [];
}

export interface WorkspaceCollaborator { id: string; displayName: string; email: string; }
export async function listWorkspaceCollaborators(workspaceId: string): Promise<WorkspaceCollaborator[]> {
  const { data } = await createServiceRoleClient().from("workspace_members").select("admin_user_id, admin_users(id, display_name, email)").eq("workspace_id", workspaceId).eq("status", "active");
  return (data ?? []).flatMap((row: { admin_users: { id: string; display_name: string | null; email: string } | { id: string; display_name: string | null; email: string }[] | null }) => {
    const user = Array.isArray(row.admin_users) ? row.admin_users[0] : row.admin_users;
    return user ? [{ id: user.id, displayName: user.display_name || user.email, email: user.email }] : [];
  });
}
