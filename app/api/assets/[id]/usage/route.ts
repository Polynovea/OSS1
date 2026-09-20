import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getAssetUsageGraph } from "@/lib/content/impactGraphService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "media.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const usage = await getAssetUsageGraph(auth.data!.actor.workspaceId, id);
    return respond(true, usage, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not fetch asset usage", 500);
  }
}
