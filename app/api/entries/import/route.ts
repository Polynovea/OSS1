import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { importEntries } from "@/lib/content/entryService";
import { getModel } from "@/lib/schema/modelService";
import { canActorOperateModel } from "@/lib/schema/modelAccess";

const response = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

/** Always requires content.entry.create, even for a dry run — a dry run's DB reads are workspace-scoped in the same way a real write would be. */
export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.create" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    if (!Array.isArray(body.rows) || typeof body.modelId !== "string") {
      return response(false, null, "modelId and rows[] are required", 400);
    }
    const model = await getModel(auth.data!.actor.workspaceId, body.modelId);
    if (!model) return response(false, null, "Model not found", 404);
    const access = await canActorOperateModel(auth.data!.actor, model, "create");
    if (!access.allowed) return response(false, null, access.error, access.status);
    const result = await importEntries({
      workspaceId: auth.data!.actor.workspaceId,
      modelId: body.modelId,
      rows: body.rows,
      dryRun: body.dryRun !== false,
      actorAdminUserId: auth.data!.actor.adminUserId,
    });
    return result.ok ? response(true, result.data, null) : response(false, null, result.error, result.status);
  } catch (error) {
    return response(false, null, error instanceof Error ? error.message : "Invalid import request", 400);
  }
}
