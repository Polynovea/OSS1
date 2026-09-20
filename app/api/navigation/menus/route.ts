import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listMenus, createMenu } from "@/lib/navigation/navigationService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "navigation.read" });
  if (auth.error) return auth.error;

  try {
    const menus = await listMenus(auth.data!.actor.workspaceId);
    return respond(true, menus, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not list menus", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "navigation.manage" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    if (!body.key || !body.name) {
      return respond(false, null, "key and name are required", 400);
    }

    const result = await createMenu({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      key: body.key,
      name: body.name,
      description: body.description,
      initialItems: body.items,
    });

    return respond(true, result, null, 201);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not create navigation menu", 400);
  }
}
