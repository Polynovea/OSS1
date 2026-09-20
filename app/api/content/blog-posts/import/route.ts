import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin/serverAccess";
import { convertToHtml, htmlToBlogDraft, isSupportedImportExtension } from "@/lib/admin/blogImport";

export const runtime = "nodejs";

const ts = () => new Date().toISOString();
const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await requireAdminRequest(req, { requiredWriteModule: "cms.blog" });
  if (auth.error) return auth.error;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, data: null, error: "No file provided", timestamp: ts() }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!isSupportedImportExtension(ext)) {
      return NextResponse.json(
        { success: false, data: null, error: `Unsupported file type: .${ext}. Use .docx, .md, or .html.`, timestamp: ts() },
        { status: 415 },
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ success: false, data: null, error: "File too large (max 10 MB)", timestamp: ts() }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const html = await convertToHtml(buffer, ext);
    const draft = htmlToBlogDraft(html, file.name);

    return NextResponse.json({ success: true, data: draft, error: null, timestamp: ts() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, data: null, error: message, timestamp: ts() }, { status: 400 });
  }
}
