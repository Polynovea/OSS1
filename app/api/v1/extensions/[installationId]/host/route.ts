import { apiError, apiSuccess } from "@/lib/developer/apiContract";
import { requireDeveloperApi } from "@/lib/developer/apiAuth";
import { authorizeExtensionRoute, emitExtensionEvent, extensionFetch, resolveExtensionConnection } from "@/lib/developer/extensionHostService";

type HostOperation = "route.authorize" | "network.fetch" | "connection.resolve" | "event.emit";

export async function POST(req: Request, { params }: { params: Promise<{ installationId: string }> }) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return apiError("INVALID_REQUEST", "Request body must be JSON", 400); }
  const operation = String(body.operation ?? "") as HostOperation;
  const mutation = operation === "network.fetch" || operation === "event.emit";
  if (!["route.authorize", "network.fetch", "connection.resolve", "event.emit"].includes(operation)) return apiError("UNSUPPORTED_EXTENSION_HOST_OPERATION", "operation must be route.authorize, network.fetch, connection.resolve or event.emit", 400);
  const auth = await requireDeveloperApi(req, { scope: mutation ? "extension.manage" : "extension.read", requireActor: mutation });
  if (auth.error) return auth.error;
  const { installationId } = await params;
  const common = { workspaceId: auth.data!.workspaceId, installationId };
  try {
    const result = operation === "route.authorize"
      ? await authorizeExtensionRoute({ ...common, method: String(body.method ?? ""), path: String(body.path ?? "") })
      : operation === "network.fetch"
        ? await extensionFetch({ ...common, actorId: auth.data!.actorAdminUserId!, url: String(body.url ?? ""), method: String(body.method ?? ""), ...(typeof body.body === "string" ? { body: body.body } : {}) })
        : operation === "connection.resolve"
          ? await resolveExtensionConnection({ ...common, connectionId: String(body.connectionId ?? ""), connectorFamily: String(body.connectorFamily ?? ""), connectorType: String(body.connectorType ?? ""), scope: String(body.scope ?? "") })
          : await emitExtensionEvent({ ...common, actorId: auth.data!.actorAdminUserId!, eventType: String(body.eventType ?? ""), payload: body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload as Record<string, unknown> : {} });
    return apiSuccess(result, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  } catch (error: any) {
    return apiError("EXTENSION_HOST_DENIED", error instanceof Error ? error.message : "Extension host operation denied", Number(error?.status) || 400, { requestId: auth.data!.requestId, rateLimit: auth.data!.rateLimit });
  }
}
