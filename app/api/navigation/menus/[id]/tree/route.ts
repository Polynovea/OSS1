import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getResolvedNavigationTree } from "@/lib/navigation/navigationService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "navigation.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get("locale") || "en";
  const mode = searchParams.get("mode") === "preview" ? "preview" : "published";
  const audience = (searchParams.get("audience") as "all" | "authenticated" | "guest") || "all";

  try {
    const tree = await getResolvedNavigationTree({
      workspaceId: auth.data!.actor.workspaceId,
      menuKey: id,
      locale,
      mode,
      audience,
    });

    return respond(true, tree, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not resolve navigation tree", 500);
  }
}
