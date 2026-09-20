import type { DeveloperApiScope } from "@/lib/developer/apiTokenService";

export type AgentOperationClass = "read" | "draft_write" | "high_risk";

export interface GovernedAgentToolDefinition {
  name: string;
  operationClass: AgentOperationClass;
  requiredScopes: DeveloperApiScope[];
  description: string;
  usesDeterministicController?: boolean;
}

export const AGENT_TOOL_REGISTRY = {
  "cms.schema.list": {
    name: "cms.schema.list",
    operationClass: "read",
    requiredScopes: ["schema.read"],
    description: "List canonical content models visible to the token.",
  },
  "cms.schema.get": {
    name: "cms.schema.get",
    operationClass: "read",
    requiredScopes: ["schema.read"],
    description: "Read one canonical content model and its schema contract.",
  },
  "cms.content.search": {
    name: "cms.content.search",
    operationClass: "read",
    requiredScopes: ["content.read"],
    description: "Search workspace content through the governed content API.",
  },
  "cms.content.get": {
    name: "cms.content.get",
    operationClass: "read",
    requiredScopes: ["content.read"],
    description: "Read one content entry through the governed content API.",
  },
  "cms.media.search": {
    name: "cms.media.search",
    operationClass: "read",
    requiredScopes: ["media.read"],
    description: "Search media through the governed media API.",
  },
  "cms.operational.overview": {
    name: "cms.operational.overview",
    operationClass: "read",
    requiredScopes: ["operational_intelligence.read"],
    description: "Read operational world, drift, plan and evidence summaries.",
    usesDeterministicController: true,
  },
  "cms.draft.create": {
    name: "cms.draft.create",
    operationClass: "draft_write",
    requiredScopes: ["content.write"],
    description: "Create a draft content entry. Agent writes remain draft-first by default.",
  },
  "cms.draft.update": {
    name: "cms.draft.update",
    operationClass: "draft_write",
    requiredScopes: ["content.write"],
    description: "Update an existing draft through the governed content mutation path.",
  },
  "cms.workflow.submit": {
    name: "cms.workflow.submit",
    operationClass: "draft_write",
    requiredScopes: ["content.write"],
    description: "Submit a draft into the configured editorial workflow.",
  },
  "cms.publish": {
    name: "cms.publish",
    operationClass: "high_risk",
    requiredScopes: ["content.publish"],
    description: "Publish through the normal governed publishing path.",
  },
  "cms.delete": {
    name: "cms.delete",
    operationClass: "high_risk",
    requiredScopes: ["content.delete"],
    description: "Delete/archive content only with an explicit destructive-content scope.",
  },
  "cms.operational.execute": {
    name: "cms.operational.execute",
    operationClass: "high_risk",
    requiredScopes: ["operational_intelligence.execute"],
    description: "Execute an already governed deterministic operational plan; never a hidden mutation path.",
    usesDeterministicController: true,
  },
} as const satisfies Record<string, GovernedAgentToolDefinition>;

export type GovernedAgentToolName = keyof typeof AGENT_TOOL_REGISTRY;

export function getAgentToolDefinition(toolName: string): GovernedAgentToolDefinition | null {
  return (AGENT_TOOL_REGISTRY as Record<string, GovernedAgentToolDefinition>)[toolName] ?? null;
}

export function evaluateAgentToolAccess(params: {
  toolName: string;
  tokenScopes: string[];
  agentDefaultMode: "draft_only" | "scoped";
  initiatingAdminUserId?: string | null;
}) {
  const tool = getAgentToolDefinition(params.toolName);
  if (!tool) return { allowed: false as const, code: "UNKNOWN_AGENT_TOOL", tool: null };

  const missingScopes = tool.requiredScopes.filter((scope) => !params.tokenScopes.includes(scope));
  if (missingScopes.length) {
    return { allowed: false as const, code: "INSUFFICIENT_SCOPE", tool, missingScopes };
  }

  if (tool.operationClass !== "read" && !params.initiatingAdminUserId) {
    return { allowed: false as const, code: "INITIATING_USER_REQUIRED", tool, missingScopes: [] };
  }

  if (tool.operationClass === "high_risk" && params.agentDefaultMode !== "scoped") {
    return { allowed: false as const, code: "AGENT_DRAFT_ONLY", tool, missingScopes: [] };
  }

  return { allowed: true as const, code: "ALLOWED", tool, missingScopes: [] };
}
