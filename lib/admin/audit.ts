import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import type { AdminUser } from "@/lib/admin/types";

interface AuditPayload {
  actor: AdminUser;
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logAdminActivity(payload: AuditPayload): Promise<void> {
  try {
    const db = createServiceRoleClient();
    await db.from("admin_activity_log").insert({
      actor_email: payload.actor.email,
      actor_username: payload.actor.username,
      actor_role: payload.actor.role,
      action: payload.action,
      target_type: payload.targetType,
      target_id: payload.targetId ?? null,
      target_label: payload.targetLabel ?? null,
      details: payload.details ?? {},
    });
  } catch {
    // Audit logging must never break the primary action.
  }
}
