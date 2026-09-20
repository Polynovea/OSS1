import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { replaceAsset } from "@/lib/media/replacementService";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) =>
  NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAccess(req, { permission: "media.manage" });
  if (auth.error) return auth.error;

  const { id } = await params;
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const reason = String(formData.get("reason") || "");

    if (!(file instanceof File)) {
      return respond(false, null, "File is required for replacement", 400);
    }

    const result = await replaceAsset({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      assetId: id,
      file,
      reason,
    });

    if (!result.ok) {
      return respond(false, null, result.error, result.status);
    }

    return respond(true, result.data, null);
  } catch (err) {
    return respond(false, null, err instanceof Error ? err.message : "Could not replace asset", 500);
  }
}
