import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getEntry, listEntryVersions, saveDraft } from "@/lib/content/entryService";
import { markTranslationsStale } from "@/lib/content/localizationService";
import { getModel } from "@/lib/schema/modelService";
import { canActorOperateModel } from "@/lib/schema/modelAccess";

const response = (success: boolean, data: unknown, error: string | null, status = 200) => NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  const { id } = await params; const entry = await getEntry(auth.data!.actor.workspaceId, id);
  if (!entry) return response(false, null, "Not found", 404);
  const model = await getModel(auth.data!.actor.workspaceId, entry.content_model_id);
  if (!model) return response(false, null, "Model not found", 404);
  const access = await canActorOperateModel(auth.data!.actor, model, "read");
  if (!access.allowed) return response(false, null, access.error, access.status);
  return response(true, { entry, versions: await listEntryVersions(id) }, null);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.edit" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params; const body = await req.json();
    const entry = await getEntry(auth.data!.actor.workspaceId, id);
    if (!entry) return response(false, null, "Not found", 404);
    const model = await getModel(auth.data!.actor.workspaceId, entry.content_model_id);
    if (!model) return response(false, null, "Model not found", 404);
    const access = await canActorOperateModel(auth.data!.actor, model, "edit");
    if (!access.allowed) return response(false, null, access.error, access.status);
    const result = await saveDraft({ workspaceId: auth.data!.actor.workspaceId, entryId: id, data: body.data, locale: body.locale, changeSummary: body.changeSummary, actorAdminUserId: auth.data!.actor.adminUserId, expectedVersionNumber: body.expectedVersionNumber }); if (result.ok) await markTranslationsStale(auth.data!.actor.workspaceId, id);
    if (!result.ok && "conflict" in result) return response(false, result.conflict, result.error, result.status);
    return result.ok ? response(true, result.data, null) : response(false, null, result.error, result.status);
  } catch (error) { return response(false, null, error instanceof Error ? error.message : "Invalid entry request", 400); }
}
