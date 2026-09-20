import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { updateRoutePath, deleteRoute } from "@/lib/routing/routeService";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "routing.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const { data } = await createServiceRoleClient()
    .from("content_routes")
    .select("*")
    .eq("workspace_id", auth.data!.actor.workspaceId)
    .eq("id", id)
    .maybeSingle();

  if (!data) return respond(false, null, "Route not found", 404);
  return respond(true, data, null);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "routing.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const body = await req.json();
    if (!body.path) return respond(false, null, "Path is required", 400);

    const result = await updateRoutePath({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      routeId: id,
      newPath: body.path,
      title: body.title,
      parentRouteId: body.parentRouteId,
      orderIndex: body.orderIndex,
    });

    return respond(true, result, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not update route", 400);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "routing.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    await deleteRoute({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      routeId: id,
    });
    return respond(true, { ok: true }, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not delete route", 400);
  }
}
