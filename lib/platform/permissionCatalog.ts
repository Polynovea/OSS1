/**
 * The permission namespace, mirroring the `permissions` table seeded by
 * supabase/migrations/0007_workspace_core.sql and 0024_permissions_phase7.sql.
 */
export const PERMISSION_KEYS = [
  "workspace.read",
  "workspace.manage",
  "content.model.read",
  "content.model.manage",
  "content.entry.read",
  "content.entry.create",
  "content.entry.edit",
  "content.entry.publish",
  "content.entry.archive",
  "content.entry.delete",
  "media.read",
  "media.upload",
  "media.manage",
  "schema.read",
  "schema.manage",
  "users.read",
  "users.manage",
  // Phase 7 Information Architecture
  "taxonomy.read",
  "taxonomy.manage",
  "routing.read",
  "routing.manage",
  "redirect.read",
  "redirect.manage",
  "navigation.read",
  "navigation.manage",
  // Phase 12.5 Environments / Connections / Guided Provisioning
  "environment.read",
  "environment.manage",
  "environment.provision",
  "connection.read",
  "connection.manage",
  "connection.verify",
  "secret.manage",
  "infrastructure.diagnose",
  "infrastructure.backup",
  "infrastructure.restore",
  "infrastructure.upgrade",
  "schema.promote",
  "deployment.manage",
  "website.manage",
  "approval.review",
  // Phase 12.75 Deterministic Operational Intelligence
  "operational_intelligence.read",
  "operational_intelligence.manage",
  "operational_intelligence.execute",
  "operational_intelligence.policy",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
