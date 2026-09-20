import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID!;
const bucketName = process.env.R2_BUCKET_NAME ?? "media";
const endpoint = process.env.R2_S3_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`;
const publicUrl = process.env.R2_PUBLIC_URL!;

function getClient(): S3Client {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not configured in environment variables");
  }

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

// Provider-neutral object storage functions. Cloudflare R2 is the current
// and intended backend (Polynovea's actual storage provider, accessed via
// its S3-compatible API — not a stand-in for AWS S3); these names avoid
// baking that choice, or the SAS-URL terminology from an earlier Azure
// Blob implementation, into the interface. See
// docs/adr/ADR-014-object-storage-provider-interface.md.

export function resolveObjectUrl(key: string): string {
  return `${publicUrl}/${key}`;
}

export async function uploadObject(
  file: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: file,
      ContentType: contentType,
    })
  );

  return resolveObjectUrl(key);
}

export async function deleteObject(key: string): Promise<void> {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
}

export async function createPresignedUpload(
  key: string,
  contentType: string
): Promise<{ uploadUrl: string; readUrl: string }> {
  const client = getClient();
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucketName, Key: key, ContentType: contentType }),
    { expiresIn: 60 * 30 } // 30 minutes
  );

  return {
    uploadUrl,
    readUrl: resolveObjectUrl(key),
  };
}
