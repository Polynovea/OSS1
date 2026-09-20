import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listSavedSearches, saveSearch } from "@/lib/content/searchService";

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  try {
    const data = await listSavedSearches(auth.data!.actor.workspaceId, auth.data!.actor.adminUserId);
    return NextResponse.json({ success: true, data, error: null });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not list saved searches" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const data = await saveSearch({
      workspaceId: auth.data!.actor.workspaceId,
      ownerId: auth.data!.actor.adminUserId,
      name: String(body.name || ""),
      query: body.query && typeof body.query === "object" ? body.query : {},
      shared: Boolean(body.shared),
    });
    return NextResponse.json({ success: true, data, error: null }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not save search" }, { status: 400 });
  }
}
