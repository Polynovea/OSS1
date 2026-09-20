const MEDIA = {
  "image/jpeg": { extension: "jpg", signature: (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { extension: "png", signature: (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  "image/gif": { extension: "gif", signature: (b: Buffer) => b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a" },
  "image/webp": { extension: "webp", signature: (b: Buffer) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
  "video/mp4": { extension: "mp4", signature: (b: Buffer) => b.subarray(4, 8).toString("ascii") === "ftyp" },
  "video/webm": { extension: "webm", signature: (b: Buffer) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  "video/quicktime": { extension: "mov", signature: (b: Buffer) => b.subarray(4, 8).toString("ascii") === "ftyp" },
} as const;

export function canonicalMediaExtension(contentType: string) { return MEDIA[contentType as keyof typeof MEDIA]?.extension ?? null; }
export function assertCanonicalMediaFilename(filename: string, contentType: string) {
  const extension = canonicalMediaExtension(contentType);
  if (!extension) throw new Error("Unsupported media type");
  const supplied = filename.split(".").pop()?.toLowerCase();
  if (supplied !== extension && !(contentType === "image/jpeg" && supplied === "jpeg")) throw new Error(`Filename extension must match ${contentType}`);
  return extension;
}
export function assertMediaSignature(buffer: Buffer, contentType: string) {
  const media = MEDIA[contentType as keyof typeof MEDIA];
  if (!media?.signature(buffer)) throw new Error("Uploaded file content does not match its declared media type");
}
