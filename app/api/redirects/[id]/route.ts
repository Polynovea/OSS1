import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getRedirect, updateRedirect, deleteRedirect } from "@/lib/routing/redirectService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "redirect.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const redirect = await getRedirect(auth.data!.actor.workspaceId, id);
  if (!redirect) return respond(false, null, "Redirect not found", 404);

  return respond(true, redirect, null);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "redirect.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const body = await req.json();
    const updated = await updateRedirect({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      id,
      sourcePath: body.sourcePath,
      targetPath: body.targetPath,
      statusCode: body.statusCode,
      isActive: body.isActive,
      description: body.description,
    });
    return respond(true, updated, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not update redirect", 400);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "redirect.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    await deleteRedirect({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      id,
    });
    return respond(true, { ok: true }, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not delete redirect", 400);
  }
}
