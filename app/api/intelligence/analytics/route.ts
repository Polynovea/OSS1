import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { ensureWorkspaceGa4Connector, getAnalyticsOverview, queueAnalyticsSync, runGa4AnalyticsSync } from "@/lib/content/analyticsIntelligenceService";
import { listModels } from "@/lib/schema/modelService";
import { canActorOperateModel } from "@/lib/schema/modelAccess";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";

async function allowedEntryIds(actor: NonNullable<Awaited<ReturnType<typeof requirePlatformAccess>>["data"]>["actor"]) {
  const models = await listModels(actor.workspaceId);
  const allowedModelIds = new Set((await Promise.all(models.map(async (model) => ({ id: model.id, access: await canActorOperateModel(actor, model, "read") })))).filter((item) => item.access.allowed).map((item) => item.id));
  if (!allowedModelIds.size) return new Set<string>();
  const { data } = await createServiceRoleClient().from("content_entries").select("id, content_model_id").eq("workspace_id", actor.workspaceId).in("content_model_id", [...allowedModelIds]);
  return new Set((data ?? []).map((entry) => entry.id));
}

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.read" });
  if (auth.error) return auth.error;
  try {
    const overview = await getAnalyticsOverview(auth.data!.actor.workspaceId);
    const allowed = await allowedEntryIds(auth.data!.actor);
    return NextResponse.json({ success: true, data: { ...overview, snapshots: overview.snapshots.filter((row) => allowed.has(row.entry_id)) }, error: null });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Could not load analytics intelligence" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "workspace.manage" });
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const operation = String(body.operation || "");
    if (operation === "ensure_ga4") {
      const data = await ensureWorkspaceGa4Connector({ workspaceId: auth.data!.actor.workspaceId, actorId: auth.data!.actor.adminUserId });
      return NextResponse.json({ success: true, data, error: null });
    }
    if (operation === "queue_sync") {
      const data = await queueAnalyticsSync({ workspaceId: auth.data!.actor.workspaceId, actorId: auth.data!.actor.adminUserId, connectorId: String(body.connectorId || "") });
      return NextResponse.json({ success: true, data, error: null }, { status: 202 });
    }
    if (operation === "run_sync") {
      const data = await runGa4AnalyticsSync({ workspaceId: auth.data!.actor.workspaceId, connectorId: String(body.connectorId || "") });
      return NextResponse.json({ success: true, data, error: null });
    }
    return NextResponse.json({ success: false, data: null, error: "Unsupported analytics operation" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, data: null, error: error instanceof Error ? error.message : "Analytics operation failed" }, { status: 400 });
  }
}
