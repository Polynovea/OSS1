import { apiError, apiSuccess } from "@/lib/developer/apiContract";
import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { listPublishedContent } from "@/lib/developer/publishedContentService";

export async function GET(req: Request, { params }: { params: Promise<{ model: string }> }) {
  const { model } = await params;
  const auth = await requireDeveloperApi(req, { scope: "content.read", modelApiKey: model });
  if (auth.error) return auth.error;
  const ctx = auth.data!;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? 25);
  const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 25;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;
  const locale = url.searchParams.get("locale") ?? undefined;
  try {
    const result = await listPublishedContent({ workspaceId: ctx.workspaceId, modelApiKey: model, locale, limit, offset });
    if (!result.model) return apiError("MODEL_NOT_FOUND", "Content model not found", 404, { requestId: ctx.requestId, rateLimit: ctx.rateLimit });
    return apiSuccess(result.records, { requestId: ctx.requestId, rateLimit: ctx.rateLimit, pagination: { limit, offset, returned: result.records.length } });
  } catch {
    return apiError("CONTENT_READ_FAILED", "Published content could not be read", 500, { requestId: ctx.requestId, rateLimit: ctx.rateLimit });
  }
}
