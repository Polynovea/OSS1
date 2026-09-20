import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getLocalizationStatus, reviewTranslation, setTranslation } from "@/lib/content/localizationService";
import { canActorOperateEntry } from "@/lib/schema/modelAccess";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  const { id } = await params;
  const access = await canActorOperateEntry(auth.data!.actor, id, "read");
  if (!access.allowed) return respond(false, null, access.error, access.status);
  const data = await getLocalizationStatus(auth.data!.actor.workspaceId, id);
  return data ? respond(true, data, null) : respond(false, null, "Entry not found", 404);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.edit" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const access = await canActorOperateEntry(auth.data!.actor, id, "edit");
    if (!access.allowed) return respond(false, null, access.error, access.status);
    const body = await req.json();
    if (!body.locale) return respond(false, null, "locale is required", 400);
    if (body.action === "review") {
      return respond(true, await reviewTranslation({
        workspaceId: auth.data!.actor.workspaceId,
        actorId: auth.data!.actor.adminUserId,
        sourceEntryId: id,
        locale: body.locale,
      }), null);
    }
    return respond(true, await setTranslation({
      workspaceId: auth.data!.actor.workspaceId,
      actorId: auth.data!.actor.adminUserId,
      sourceEntryId: id,
      locale: body.locale,
      translatedEntryId: body.translatedEntryId ?? null,
      markReviewed: body.markReviewed,
    }), null);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not update translation lifecycle", 400);
  }
}
