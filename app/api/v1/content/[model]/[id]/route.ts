import { apiError, apiSuccess } from "@/lib/developer/apiContract";
import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { getPublishedContent } from "@/lib/developer/publishedContentService";

export async function GET(req: Request, { params }: { params: Promise<{ model: string; id: string }> }) {
  const { model, id } = await params;
  const auth = await requireDeveloperApi(req, { scope: "content.read", modelApiKey: model });
  if (auth.error) return auth.error;
  const ctx = auth.data!;
  const locale = new URL(req.url).searchParams.get("locale") ?? undefined;
  try {
    const result = await getPublishedContent({ workspaceId: ctx.workspaceId, modelApiKey: model, entryId: id, locale });
    if (!result.model) return apiError("MODEL_NOT_FOUND", "Content model not found", 404, { requestId: ctx.requestId, rateLimit: ctx.rateLimit });
    if (!result.record) return apiError("CONTENT_NOT_FOUND", "Published content entry not found", 404, { requestId: ctx.requestId, rateLimit: ctx.rateLimit });
    return apiSuccess(result.record, { requestId: ctx.requestId, rateLimit: ctx.rateLimit });
  } catch {
    return apiError("CONTENT_READ_FAILED", "Published content could not be read", 500, { requestId: ctx.requestId, rateLimit: ctx.rateLimit });
  }
}
