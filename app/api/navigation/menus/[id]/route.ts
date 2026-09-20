import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getMenu, saveMenuDraft, listMenuVersions } from "@/lib/navigation/navigationService";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "navigation.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const menu = await getMenu(auth.data!.actor.workspaceId, id);
  if (!menu) return respond(false, null, "Navigation menu not found", 404);

  const versions = await listMenuVersions(auth.data!.actor.workspaceId, menu.id);
  const currentDraft = versions.find((v) => v.id === menu.current_draft_version_id);
  const currentPublished = versions.find((v) => v.id === menu.published_version_id);

  return respond(true, { menu, versions, currentDraft, currentPublished }, null);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "navigation.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const body = await req.json();
    const menu = await getMenu(auth.data!.actor.workspaceId, id);
    if (!menu) return respond(false, null, "Menu not found", 404);

    // If metadata update
    if (body.name || body.description !== undefined) {
      await createServiceRoleClient()
        .from("navigation_menus")
        .update({
          name: body.name ? body.name.trim() : menu.name,
          description: body.description !== undefined ? body.description?.trim() || null : menu.description,
          updated_at: new Date().toISOString(),
        })
        .eq("id", menu.id);
    }

    // If draft items update
    if (Array.isArray(body.items)) {
      const version = await saveMenuDraft({
        workspaceId: auth.data!.actor.workspaceId,
        actorAdminUserId: auth.data!.actor.adminUserId,
        menuId: menu.id,
        items: body.items,
        changeSummary: body.changeSummary,
      });
      return respond(true, { menu, version }, null);
    }

    const refreshed = await getMenu(auth.data!.actor.workspaceId, id);
    return respond(true, { menu: refreshed }, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not update navigation menu", 400);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "navigation.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const db = createServiceRoleClient();
  const { error } = await db
    .from("navigation_menus")
    .delete()
    .eq("workspace_id", auth.data!.actor.workspaceId)
    .eq("id", id);

  if (error) return respond(false, null, error.message, 400);

  await logPlatformEvent({
    workspaceId: auth.data!.actor.workspaceId,
    actorAdminUserId: auth.data!.actor.adminUserId,
    action: "navigation.menu.deleted",
    entityType: "navigation_menu",
    entityId: id,
    metadata: {},
  });

  return respond(true, { ok: true }, null);
}
