import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { createEntry, listEntries } from "@/lib/content/entryService";
import { getModel, listModels } from "@/lib/schema/modelService";
import { canActorOperateModel } from "@/lib/schema/modelAccess";

const response = (success: boolean, data: unknown, error: string | null, status = 200) => NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  const modelId = new URL(req.url).searchParams.get("modelId") ?? undefined;
  if (modelId) {
    const model = await getModel(auth.data!.actor.workspaceId, modelId);
    if (!model) return response(false, null, "Model not found", 404);
    const access = await canActorOperateModel(auth.data!.actor, model, "read");
    if (!access.allowed) return response(false, null, access.error, access.status);
    return response(true, await listEntries(auth.data!.actor.workspaceId, modelId), null);
  }
  const [entries, models] = await Promise.all([
    listEntries(auth.data!.actor.workspaceId),
    listModels(auth.data!.actor.workspaceId),
  ]);
  const readableModels = await Promise.all(models.map(async (model) => ({
    id: model.id,
    access: await canActorOperateModel(auth.data!.actor, model, "read"),
  })));
  const readableIds = new Set(readableModels.filter(({ access }) => access.allowed).map(({ id }) => id));
  return response(true, entries.filter((entry) => readableIds.has(entry.content_model_id)), null);
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.create" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const model = await getModel(auth.data!.actor.workspaceId, body.modelId);
    if (!model) return response(false, null, "Model not found", 404);
    const access = await canActorOperateModel(auth.data!.actor, model, "create");
    if (!access.allowed) return response(false, null, access.error, access.status);
    const result = await createEntry({ workspaceId: auth.data!.actor.workspaceId, modelId: body.modelId, data: body.data, locale: body.locale, changeSummary: body.changeSummary, actorAdminUserId: auth.data!.actor.adminUserId });
    return result.ok ? response(true, result.data, null, 201) : response(false, null, result.error, result.status);
  } catch (error) { return response(false, null, error instanceof Error ? error.message : "Invalid entry request", 400); }
}
