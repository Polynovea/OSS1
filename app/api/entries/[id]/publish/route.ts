import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { publishEntry } from "@/lib/content/entryService";
import { runEntryPreflight } from "@/lib/content/preflightService";
import { queueEntryPublication } from "@/lib/content/publicationService";
import { canActorOperateEntry } from "@/lib/schema/modelAccess";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "content.entry.publish" });
  if (auth.error) return auth.error;
  const { id } = await params; const access = await canActorOperateEntry(auth.data!.actor, id, "publish"); if (!access.allowed) return NextResponse.json({ success: false, data: null, error: access.error, timestamp: new Date().toISOString() }, { status: access.status }); const report = await runEntryPreflight(auth.data!.actor.workspaceId, id); if (!report) return NextResponse.json({ success: false, data: null, error: "Entry or current draft not found", timestamp: new Date().toISOString() }, { status: 404 }); if (report.status === "blocked") return NextResponse.json({ success: false, data: { preflight: report }, error: `Publish readiness has ${report.summary.blocking} issue${report.summary.blocking === 1 ? "" : "s"}`, timestamp: new Date().toISOString() }, { status: 409 }); const result = await publishEntry({ workspaceId: auth.data!.actor.workspaceId, entryId: id, actorAdminUserId: auth.data!.actor.adminUserId }); if (result.ok && result.data.published_version_id) await queueEntryPublication({ workspaceId: auth.data!.actor.workspaceId, actorId: auth.data!.actor.adminUserId, entryId: result.data.id, versionId: result.data.published_version_id });
  return NextResponse.json({ success: result.ok, data: result.ok ? result.data : null, error: result.ok ? null : result.error, timestamp: new Date().toISOString() }, { status: result.ok ? 200 : result.status });
}
