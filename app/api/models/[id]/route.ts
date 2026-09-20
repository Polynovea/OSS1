import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getModel } from "@/lib/schema/modelService";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";

const ts = () => new Date().toISOString();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "schema.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const model = await getModel(auth.data!.actor.workspaceId, id);
  if (!model) return NextResponse.json({ success: false, data: null, error: "Not found", timestamp: ts() }, { status: 404 });
  return NextResponse.json({ success: true, data: model, error: null, timestamp: ts() });
}

/**
 * Metadata only — description/icon/status. The model's name and fields
 * live in the canonical schema and only change through
 * /api/models/:id/apply-change's validate→diff→apply lifecycle, never a
 * silent PATCH, per the Phase 1 brief's explicit requirement.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "schema.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const model = await getModel(auth.data!.actor.workspaceId, id);
  if (!model) return NextResponse.json({ success: false, data: null, error: "Not found", timestamp: ts() }, { status: 404 });

  try {
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.icon === "string") patch.icon = body.icon;
    if (body.status && ["draft", "active", "archived"].includes(body.status)) patch.status = body.status;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, data: null, error: "No updatable fields provided", timestamp: ts() }, { status: 400 });
    }
    patch.updated_at = ts();

    const db = createServiceRoleClient();
    const { data, error } = await db.from("content_models").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ success: false, data: null, error: error.message, timestamp: ts() }, { status: 500 });
    return NextResponse.json({ success: true, data, error: null, timestamp: ts() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, data: null, error: message, timestamp: ts() }, { status: 400 });
  }
}
