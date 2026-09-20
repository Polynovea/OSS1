import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getTaxonomy, updateTaxonomy, deleteTaxonomy } from "@/lib/taxonomy/taxonomyService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const taxonomy = await getTaxonomy(auth.data!.actor.workspaceId, id);
  if (!taxonomy) return respond(false, null, "Taxonomy not found", 404);

  return respond(true, taxonomy, null);
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const body = await req.json();
    const updated = await updateTaxonomy({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      id,
      name: body.name,
      description: body.description,
      modelRestrictions: body.modelRestrictions,
    });
    return respond(true, updated, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not update taxonomy", 400);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "taxonomy.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    await deleteTaxonomy({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      id,
    });
    return respond(true, { ok: true }, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not delete taxonomy", 400);
  }
}
