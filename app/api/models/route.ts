import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { createModel, listModels } from "@/lib/schema/modelService";

const ts = () => new Date().toISOString();

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "schema.read" });
  if (auth.error) return auth.error;

  const models = await listModels(auth.data!.actor.workspaceId);
  return NextResponse.json({ success: true, data: models, error: null, timestamp: ts() });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "schema.manage" });
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const result = await createModel({
      workspaceId: auth.data!.actor.workspaceId,
      description: body.description,
      icon: body.icon,
      proposedSchema: body.schema,
      createdBy: auth.data!.actor.adminUserId,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, data: null, error: result.error, timestamp: ts() }, { status: result.status });
    }
    return NextResponse.json({ success: true, data: result.data, error: null, timestamp: ts() }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, data: null, error: message, timestamp: ts() }, { status: 400 });
  }
}
