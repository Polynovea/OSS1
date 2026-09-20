import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { deleteSavedSearch } from "@/lib/content/searchService";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    const data = await deleteSavedSearch({ workspaceId: auth.data!.actor.workspaceId, ownerId: auth.data!.actor.adminUserId, id });
    return NextResponse.json({ success: true, data, error: null });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not delete saved search" }, { status: 400 });
  }
}
