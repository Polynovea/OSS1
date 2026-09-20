import { NextResponse } from "next/server";
import { requirePlatformAccess } from "@/lib/platform/permissions";
import { listAssets, registerUpload } from "@/lib/media/assetService";
import { getStorageProvider } from "@/lib/media/storageProvider";

const respond = (success: boolean, data: unknown, error: string | null, status = 200) => NextResponse.json({ success, data, error, timestamp: new Date().toISOString() }, { status });

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "media.read" });
  if (auth.error) return auth.error;
  try {
    const workspaceId = auth.data!.actor.workspaceId;
    const assets = await listAssets(workspaceId);
    const withUrls = await Promise.all(assets.map(async (asset) => {
      try {
        const provider = await getStorageProvider({ workspaceId, storageProviderKey: asset.storage_provider });
        return { ...asset, preview_url: await provider.resolveReadUrl(asset.storage_key), storage_status: "available" };
      } catch (error) {
        return { ...asset, preview_url: null, storage_status: "unavailable", storage_error: error instanceof Error ? error.message : "Storage provider unavailable" };
      }
    }));
    return respond(true, withUrls, null);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not list assets", 500);
  }
}

export async function POST(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "media.upload" });
  if (auth.error) return auth.error;
  try {
    const body = await req.formData();
    const file = body.get("file");
    if (!(file instanceof File)) return respond(false, null, "file is required", 400);
    const result = await registerUpload({
      workspaceId: auth.data!.actor.workspaceId,
      actorAdminUserId: auth.data!.actor.adminUserId,
      file,
      folder: String(body.get("folder") || "general"),
      altText: String(body.get("altText") || ""),
      caption: String(body.get("caption") || ""),
      environmentId: body.get("environmentId") ? String(body.get("environmentId")) : null,
    });
    return result.ok ? respond(true, result.data, null, 201) : respond(false, null, result.error, result.status);
  } catch (error) {
    return respond(false, null, error instanceof Error ? error.message : "Could not upload asset", 400);
  }
}
