import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getSiteTree } from "@/lib/routing/routeService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "routing.read" });
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const locale = searchParams.get("locale") || "en";

  try {
    const tree = await getSiteTree(auth.data!.actor.workspaceId, locale);
    return respond(true, tree, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not load site tree", 500);
  }
}
