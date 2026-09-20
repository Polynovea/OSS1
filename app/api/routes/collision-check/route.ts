import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { checkPathCollision } from "@/lib/routing/routeService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "routing.read" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    if (!body.path) return respond(false, null, "Path is required", 400);

    const result = await checkPathCollision({
      workspaceId: auth.data!.actor.workspaceId,
      locale: body.locale || "en",
      path: body.path,
      excludeRouteId: body.excludeRouteId,
    });

    return respond(true, result, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not check collision", 500);
  }
}
