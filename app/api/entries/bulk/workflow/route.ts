import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { canActorOperateEntry } from "@/lib/schema/modelAccess";
import { transitionWorkflow } from "@/lib/content/workflowService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });
const ACTIONS = ["submit", "approve", "request_changes"] as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!Array.isArray(body.ids) || body.ids.length === 0 || !body.ids.every((id: unknown) => typeof id === "string")) {
      return respond(false, null, "ids must be a non-empty array of entry ids", 400);
    }
    if (!ACTIONS.includes(body.action)) return respond(false, null, `action must be one of: ${ACTIONS.join(", ")}`, 400);

    const permission = body.action === "submit" ? "content.entry.edit" : "content.entry.publish";
    const auth = await requirePlatformAccess(req, { permission });
    if (auth.error) return auth.error;
    const actor = auth.data!.actor;
    const operation = body.action === "submit" ? "edit" : "publish";
    const uniqueIds = [...new Set(body.ids as string[])].slice(0, 100);
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const id of uniqueIds) {
      const access = await canActorOperateEntry(actor, id, operation);
      if (!access.allowed) {
        results.push({ id, ok: false, error: access.error });
        continue;
      }
      const result = await transitionWorkflow({
        workspaceId: actor.workspaceId,
        entryId: id,
        actorId: actor.adminUserId,
        action: body.action,
        comment: typeof body.comment === "string" ? body.comment : undefined,
        canPublish: body.action !== "submit",
      });
      results.push(result.ok ? { id, ok: true } : { id, ok: false, error: result.error });
    }

    return respond(true, {
      action: body.action,
      results,
      succeeded: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
    }, null);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Bulk workflow action failed", 400);
  }
}
