import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import type { AdminRole } from "@/lib/admin/types";

const ROLE_TO_WORKSPACE_ROLE: Record<AdminRole, "owner" | "admin" | "editor" | "viewer"> = {
  master: "owner",
  admin: "admin",
  editor: "editor",
  viewer: "viewer",
};

export interface WorkspaceMembershipProfile {
  id: string;
  role: AdminRole;
  is_active: boolean;
}

/**
 * Keeps the legacy global admin profile aligned with the seeded default
 * workspace authorization model. System-role assignments are canonical for the
 * profile's global role; non-system/custom workspace roles are preserved.
 */
export async function syncDefaultWorkspaceMembership(
  profile: WorkspaceMembershipProfile,
  db: ReturnType<typeof createServiceRoleClient> = createServiceRoleClient(),
  workspaceSlug = process.env.POLYNOVEA_DEFAULT_WORKSPACE_SLUG?.trim().toLowerCase() || "polynovea",
): Promise<void> {
  const { data: workspace, error: workspaceError } = await db
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .single();
  if (workspaceError || !workspace) {
    throw new Error(workspaceError?.message || `Default workspace '${workspaceSlug}' not found`);
  }

  const { data: member, error: memberError } = await db
    .from("workspace_members")
    .upsert(
      {
        workspace_id: workspace.id,
        admin_user_id: profile.id,
        status: profile.is_active ? "active" : "suspended",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,admin_user_id" },
    )
    .select("id")
    .single();
  if (memberError || !member) {
    throw new Error(memberError?.message || "Failed to synchronize workspace membership");
  }

  const { data: systemRoles, error: rolesError } = await db
    .from("roles")
    .select("id, key")
    .eq("workspace_id", workspace.id)
    .eq("is_system", true);
  if (rolesError) throw new Error(rolesError.message);

  const targetRoleKey = ROLE_TO_WORKSPACE_ROLE[profile.role];
  const targetRole = (systemRoles ?? []).find((role: { id: string; key: string }) => role.key === targetRoleKey);
  if (!targetRole) throw new Error(`Default workspace role '${targetRoleKey}' not found`);

  const systemRoleIds = (systemRoles ?? []).map((role: { id: string }) => role.id);
  if (systemRoleIds.length > 0) {
    const { error: deleteError } = await db
      .from("member_roles")
      .delete()
      .eq("workspace_member_id", member.id)
      .in("role_id", systemRoleIds);
    if (deleteError) throw new Error(deleteError.message);
  }

  const { error: insertError } = await db
    .from("member_roles")
    .upsert(
      { workspace_member_id: member.id, role_id: targetRole.id },
      { onConflict: "workspace_member_id,role_id" },
    );
  if (insertError) throw new Error(insertError.message);
}
