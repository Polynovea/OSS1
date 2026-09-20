import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getEntry } from "@/lib/content/entryService";
import { logPlatformEvent } from "@/lib/platform/audit";

export type CollaborationResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function requireEntry(workspaceId: string, entryId: string) {
  const entry = await getEntry(workspaceId, entryId);
  return entry ? { ok: true as const, entry } : { ok: false as const, error: "Entry not found in this workspace", status: 404 };
}

export async function getEntryCollaboration(workspaceId: string, entryId: string): Promise<CollaborationResult<unknown>> {
  const found = await requireEntry(workspaceId, entryId); if (!found.ok) return found;
  const db = createServiceRoleClient();
  const [assignments, comments, watchers] = await Promise.all([
    db.from("content_assignments").select("*").eq("workspace_id", workspaceId).eq("entry_id", entryId).order("due_at", { ascending: true }),
    db.from("content_comments").select("*, content_comment_mentions(mentioned_admin_user_id)").eq("workspace_id", workspaceId).eq("entry_id", entryId).order("created_at", { ascending: true }),
    db.from("content_entry_watchers").select("admin_user_id").eq("workspace_id", workspaceId).eq("entry_id", entryId),
  ]);
  return { ok: true, data: { assignments: assignments.data ?? [], comments: comments.data ?? [], watcherAdminUserIds: (watchers.data ?? []).map((row) => row.admin_user_id) } };
}

export async function assignEntry(params: { workspaceId: string; entryId: string; actorId: string; assigneeId: string; role: "owner" | "author" | "reviewer" | "approver"; dueAt?: string | null; note?: string | null }): Promise<CollaborationResult<unknown>> {
  const found = await requireEntry(params.workspaceId, params.entryId); if (!found.ok) return found;
  if (params.dueAt && Number.isNaN(Date.parse(params.dueAt))) return { ok: false, error: "dueAt must be a valid ISO date", status: 400 };
  const db = createServiceRoleClient();
  const { data: member } = await db.from("workspace_members").select("id").eq("workspace_id", params.workspaceId).eq("admin_user_id", params.assigneeId).eq("status", "active").maybeSingle();
  if (!member) return { ok: false, error: "Assignee is not an active member of this workspace", status: 400 };
  const { data, error } = await db.from("content_assignments").upsert({ workspace_id: params.workspaceId, entry_id: params.entryId, assigned_to_admin_user_id: params.assigneeId, assigned_by_admin_user_id: params.actorId, role: params.role, due_at: params.dueAt ?? null, note: params.note?.trim() || null, status: "active", updated_at: new Date().toISOString() }, { onConflict: "entry_id,assigned_to_admin_user_id,role" }).select().single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save assignment", status: 500 };
  await db.from("editorial_notifications").insert({ workspace_id: params.workspaceId, recipient_admin_user_id: params.assigneeId, entry_id: params.entryId, kind: "assignment", payload_json: { role: params.role, dueAt: params.dueAt ?? null } });
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "content.entry.assigned", entityType: "content_entry", entityId: params.entryId, metadata: { assigneeId: params.assigneeId, role: params.role } });
  return { ok: true, data };
}

export async function addComment(params: { workspaceId: string; entryId: string; actorId: string; body: string; parentCommentId?: string | null; mentionIds?: string[] }): Promise<CollaborationResult<unknown>> {
  const found = await requireEntry(params.workspaceId, params.entryId); if (!found.ok) return found;
  const body = params.body.trim(); if (!body || body.length > 8000) return { ok: false, error: "Comment must contain 1–8000 characters", status: 400 };
  const db = createServiceRoleClient();
  if (params.parentCommentId) { const { data: parent } = await db.from("content_comments").select("id").eq("id", params.parentCommentId).eq("workspace_id", params.workspaceId).eq("entry_id", params.entryId).maybeSingle(); if (!parent) return { ok: false, error: "Parent comment is not on this entry", status: 400 }; }
  const { data, error } = await db.from("content_comments").insert({ workspace_id: params.workspaceId, entry_id: params.entryId, entry_version_id: found.entry.current_draft_version_id, parent_comment_id: params.parentCommentId ?? null, author_admin_user_id: params.actorId, body }).select().single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not add comment", status: 500 };
  const mentionIds = [...new Set((params.mentionIds ?? []).filter(Boolean))].filter((id) => id !== params.actorId);
  if (mentionIds.length) { await db.from("content_comment_mentions").insert(mentionIds.map((mentioned_admin_user_id) => ({ comment_id: data.id, mentioned_admin_user_id }))); await db.from("editorial_notifications").insert(mentionIds.map((recipient_admin_user_id) => ({ workspace_id: params.workspaceId, recipient_admin_user_id, entry_id: params.entryId, kind: "mention", payload_json: { commentId: data.id } }))); }
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "content.entry.comment_added", entityType: "content_entry", entityId: params.entryId, metadata: { commentId: data.id, mentions: mentionIds.length } });
  return { ok: true, data };
}

export async function setWatch(params: { workspaceId: string; entryId: string; actorId: string; watching: boolean }): Promise<CollaborationResult<{ watching: boolean }>> {
  const found = await requireEntry(params.workspaceId, params.entryId); if (!found.ok) return found;
  const db = createServiceRoleClient();
  if (params.watching) await db.from("content_entry_watchers").upsert({ workspace_id: params.workspaceId, entry_id: params.entryId, admin_user_id: params.actorId }, { onConflict: "entry_id,admin_user_id" });
  else await db.from("content_entry_watchers").delete().eq("workspace_id", params.workspaceId).eq("entry_id", params.entryId).eq("admin_user_id", params.actorId);
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: params.watching ? "content.entry.watched" : "content.entry.unwatched", entityType: "content_entry", entityId: params.entryId });
  return { ok: true, data: { watching: params.watching } };
}

export async function resolveComment(params: { workspaceId: string; entryId: string; commentId: string; actorId: string }): Promise<CollaborationResult<unknown>> {
  const found = await requireEntry(params.workspaceId, params.entryId); if (!found.ok) return found;
  const db = createServiceRoleClient();
  const { data, error } = await db.from("content_comments").update({ status: "resolved", resolved_by_admin_user_id: params.actorId, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", params.commentId).eq("workspace_id", params.workspaceId).eq("entry_id", params.entryId).eq("status", "open").select().maybeSingle();
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!data) return { ok: false, error: "Open comment not found on this entry", status: 404 };
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "content.entry.comment_resolved", entityType: "content_entry", entityId: params.entryId, metadata: { commentId: params.commentId } });
  return { ok: true, data };
}

export async function getMyEditorialQueue(workspaceId: string, actorId: string): Promise<CollaborationResult<unknown>> {
  const db = createServiceRoleClient();
  const [assignments, releaseAssignments, notifications] = await Promise.all([
    db.from("content_assignments").select("id, entry_id, role, due_at, note, created_at, content_entries(status, content_models(name, api_key))").eq("workspace_id", workspaceId).eq("assigned_to_admin_user_id", actorId).eq("status", "active").order("due_at", { ascending: true }),
    db.from("release_assignments").select("id, release_id, role, due_at, note, created_at, releases(name,status,scheduled_for)").eq("workspace_id", workspaceId).eq("assigned_to_admin_user_id", actorId).eq("status", "active").order("due_at", { ascending: true }),
    db.from("editorial_notifications").select("id, entry_id, release_id, kind, payload_json, created_at").eq("workspace_id", workspaceId).eq("recipient_admin_user_id", actorId).is("read_at", null).order("created_at", { ascending: false }).limit(50),
  ]);
  return { ok: true, data: { assignments: assignments.data ?? [], releaseAssignments: releaseAssignments.data ?? [], notifications: notifications.data ?? [] } };
}

export async function markEditorialNotificationsRead(params: { workspaceId: string; actorId: string; notificationIds?: string[]; all?: boolean }): Promise<CollaborationResult<{ updated: number }>> {
  const db = createServiceRoleClient();
  let query = db.from("editorial_notifications").update({ read_at: new Date().toISOString() }).eq("workspace_id", params.workspaceId).eq("recipient_admin_user_id", params.actorId).is("read_at", null);
  if (!params.all) {
    const ids = [...new Set((params.notificationIds ?? []).filter(Boolean))].slice(0, 100);
    if (!ids.length) return { ok: false, error: "notificationIds is required unless all=true", status: 400 };
    query = query.in("id", ids);
  }
  const { data, error } = await query.select("id");
  if (error) return { ok: false, error: error.message, status: 500 };
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "editorial.notifications.read", entityType: "editorial_notification", entityId: null, metadata: { updated: data?.length ?? 0, all: Boolean(params.all) } });
  return { ok: true, data: { updated: data?.length ?? 0 } };
}
