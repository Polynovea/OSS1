/**
 * Canonical Image Dimension Parser.
 *
 * Behavior Contract (Canonical Behavior A + B):
 * - Extracts actual image dimensions (width, height) directly from image file header buffers (PNG, JPEG, GIF, WebP).
 * - Deliberately returns { width: null, height: null } when the media format does not support dimensions
 *   (e.g. PDF, video, audio) or when the image buffer cannot be deterministically decoded.
 */

export interface ImageDimensions {
  width: number | null;
  height: number | null;
}

export function extractDimensions(buffer: Buffer, mimeType: string): ImageDimensions {
  if (!buffer || buffer.length < 10) {
    return { width: null, height: null };
  }

  try {
    // 1. PNG: 8-byte signature, then IHDR chunk with 4-byte width and 4-byte height at byte 16
    if (
      mimeType === "image/png" &&
      buffer.length >= 24 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    // 2. GIF: "GIF87a" or "GIF89a", 16-bit LE width at byte 6, height at byte 8
    if (
      mimeType === "image/gif" &&
      buffer.length >= 10 &&
      buffer.toString("ascii", 0, 3) === "GIF"
    ) {
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return { width, height };
    }

    // 3. JPEG: 0xFFD8 signature, find SOF0/SOF2 marker
    if (
      (mimeType === "image/jpeg" || mimeType === "image/jpg") &&
      buffer.length >= 4 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8
    ) {
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buffer[offset + 1];
        // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2)
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        // Skip marker segment
        const segmentLength = buffer.readUInt16BE(offset + 2);
        offset += 2 + segmentLength;
      }
    }

    // 4. WebP: RIFF....WEBP
    if (
      mimeType === "image/webp" &&
      buffer.length >= 30 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      const format = buffer.toString("ascii", 12, 16);
      if (format === "VP8 " && buffer.length >= 30) {
        const width = buffer.readUInt16LE(26) & 0x3fff;
        const height = buffer.readUInt16LE(28) & 0x3fff;
        return { width, height };
      } else if (format === "VP8L" && buffer.length >= 25) {
        const b0 = buffer[21];
        const b1 = buffer[22];
        const b2 = buffer[23];
        const b3 = buffer[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width, height };
      }
    }
  } catch {
    // If decoding fails, fallback to null
  }

  return { width: null, height: null };
}
