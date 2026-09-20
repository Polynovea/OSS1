import { apiError, apiSuccess } from "@/lib/developer/apiContract";
import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { buildWorkspaceOpenApi } from "@/lib/developer/openapiService";

export async function GET(req: Request) {
  const auth = await requireDeveloperApi(req, { scope: "schema.read" });
  if (auth.error) return auth.error;
  const ctx = auth.data!;
  try {
    const document = await buildWorkspaceOpenApi(ctx.workspaceId, new URL(req.url).origin);
    return apiSuccess(document, { requestId: ctx.requestId, rateLimit: ctx.rateLimit });
  } catch {
    return apiError("OPENAPI_BUILD_FAILED", "OpenAPI document could not be generated", 500, { requestId: ctx.requestId, rateLimit: ctx.rateLimit });
  }
}
