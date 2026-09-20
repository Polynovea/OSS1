import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listRoutes, registerRoute } from "@/lib/routing/routeService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "routing.read" });
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const locale = searchParams.get("locale") || undefined;

  try {
    const routes = await listRoutes(auth.data!.actor.workspaceId, locale);
    return respond(true, routes, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not list routes", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "routing.manage" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    if (!body.path) {
      return respond(false, null, "Path is required", 400);
    }

    const route = await registerRoute({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      locale: body.locale || "en",
      path: body.path,
      title: body.title,
      entryId: body.entryId,
      parentRouteId: body.parentRouteId,
      nodeType: body.nodeType,
      isCanonical: body.isCanonical,
      orderIndex: body.orderIndex,
      metadata: body.metadata,
    });

    return respond(true, route, null, 201);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not register route", 400);
  }
}
