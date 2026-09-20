import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { bulkArchiveEntries, bulkUnarchiveEntries } from "@/lib/content/entryService";
import { canActorOperateEntry } from "@/lib/schema/modelAccess";

const response = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

const BULK_ACTIONS = ["archive", "unarchive"] as const;

/** Bulk record operations (V2 §13 Phase 3) — each id still goes through the same single-entry service call and audit event; this endpoint just sequences them under one request. */
export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.archive" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const ids: unknown = body.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
      return response(false, null, "ids must be a non-empty array of entry ids", 400);
    }
    if (!BULK_ACTIONS.includes(body.action)) {
      return response(false, null, `action must be one of: ${BULK_ACTIONS.join(", ")}`, 400);
    }

    const workspaceId = auth.data!.actor.workspaceId;
    const actorAdminUserId = auth.data!.actor.adminUserId;
    const accessChecks = await Promise.all(ids.map((id) => canActorOperateEntry(auth.data!.actor, id, "archive")));
    const denied = accessChecks.find((access) => !access.allowed);
    if (denied && !denied.allowed) return response(false, null, denied.error, denied.status);
    const results = body.action === "archive"
      ? await bulkArchiveEntries({ workspaceId, entryIds: ids, actorAdminUserId })
      : await bulkUnarchiveEntries({ workspaceId, entryIds: ids, actorAdminUserId });

    return response(true, { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }, null);
  } catch (error) {
    return response(false, null, error instanceof Error ? error.message : "Invalid bulk request", 400);
  }
}
