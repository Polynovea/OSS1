import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listTerms, createTerm } from "@/lib/taxonomy/taxonomyService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const terms = await listTerms(auth.data!.actor.workspaceId, id);
    return respond(true, terms, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not list terms", 500);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const body = await req.json();
    if (!body.name || !body.slug) {
      return respond(false, null, "Term name and slug are required", 400);
    }

    const term = await createTerm({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      taxonomyId: id,
      parentTermId: body.parentTermId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      orderIndex: body.orderIndex,
      localizations: body.localizations,
      aliases: body.aliases,
    });

    return respond(true, term, null, 201);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not create term", 400);
  }
}
