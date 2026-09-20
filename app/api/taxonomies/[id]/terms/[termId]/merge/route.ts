import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { mergeTerms } from "@/lib/taxonomy/taxonomyService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string; termId: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.manage" });
  if (auth.error) return auth.error;

  const { termId } = await params;
  try {
    const body = await req.json();
    if (!body.targetTermId) {
      return respond(false, null, "targetTermId is required for merging", 400);
    }

    const result = await mergeTerms({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      sourceTermId: termId,
      targetTermId: body.targetTermId,
    });

    return respond(true, result, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not merge terms", 400);
  }
}
