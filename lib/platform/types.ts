export interface Workspace {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  default_locale: string;
  timezone: string;
  settings_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type EntityType = "brand" | "site" | "client" | "publication" | "project" | "other";

export interface PlatformEntity {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  type: EntityType;
  status: "active" | "archived";
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Role {
  id: string;
  workspace_id: string;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  admin_user_id: string;
  status: "active" | "invited" | "suspended";
}

/**
 * The resolved permission context for one authenticated identity acting
 * within one workspace. This is the boundary every new (Milestone C+) route
 * checks against — never `admin_users`/`roles`/`role_permissions` directly.
 * See docs/adr/ADR-013-cms-actor-vs-external-identity.md.
 */
export interface CmsActor {
  adminUserId: string;
  workspaceId: string;
  /** Membership backing the actor in the selected workspace. */
  workspaceMemberId: string | null;
  roleKeys: string[];
  permissions: Set<string>;
  /** Reserved compatibility flag; current actors always use membership-backed authorization. */
  isMasterBypass: boolean;
}
