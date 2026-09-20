#!/usr/bin/env node
/* Governed JSON-RPC stdio transport. It has no database or service-role access. */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const baseUrl = (process.env.POLYNOVEA_CMS_URL || "").replace(/\/$/, "");
const token = process.env.POLYNOVEA_CMS_TOKEN || "";
if (!baseUrl || !token) throw new Error("POLYNOVEA_CMS_URL and POLYNOVEA_CMS_TOKEN are required");

const objectSchema = { type: "object", additionalProperties: false, properties: {} };
const tools = {
  "cms.schema.list": { method: "GET", path: "/api/v1/models", inputSchema: objectSchema },
  "cms.schema.get": { method: "GET", path: a => `/api/v1/models/${encodeURIComponent(a.model)}`, inputSchema: { type: "object", required: ["model"], additionalProperties: false, properties: { model: { type: "string" } } } },
  "cms.content.search": { method: "GET", path: a => `/api/v1/entries?${new URLSearchParams(a).toString()}`, inputSchema: { type: "object", additionalProperties: false, properties: { model: { type: "string" }, status: { type: "string" }, locale: { type: "string" }, limit: { type: "number" } } } },
  "cms.content.get": { method: "GET", path: a => `/api/v1/entries/${encodeURIComponent(a.id)}`, inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string" } } } },
  "cms.media.search": { method: "GET", path: "/api/v1/media", inputSchema: objectSchema },
  "cms.operational.overview": { method: "GET", path: a => `/api/v1/operational-intelligence?environmentId=${encodeURIComponent(a.environmentId || "")}`, inputSchema: { type: "object", required: ["environmentId"], additionalProperties: false, properties: { environmentId: { type: "string" } } } },
  "cms.draft.create": { method: "POST", path: "/api/v1/entries", body: a => ({ model: a.model, data: a.data, locale: a.locale, changeSummary: a.changeSummary, status: "draft" }), inputSchema: { type: "object", required: ["model", "data"], additionalProperties: false, properties: { model: { type: "string" }, data: { type: "object" }, locale: { type: "string" }, changeSummary: { type: "string" } } } },
  "cms.draft.update": { method: "PUT", path: a => `/api/v1/entries/${encodeURIComponent(a.id)}`, body: a => ({ data: a.data, locale: a.locale, changeSummary: a.changeSummary, expectedVersionNumber: a.expectedVersionNumber }), inputSchema: { type: "object", required: ["id", "data"], additionalProperties: false, properties: { id: { type: "string" }, data: { type: "object" }, locale: { type: "string" }, changeSummary: { type: "string" }, expectedVersionNumber: { type: "number" } } } },
  "cms.workflow.submit": { method: "POST", path: a => `/api/v1/entries/${encodeURIComponent(a.id)}/workflow`, body: a => ({ action: "submit", comment: a.comment }), inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string" }, comment: { type: "string" } } } },
  "cms.publish": { method: "POST", path: a => `/api/v1/entries/${encodeURIComponent(a.id)}/publish`, body: () => ({}), inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string" } } } },
  "cms.delete": { method: "DELETE", path: a => `/api/v1/entries/${encodeURIComponent(a.id)}`, inputSchema: { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string" } } } },
  "cms.operational.execute": { method: "POST", path: "/api/v1/operational-intelligence", body: a => ({ operation: "execute", environmentId: a.environmentId, planId: a.planId, approvalRequestId: a.approvalRequestId }), inputSchema: { type: "object", required: ["environmentId", "planId"], additionalProperties: false, properties: { environmentId: { type: "string" }, planId: { type: "string" }, approvalRequestId: { type: "string" } } } },
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-id": randomUUID(), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({ error: { message: "Non-JSON response" } }));
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || `HTTP ${response.status}`), { payload, status: response.status });
  return payload;
}

function validateArguments(schema, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Tool arguments must be an object");
  for (const key of schema?.required || []) if (!(key in args) || args[key] === undefined || args[key] === null) throw new Error(`Missing required argument: ${key}`);
  if (schema?.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`Unexpected tool argument: ${key}`);
  }
  for (const [key, definition] of Object.entries(schema?.properties || {})) {
    if (!(key in args) || args[key] === undefined) continue;
    if (definition.type === "object" && (typeof args[key] !== "object" || Array.isArray(args[key]) || args[key] === null)) throw new Error(`${key} must be an object`);
    if (definition.type === "string" && typeof args[key] !== "string") throw new Error(`${key} must be a string`);
    if (definition.type === "number" && typeof args[key] !== "number") throw new Error(`${key} must be a number`);
  }
}

async function invoke(name, args = {}) {
  const tool = tools[name];
  if (!tool) throw new Error(`Unsupported governed MCP tool: ${name}`);
  validateArguments(tool.inputSchema ?? { type: "object", additionalProperties: true }, args);
  const safeInputSummary = { tool: name, keys: Object.keys(args).sort() };
  const control = await request("/api/v1/agent-tools", { method: "POST", body: JSON.stringify({ action: "authorize", toolName: name, safeInputSummary, sourceContext: Array.isArray(args.sourceContext) ? args.sourceContext : [] }) });
  try {
    const path = typeof tool.path === "function" ? tool.path(args) : tool.path;
    const payload = await request(path, { method: tool.method, body: tool.method === "GET" ? undefined : JSON.stringify(tool.body ? tool.body(args) : args) });
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
  } catch (error) {
    throw error;
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) {
  let messageId = null;
  try {
    const requestMessage = JSON.parse(line);
    messageId = requestMessage.id ?? null;
    if (requestMessage.method === "tools/list") console.log(JSON.stringify({ jsonrpc: "2.0", id: requestMessage.id, result: { tools: Object.entries(tools).map(([name, tool]) => ({ name, description: "Governed Polynovea CMS tool", inputSchema: tool.inputSchema ?? { type: "object", additionalProperties: true } })) } }));
    else if (requestMessage.method === "tools/call") console.log(JSON.stringify({ jsonrpc: "2.0", id: requestMessage.id, result: await invoke(requestMessage.params?.name, requestMessage.params?.arguments || {}) }));
    else console.log(JSON.stringify({ jsonrpc: "2.0", id: requestMessage.id, error: { code: -32601, message: "Method not found" } }));
  } catch (error) { console.log(JSON.stringify({ jsonrpc: "2.0", id: messageId, error: { code: -32000, message: error instanceof Error ? error.message : "MCP invocation failed" } })); }
}
