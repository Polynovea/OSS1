import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { getModel, listVersions } from "@/lib/schema/modelService";

const ts = () => new Date().toISOString();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "schema.read" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const model = await getModel(auth.data!.actor.workspaceId, id);
  if (!model) return NextResponse.json({ success: false, data: null, error: "Not found", timestamp: ts() }, { status: 404 });

  const versions = await listVersions(id);
  return NextResponse.json({ success: true, data: versions, error: null, timestamp: ts() });
}
