import { listModels, getVersion } from "@/lib/schema/modelService";
import type { CanonicalSchema, FieldDefinition } from "@/lib/schema/fields/types";

function fieldSchema(field: FieldDefinition): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  switch (field.type) {
    case "number": base.type = "number"; break;
    case "integer": base.type = "integer"; break;
    case "boolean": base.type = "boolean"; break;
    case "date": base.type = "string"; base.format = "date"; break;
    case "datetime": base.type = "string"; base.format = "date-time"; break;
    case "email": base.type = "string"; base.format = "email"; break;
    case "url": base.type = "string"; base.format = "uri-reference"; break;
    case "multi_select": base.type = "array"; base.items = { type: "string" }; break;
    case "json":
    case "rich_text":
    case "component": base.type = "object"; base.additionalProperties = true; break;
    default: base.type = "string";
  }
  if (field.validation?.minLength !== undefined) base.minLength = field.validation.minLength;
  if (field.validation?.maxLength !== undefined) base.maxLength = field.validation.maxLength;
  if (field.validation?.min !== undefined) base.minimum = field.validation.min;
  if (field.validation?.max !== undefined) base.maximum = field.validation.max;
  if (field.validation?.pattern) base.pattern = field.validation.pattern;
  if (field.validation?.options?.length) base.enum = field.validation.options;
  return base;
}

function modelDataSchema(schema: CanonicalSchema) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of schema.fields) {
    properties[field.key] = { title: field.label, ...fieldSchema(field) };
    if (field.required) required.push(field.key);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export async function buildWorkspaceOpenApi(workspaceId: string, baseUrl: string) {
  const models = (await listModels(workspaceId)).filter((model) => model.status === "active");
  const paths: Record<string, unknown> = {};
  const schemas: Record<string, unknown> = {
    ErrorEnvelope: {
      type: "object",
      properties: {
        error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} }, required: ["code", "message"] },
        meta: { type: "object", properties: { requestId: { type: "string", format: "uuid" }, timestamp: { type: "string", format: "date-time" } }, required: ["requestId", "timestamp"] },
      },
      required: ["error", "meta"],
    },
  };

  for (const model of models) {
    const version = await getVersion(model.id, model.current_schema_version);
    if (!version) continue;
    const componentName = model.api_key.replace(/[^A-Za-z0-9_]/g, "_");
    schemas[`${componentName}Data`] = modelDataSchema(version.schema_json);
    schemas[`${componentName}Published`] = {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" }, model: { type: "string", enum: [model.api_key] }, locale: { type: "string" }, versionId: { type: "string", format: "uuid" }, version: { type: "integer" }, publishedAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, data: { $ref: `#/components/schemas/${componentName}Data` }, route: { anyOf: [{ type: "object", properties: { path: { type: "string" }, locale: { type: "string" } }, required: ["path", "locale"] }, { type: "null" }] },
      },
      required: ["id", "model", "locale", "versionId", "version", "publishedAt", "updatedAt", "data", "route"],
    };
    const collectionPath = `/api/v1/content/${model.api_key}`;
    const itemPath = `${collectionPath}/{id}`;
    paths[collectionPath] = { get: { summary: `List published ${model.name}`, operationId: `list_${componentName}`, security: [{ bearerAuth: [] }], parameters: [{ name: "locale", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } }, { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } }], responses: { "200": { description: "Published content", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: `#/components/schemas/${componentName}Published` } }, meta: { type: "object" } }, required: ["data", "meta"] } } } }, "401": { $ref: "#/components/responses/Unauthorized" }, "403": { $ref: "#/components/responses/Forbidden" }, "429": { $ref: "#/components/responses/RateLimited" } } } };
    paths[itemPath] = { get: { summary: `Get published ${model.name}`, operationId: `get_${componentName}`, security: [{ bearerAuth: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }, { name: "locale", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Published content entry", content: { "application/json": { schema: { type: "object", properties: { data: { $ref: `#/components/schemas/${componentName}Published` }, meta: { type: "object" } }, required: ["data", "meta"] } } } }, "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } } } } };
  }

  const secured=(summary:string,scopes:string[],extra:Record<string,unknown>={})=>({summary,security:[{bearerAuth:[]}],"x-polynovea-scopes":scopes,...extra,responses:{"200":{description:"Success"},"400":{description:"Invalid request"},"401":{$ref:"#/components/responses/Unauthorized"},"403":{$ref:"#/components/responses/Forbidden"},"429":{$ref:"#/components/responses/RateLimited"}}});
  paths["/api/v1/models"]={get:secured("List content models",["schema.read"]),post:secured("Create content model",["schema.write"])};
  paths["/api/v1/models/{model}"]={get:secured("Pull a schema-as-code model bundle",["schema.read"],{parameters:[{name:"model",in:"path",required:true,schema:{type:"string"}}]}),put:secured("Push a model schema version",["schema.write"],{parameters:[{name:"model",in:"path",required:true,schema:{type:"string"}}]})};
  paths["/api/v1/models/{model}/diff"]={post:secured("Dry-run a model schema diff",["schema.read"],{parameters:[{name:"model",in:"path",required:true,schema:{type:"string"}}]})};
  paths["/api/v1/entries"]={get:secured("List governed entries",["content.read"]),post:secured("Create a draft entry",["content.write"])};
  paths["/api/v1/entries/{id}"]={get:secured("Get an entry and version history",["content.read"]),put:secured("Create a new draft version",["content.write"])};
  paths["/api/v1/entries/{id}/workflow"]={post:secured("Submit, approve or request changes",["content.write"])};
  paths["/api/v1/entries/{id}/publish"]={post:secured("Publish an approved entry after preflight",["content.publish"])};
  paths["/api/v1/releases"]={get:secured("List releases",["releases.read"]),post:secured("Create a pinned-version release",["releases.write"])};
  paths["/api/v1/releases/{id}"]={get:secured("Get release detail and readiness",["releases.read"])};
  paths["/api/v1/releases/{id}/transition"]={post:secured("Approve, schedule, request changes or cancel release",["releases.write"])};
  paths["/api/v1/releases/{id}/publish"]={post:secured("Publish an approved pinned release",["releases.write","content.publish"])};
  paths["/api/v1/media"]={get:secured("List media assets",["media.read"]),post:secured("Upload governed media (multipart/form-data)",["media.write"])};
  paths["/api/v1/schema/bundle"]={get:secured("Export schema-as-code bundle",["schema.read"])};
  paths["/api/v1/schema/promote"]={post:secured("Dry-run or apply environment schema promotion",["schema.write"])};
  paths["/api/v1/schema/runs"]={get:secured("List schema delivery runs and drift history",["schema.read"])};
  paths["/api/v1/imports"]={get:secured("List governed import runs",["content.read"]),post:secured("Dry-run or commit JSON/CSV/Markdown/WordPress import",["content.write"])};
  paths["/api/v1/export"]={get:secured("Export all portable workspace CMS data (secrets excluded)",["content.read","schema.read","media.read","releases.read"])};
  paths["/api/v1/environments"]={get:secured("List runtime environments",["environment.read"]),post:secured("Create runtime environment",["environment.write"])};
  paths["/api/v1/environments/{id}"]={get:secured("Get runtime environment",["environment.read"]),patch:secured("Update runtime environment",["environment.write"])};
  paths["/api/v1/connections"]={get:secured("List typed connections or connector catalog",["connection.read"]),post:secured("Create typed external connection",["connection.write"])};
  paths["/api/v1/connections/{id}/verify"]={post:secured("Verify a connection through its constrained adapter",["connection.write"])};
  paths["/api/v1/connections/{id}/credentials"]={post:secured("Rotate or rebind one connection credential without reading plaintext",["connection.write"])};
  paths["/api/v1/infrastructure"]={get:secured("Inspect environment operability, provisioning, backups, components and approvals",["infrastructure.read"]),post:secured("Run governed infrastructure operations such as Doctor, provisioning, backup, portability, website bootstrap or schema environment promotion",["infrastructure.write"])};

  return {
    openapi: "3.1.0",
    info: { title: "Polynovea CMS Developer API", version: "1.0.0", description: "Workspace-scoped stable REST API generated from canonical CMS models." },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Polynovea API Token" } },
      schemas,
      responses: {
        Unauthorized: { description: "Invalid, expired or revoked API token", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } },
        Forbidden: { description: "Token lacks scope or model access", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } },
        RateLimited: { description: "Rate limit exceeded", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } },
      },
    },
  };
}
