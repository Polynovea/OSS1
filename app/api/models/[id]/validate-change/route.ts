import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getModel, validateChange } from "@/lib/schema/modelService";

const ts = () => new Date().toISOString();

/**
 * Validates a proposed schema change and returns its diff/classification
 * WITHOUT persisting anything — the "propose -> validate -> diff" steps of
 * the lifecycle, ahead of /apply-change.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "schema.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const model = await getModel(auth.data!.actor.workspaceId, id);
  if (!model) return NextResponse.json({ success: false, data: null, error: "Not found", timestamp: ts() }, { status: 404 });

  try {
    const body = await req.json();
    const result = await validateChange(model, body.schema);
    if (!result.ok) {
      return NextResponse.json({ success: false, data: null, error: result.error, timestamp: ts() }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result.data, error: null, timestamp: ts() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, data: null, error: message, timestamp: ts() }, { status: 400 });
  }
}
