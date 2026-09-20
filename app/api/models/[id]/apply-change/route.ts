import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { applyChange, getModel } from "@/lib/schema/modelService";

const ts = () => new Date().toISOString();

/**
 * Applies a proposed schema change. Never silently mutates the live
 * schema — always re-validates and re-diffs server-side (never trusts a
 * diff computed by a prior /validate-change call), and blocks anything
 * more severe than SAFE unless the caller explicitly sets
 * acknowledgeUnsafe: true.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "schema.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  const model = await getModel(auth.data!.actor.workspaceId, id);
  if (!model) return NextResponse.json({ success: false, data: null, error: "Not found", timestamp: ts() }, { status: 404 });

  try {
    const body = await req.json();
    const result = await applyChange({
      model,
      proposedSchema: body.schema,
      changeSummary: body.changeSummary,
      acknowledgeUnsafe: Boolean(body.acknowledgeUnsafe),
      actorAdminUserId: auth.data!.actor.adminUserId,
    });

    if (!result.ok) {
      return NextResponse.json({ success: false, data: null, error: result.error, timestamp: ts() }, { status: result.status });
    }
    if (!result.data.applied) {
      if (result.data.noChanges) {
        return NextResponse.json(
          { success: true, data: result.data, error: null, timestamp: ts() },
          { status: 200 },
        );
      }
      return NextResponse.json(
        { success: false, data: { diff: result.data.diff, blockedReason: result.data.blockedReason }, error: result.data.blockedReason, timestamp: ts() },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, data: result.data, error: null, timestamp: ts() }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, data: null, error: message, timestamp: ts() }, { status: 400 });
  }
}
