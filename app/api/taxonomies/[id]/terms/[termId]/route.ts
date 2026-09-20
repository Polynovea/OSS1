import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getTerm, updateTerm } from "@/lib/taxonomy/taxonomyService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string; termId: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.read" });
  if (auth.error) return auth.error;

  const { termId } = await params;
  const term = await getTerm(auth.data!.actor.workspaceId, termId);
  if (!term) return respond(false, null, "Term not found", 404);

  return respond(true, term, null);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; termId: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.manage" });
  if (auth.error) return auth.error;

  const { termId } = await params;
  try {
    const body = await req.json();
    const updated = await updateTerm({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      termId,
      name: body.name,
      description: body.description,
      parentTermId: body.parentTermId,
      orderIndex: body.orderIndex,
      localizations: body.localizations,
      aliases: body.aliases,
    });
    return respond(true, updated, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not update term", 400);
  }
}
