import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { createSavedEntryView, listSavedEntryViews } from "@/lib/content/savedViewService";
import { getModel } from "@/lib/schema/modelService";
import { canActorOperateModel } from "@/lib/schema/modelAccess";

const response = (success: boolean, data: unknown, error: string | null, status = 200) => NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  return response(true, await listSavedEntryViews(auth.data!.actor.workspaceId, auth.data!.actor.adminUserId), null);
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const modelId = typeof body.filters?.modelId === "string" ? body.filters.modelId : null;
    if (modelId) {
      const model = await getModel(auth.data!.actor.workspaceId, modelId);
      if (!model) return response(false, null, "Model not found", 404);
      const access = await canActorOperateModel(auth.data!.actor, model, "read");
      if (!access.allowed) return response(false, null, access.error, access.status);
    }
    const result = await createSavedEntryView({ workspaceId: auth.data!.actor.workspaceId, actorAdminUserId: auth.data!.actor.adminUserId, name: body.name, filters: body.filters });
    return result.ok ? response(true, result.data, null, 201) : response(false, null, result.error, result.status);
  } catch (error) {
    return response(false, null, error instanceof Error ? error.message : "Invalid saved view", 400);
  }
}
