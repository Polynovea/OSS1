import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { exportEntries } from "@/lib/content/entryService";
import { getModel } from "@/lib/schema/modelService";
import { canActorOperateModel } from "@/lib/schema/modelAccess";

const response = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;

  const modelId = new URL(req.url).searchParams.get("modelId");
  if (!modelId) return response(false, null, "modelId is required", 400);
  const model = await getModel(auth.data!.actor.workspaceId, modelId);
  if (!model) return response(false, null, "Model not found", 404);
  const access = await canActorOperateModel(auth.data!.actor, model, "read");
  if (!access.allowed) return response(false, null, access.error, access.status);

  const result = await exportEntries(auth.data!.actor.workspaceId, modelId);
  return result.ok ? response(true, result.data, null) : response(false, null, result.error, result.status);
}
