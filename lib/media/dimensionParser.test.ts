import { describe, expect, it } from "vitest";
import { extractDimensions } from "@/lib/media/dimensionParser";

describe("Image Dimension Parser (Phase 7 Media Operations)", () => {
  it("extracts width and height from PNG header", () => {
    // 8 bytes signature + 4 bytes chunk length + 4 bytes "IHDR" + 4 bytes width (120) + 4 bytes height (80)
    const pngHeader = Buffer.alloc(24);
    pngHeader[0] = 0x89;
    pngHeader[1] = 0x50;
    pngHeader[2] = 0x4e;
    pngHeader[3] = 0x47;
    pngHeader[4] = 0x0d;
    pngHeader[5] = 0x0a;
    pngHeader[6] = 0x1a;
    pngHeader[7] = 0x0a;
    pngHeader.writeUInt32BE(120, 16);
    pngHeader.writeUInt32BE(80, 20);

    const dims = extractDimensions(pngHeader, "image/png");
    expect(dims).toEqual({ width: 120, height: 80 });
  });

  it("extracts width and height from GIF header", () => {
    const gifHeader = Buffer.alloc(10);
    gifHeader.write("GIF89a", 0, "ascii");
    gifHeader.writeUInt16LE(640, 6);
    gifHeader.writeUInt16LE(480, 8);

    const dims = extractDimensions(gifHeader, "image/gif");
    expect(dims).toEqual({ width: 640, height: 480 });
  });

  it("returns null dimensions for non-image or unsupported formats", () => {
    const pdfBuffer = Buffer.from("%PDF-1.4 dummy content");
    expect(extractDimensions(pdfBuffer, "application/pdf")).toEqual({ width: null, height: null });

    const mp4Buffer = Buffer.alloc(32);
    expect(extractDimensions(mp4Buffer, "video/mp4")).toEqual({ width: null, height: null });
  });

  it("returns null dimensions when image buffer is truncated or corrupted", () => {
    const truncated = Buffer.from([0x89, 0x50]);
    expect(extractDimensions(truncated, "image/png")).toEqual({ width: null, height: null });
  });
});
