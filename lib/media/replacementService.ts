import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";
import { getStorageProvider } from "@/lib/media/storageProvider";
import { AssetRow, AssetResult } from "@/lib/media/assetService";

export interface AssetReplacementRow {
  id: string;
  workspace_id: string;
  asset_id: string;
  old_storage_provider: string;
  old_storage_key: string;
  old_checksum: string;
  old_filename: string;
  old_mime_type: string;
  old_size_bytes: number;
  old_width: number | null;
  old_height: number | null;
  new_storage_provider: string;
  new_storage_key: string;
  new_checksum: string;
  new_filename: string;
  new_mime_type: string;
  new_size_bytes: number;
  new_width: number | null;
  new_height: number | null;
  reason: string | null;
  replaced_by: string | null;
  created_at: string;
}

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "video/mp4",
  "video/webm",
  "application/pdf",
]);
const MAX_SIZE = 20 * 1024 * 1024;

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

/**
 * Recoverable In-Place Media Replacement:
 * 1. Uploads to a NEW storage key.
 * 2. Validates checksum, type, and size.
 * 3. Records complete previous state in asset_replacement_history.
 * 4. Updates assets table row retaining stable asset_id.
 * 5. Old blob is retained on storage according to retention policy.
 */
import { extractDimensions } from "@/lib/media/dimensionParser";

export async function replaceAsset(params: {
  workspaceId: string;
  actorAdminUserId: string;
  assetId: string;
  file: File;
  environmentId?: string | null;
  reason?: string;
}): Promise<AssetResult<{ asset: AssetRow; replacement: AssetReplacementRow }>> {
  if (!ALLOWED_TYPES.has(params.file.type)) {
    return { ok: false, error: `Unsupported file type: ${params.file.type}`, status: 415 };
  }
  if (params.file.size > MAX_SIZE) {
    return { ok: false, error: "Asset exceeds 20 MB limit", status: 413 };
  }

  const db = createServiceRoleClient();
  const { data: currentAsset } = await db
    .from("assets")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.assetId)
    .maybeSingle();

  if (!currentAsset) {
    return { ok: false, error: "Asset not found in workspace", status: 404 };
  }

  const body = Buffer.from(await params.file.arrayBuffer());
  const newChecksum = createHash("sha256").update(body).digest("hex");
  const filename = safeSegment(params.file.name);
  const folder = currentAsset.folder || "general";
  const newStorageKey = `${params.workspaceId}/${folder}/${Date.now()}-${newChecksum.slice(0, 12)}-${filename}`;

  const dimensions = extractDimensions(body, params.file.type);

  const provider = await getStorageProvider({
    workspaceId: params.workspaceId,
    environmentId: params.environmentId,
    storageProviderKey: params.environmentId ? null : currentAsset.storage_provider,
  });
  await provider.upload({ body, key: newStorageKey, contentType: params.file.type });

  // 1 & 2: Execute atomic database transaction (record history + update asset) via RPC
  const { data: rpcRes, error: rpcErr } = await db.rpc("cms_replace_asset_file", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_asset_id: currentAsset.id,
    p_new_storage_provider: provider.key,
    p_new_storage_key: newStorageKey,
    p_new_checksum: newChecksum,
    p_new_filename: params.file.name,
    p_new_mime_type: params.file.type,
    p_new_size_bytes: params.file.size,
    p_new_width: dimensions.width,
    p_new_height: dimensions.height,
    p_reason: params.reason || "Asset replaced in media operations",
  });

  if (rpcErr || !rpcRes) {
    // If DB transaction fails, clean up newly uploaded blob to avoid orphaned storage objects
    await provider.remove(newStorageKey).catch(() => undefined);
    return { ok: false, error: rpcErr?.message || "Could not replace asset in database", status: 500 };
  }

  const resultData = rpcRes as { asset: AssetRow; historyId: string };

  const { data: replacementRow } = await db
    .from("asset_replacement_history")
    .select("*")
    .eq("id", resultData.historyId)
    .single();

  return {
    ok: true,
    data: {
      asset: resultData.asset,
      replacement: replacementRow as AssetReplacementRow,
    },
  };
}

export async function listAssetReplacements(workspaceId: string, assetId: string): Promise<AssetReplacementRow[]> {
  const { data } = await createServiceRoleClient()
    .from("asset_replacement_history")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("asset_id", assetId)
    .order("created_at", { ascending: false });
  return (data as AssetReplacementRow[]) ?? [];
}
