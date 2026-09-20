import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listTaxonomies, createTaxonomy } from "@/lib/taxonomy/taxonomyService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.read" });
  if (auth.error) return auth.error;

  try {
    const taxonomies = await listTaxonomies(auth.data!.actor.workspaceId);
    return respond(true, taxonomies, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not list taxonomies", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.manage" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    if (!body.name || !body.slug) {
      return respond(false, null, "Name and slug are required", 400);
    }

    const taxonomy = await createTaxonomy({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      hierarchical: body.hierarchical,
      modelRestrictions: body.modelRestrictions,
    });

    return respond(true, taxonomy, null, 201);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not create taxonomy", 400);
  }
}
