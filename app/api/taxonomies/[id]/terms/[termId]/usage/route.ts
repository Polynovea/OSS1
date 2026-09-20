import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getTermUsage } from "@/lib/taxonomy/taxonomyService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string; termId: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.read" });
  if (auth.error) return auth.error;

  const { termId } = await params;
  try {
    const usage = await getTermUsage(auth.data!.actor.workspaceId, termId);
    return respond(true, usage, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not fetch term usage", 500);
  }
}
