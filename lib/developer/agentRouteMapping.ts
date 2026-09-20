import type { GovernedAgentToolName } from "@/lib/developer/agentToolRegistry";

export function resolveAgentToolForApiRequest(params: { method: string; pathname: string; operation?: string | null }): GovernedAgentToolName | null {
  const path = params.pathname.replace(/\/$/, "") || "/";
  const segments = path.split("/").filter(Boolean);
  if (segments[0] !== "api" || segments[1] !== "v1") return null;
  const resource = segments[2];
  if (resource === "models" && params.method === "GET") return segments.length === 3 ? "cms.schema.list" : segments.length === 4 ? "cms.schema.get" : null;
  if (resource === "entries") {
    if (params.method === "GET") return segments.length === 3 ? "cms.content.search" : segments.length === 4 ? "cms.content.get" : null;
    if (params.method === "POST" && segments.length === 3) return "cms.draft.create";
    if (params.method === "PUT" && segments.length === 4) return "cms.draft.update";
    if (params.method === "DELETE" && segments.length === 4) return "cms.delete";
    if (params.method === "POST" && segments[4] === "workflow") return "cms.workflow.submit";
    if (params.method === "POST" && segments[4] === "publish") return "cms.publish";
  }
  if (resource === "media" && params.method === "GET") return "cms.media.search";
  if (resource === "operational-intelligence") {
    if (params.method === "GET") return "cms.operational.overview";
    if (params.method === "POST" && params.operation === "execute") return "cms.operational.execute";
  }
  return null;
}
