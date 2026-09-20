import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { queueWebhookEvent } from "@/lib/content/webhookService";

export interface PlatformAuditPayload {
  workspaceId: string;
  actorAdminUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Workspace-scoped audit trail for the new lib/platform/* + lib/schema/*
 * subsystems (schema.*, and eventually content.entry.* / release.* etc.).
 * Deliberately separate from lib/admin/audit.ts's admin_activity_log,
 * which keeps logging the existing CMS/Content Tracking actions unchanged
 * — not merged in Phase 1 to avoid touching working code unnecessarily.
 */
export async function logPlatformEvent(payload: PlatformAuditPayload): Promise<void> {
  try {
    const db = createServiceRoleClient();
    await db.from("platform_audit_events").insert({
      workspace_id: payload.workspaceId,
      actor_admin_user_id: payload.actorAdminUserId,
      action: payload.action,
      entity_type: payload.entityType,
      entity_id: payload.entityId ?? null,
      before_json: payload.beforeJson ?? null,
      after_json: payload.afterJson ?? null,
      metadata_json: payload.metadata ?? {},
    });
    await queueWebhookEvent({ workspaceId: payload.workspaceId, eventType: payload.action, eventId: crypto.randomUUID(), payload: { entityType: payload.entityType, entityId: payload.entityId ?? null, metadata: payload.metadata ?? {} } });
  } catch {
    // Audit logging must never break the primary action — same convention
    // as lib/admin/audit.ts's logAdminActivity.
  }
}
