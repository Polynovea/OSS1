import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { diffVersions, getModel } from "@/lib/schema/modelService";

const ts = () => new Date().toISOString();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "schema.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const model = await getModel(auth.data!.actor.workspaceId, id);
  if (!model) return NextResponse.json({ success: false, data: null, error: "Not found", timestamp: ts() }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const toParam = searchParams.get("to");
  const fromParam = searchParams.get("from");

  const to = toParam ? parseInt(toParam, 10) : model.current_schema_version;
  const from = fromParam ? parseInt(fromParam, 10) : to - 1;

  if (from < 1) {
    return NextResponse.json(
      { success: false, data: null, error: "There is no version before the first — pass explicit from/to to compare specific versions", timestamp: ts() },
      { status: 400 },
    );
  }

  const result = await diffVersions(id, from, to);
  if (!result.ok) {
    return NextResponse.json({ success: false, data: null, error: result.error, timestamp: ts() }, { status: result.status });
  }
  return NextResponse.json({ success: true, data: { from, to, ...result.data }, error: null, timestamp: ts() });
}
