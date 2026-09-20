import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { computeSchemaDiff, type ChangeClassification, type SchemaDiff } from "@/lib/schema/diff";
import { validateCanonicalSchema } from "@/lib/schema/canonicalSchema";
import { applyChange, computeSchemaHash, createModel, getVersion, listModels, type ContentModelRow } from "@/lib/schema/modelService";
import type { CanonicalSchema } from "@/lib/schema/fields/types";
import type { DeveloperApiContext } from "@/lib/developer/apiAuth";
import { logDeveloperApiMutation } from "@/lib/developer/developerAudit";
import { logPlatformEvent } from "@/lib/platform/audit";

export interface SchemaDeliveryContext {
  workspaceId: string;
  actorAdminUserId: string | null;
  tokenId?: string | null;
  tokenName?: string;
  requestId?: string;
  scopes?: string[];
  allowedModels?: string[];
}

const severity: ChangeClassification[] = ["SAFE", "POTENTIALLY_DESTRUCTIVE", "DESTRUCTIVE", "REQUIRES_DATA_MIGRATION"];
const worst = (a: ChangeClassification, b: ChangeClassification) => severity.indexOf(b) > severity.indexOf(a) ? b : a;
const stableHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface SchemaBundleModel {
  apiKey: string;
  name: string;
  version: number;
  schemaHash: string;
  schema: CanonicalSchema;
  description?: string | null;
  icon?: string | null;
}
export interface SchemaBundle {
  format: "polynovea-cms-schema-bundle";
  formatVersion: 1;
  environment?: string | null;
  generatedAt: string;
  models: SchemaBundleModel[];
}
export type SchemaPlanItem = {
  apiKey: string;
  action: "create" | "update" | "noop";
  targetModelId?: string;
  currentVersion?: number;
  proposedVersion: number;
  classification: ChangeClassification;
  diff: SchemaDiff;
  sourceSchemaHash: string;
  targetSchemaHash?: string | null;
  rollbackGuidance: string;
};

export async function exportSchemaBundle(workspaceId: string, environment?: string | null): Promise<SchemaBundle> {
  const models = await listModels(workspaceId);
  const bundleModels: SchemaBundleModel[] = [];
  for (const model of models.filter((item) => item.status !== "archived" && item.current_schema)) {
    const version = await getVersion(model.id, model.current_schema_version);
    if (!version) continue;
    bundleModels.push({
      apiKey: model.api_key,
      name: model.name,
      version: model.current_schema_version,
      schemaHash: version.schema_hash,
      schema: version.schema_json,
      description: model.description,
      icon: model.icon,
    });
  }
  return { format: "polynovea-cms-schema-bundle", formatVersion: 1, environment: environment ?? null, generatedAt: new Date().toISOString(), models: bundleModels.sort((a,b)=>a.apiKey.localeCompare(b.apiKey)) };
}

function normalizeBundle(input: unknown): SchemaBundle {
  if (!input || typeof input !== "object") throw new Error("Schema bundle must be an object");
  const value = input as Partial<SchemaBundle>;
  if (value.format !== "polynovea-cms-schema-bundle" || value.formatVersion !== 1 || !Array.isArray(value.models)) throw new Error("Unsupported schema bundle format/version");
  const seen = new Set<string>();
  const models: SchemaBundleModel[] = value.models.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid schema bundle model");
    const candidate = raw as SchemaBundleModel;
    const validation = validateCanonicalSchema(candidate.schema);
    if (!validation.valid || !validation.schema) throw new Error(`Invalid schema for ${candidate.apiKey || "unknown"}: ${validation.errors.join("; ")}`);
    if (validation.schema.apiKey !== candidate.apiKey) throw new Error(`Bundle apiKey mismatch for ${candidate.apiKey}`);
    if (seen.has(candidate.apiKey)) throw new Error(`Duplicate model apiKey in bundle: ${candidate.apiKey}`);
    seen.add(candidate.apiKey);
    return { ...candidate, name: validation.schema.name, schema: validation.schema, schemaHash: computeSchemaHash(validation.schema) };
  });
  return { format: "polynovea-cms-schema-bundle", formatVersion: 1, environment: value.environment ?? null, generatedAt: value.generatedAt || new Date().toISOString(), models };
}

export async function planSchemaBundle(workspaceId: string, input: unknown) {
  const bundle = normalizeBundle(input);
  const targetModels = await listModels(workspaceId);
  const targetByApi = new Map(targetModels.map((m) => [m.api_key, m]));
  const items: SchemaPlanItem[] = [];
  let overall: ChangeClassification = "SAFE";
  for (const source of bundle.models) {
    const target = targetByApi.get(source.apiKey);
    if (!target) {
      const diff: SchemaDiff = { entries: source.schema.fields.map((field) => ({ kind: "added", fieldKey: field.key, after: field, classification: field.required && field.defaultValue === undefined ? "POTENTIALLY_DESTRUCTIVE" : "SAFE", reason: "Model will be created in target environment" })), overallClassification: source.schema.fields.some((f)=>f.required&&f.defaultValue===undefined) ? "POTENTIALLY_DESTRUCTIVE" : "SAFE" };
      overall = worst(overall, diff.overallClassification);
      items.push({ apiKey: source.apiKey, action: "create", proposedVersion: 1, classification: diff.overallClassification, diff, sourceSchemaHash: source.schemaHash, rollbackGuidance: "If promotion must be reversed, archive the newly created model after verifying no target entries depend on it." });
      continue;
    }
    const current = target.current_schema;
    if (!current) throw new Error(`Target model ${source.apiKey} has no current schema`);
    const currentVersion = await getVersion(target.id, target.current_schema_version);
    const currentHash = currentVersion?.schema_hash ?? computeSchemaHash(current);
    const diff = computeSchemaDiff(current, source.schema);
    const action = diff.entries.length ? "update" : "noop";
    overall = worst(overall, diff.overallClassification);
    items.push({ apiKey: source.apiKey, action, targetModelId: target.id, currentVersion: target.current_schema_version, proposedVersion: action === "update" ? target.current_schema_version + 1 : target.current_schema_version, classification: diff.overallClassification, diff, sourceSchemaHash: source.schemaHash, targetSchemaHash: currentHash, rollbackGuidance: action === "update" ? `Current version ${target.current_schema_version} remains immutable. Rollback by pushing that prior schema as a new version after reviewing data compatibility.` : "No rollback required; schemas are identical." });
  }
  const sourceKeys = new Set(bundle.models.map((m)=>m.apiKey));
  const targetOnly = targetModels.filter((m)=>m.status!=="archived"&&!sourceKeys.has(m.api_key)).map((m)=>({ apiKey:m.api_key, modelId:m.id, currentVersion:m.current_schema_version, drift:"target_only" as const }));
  return { bundle, bundleHash: stableHash(bundle), overallClassification: overall, items, targetOnly, hasChanges: items.some((i)=>i.action!=="noop") || targetOnly.length>0 };
}

async function recordSchemaRun(params:{context:SchemaDeliveryContext;operation:"dry_run"|"push"|"promotion";status:string;bundleHash:string;plan:unknown;summary:unknown;sourceEnvironment?:string|null;targetEnvironment?:string|null;approvalNote?:string|null;completed?:boolean}) {
  const db=createServiceRoleClient();
  const {data,error}=await db.from("developer_schema_runs").insert({ workspace_id:params.context.workspaceId, api_token_id:params.context.tokenId??null, actor_admin_user_id:params.context.actorAdminUserId, operation:params.operation, status:params.status, source_environment:params.sourceEnvironment??null, target_environment:params.targetEnvironment??null, bundle_hash:params.bundleHash, plan_json:params.plan, summary_json:params.summary, approval_note:params.approvalNote??null, completed_at:params.completed?new Date().toISOString():null }).select().single();
  if(error||!data) throw new Error(error?.message||"Could not record schema delivery run");
  return data;
}

async function logSchemaDeliveryMutation(context:SchemaDeliveryContext,action:string,runId:string,metadata:Record<string,unknown>){
  if(context.tokenId && context.requestId && context.tokenName && context.scopes && context.allowedModels){
    return logDeveloperApiMutation(context as DeveloperApiContext,action,"developer_schema_run",runId,metadata);
  }
  if(!context.actorAdminUserId) throw new Error("An audited admin actor is required for schema delivery mutations");
  return logPlatformEvent({workspaceId:context.workspaceId,actorAdminUserId:context.actorAdminUserId,action:action.replace(/^developer\./,"schema."),entityType:"developer_schema_run",entityId:runId,metadata:{...metadata,channel:"admin_ui"}});
}

export async function dryRunSchemaPromotion(context: SchemaDeliveryContext, input: unknown, targetEnvironment?: string | null) {
  const plan=await planSchemaBundle(context.workspaceId,input);
  const run=await recordSchemaRun({context,operation:"dry_run",status:plan.hasChanges?"planned":"applied",bundleHash:plan.bundleHash,plan,summary:{overallClassification:plan.overallClassification,changes:plan.items.filter(i=>i.action!=="noop").length,targetOnly:plan.targetOnly.length},sourceEnvironment:plan.bundle.environment,targetEnvironment,completed:true});
  await logSchemaDeliveryMutation(context,"developer.schema.dry_run",run.id,{overallClassification:plan.overallClassification,bundleHash:plan.bundleHash});
  return {runId:run.id,...plan};
}

export async function promoteSchemaBundle(params:{context:SchemaDeliveryContext;bundle:unknown;acknowledgeUnsafe?:boolean;approvalNote?:string|null;targetEnvironment?:string|null;operation?:"push"|"promotion"}) {
  const context=params.context;
  if(!context.actorAdminUserId) throw new Error("Token actor identity is required for schema mutation");
  const plan=await planSchemaBundle(context.workspaceId,params.bundle);
  const unsafe=plan.items.filter(i=>i.action!=="noop"&&i.classification!=="SAFE");
  if(unsafe.length&& !params.acknowledgeUnsafe){
    const run=await recordSchemaRun({context,operation:params.operation??"promotion",status:"blocked",bundleHash:plan.bundleHash,plan,summary:{reason:"unsafe_acknowledgement_required",unsafe:unsafe.map(i=>({apiKey:i.apiKey,classification:i.classification}))},sourceEnvironment:plan.bundle.environment,targetEnvironment:params.targetEnvironment,completed:true});
    return {applied:false,blocked:true,runId:run.id,reason:"Schema changes require acknowledgeUnsafe: true",...plan};
  }
  if(unsafe.length && !params.approvalNote?.trim()) throw new Error("approvalNote is required when applying non-SAFE schema changes");
  const targetModels=await listModels(context.workspaceId); const targetByApi=new Map(targetModels.map(m=>[m.api_key,m]));
  const results:Array<Record<string,unknown>>=[]; let failed=false;
  for(const source of plan.bundle.models){
    const item=plan.items.find(i=>i.apiKey===source.apiKey)!;
    if(item.action==="noop"){results.push({apiKey:source.apiKey,status:"noop"});continue;}
    const target=targetByApi.get(source.apiKey);
    if(!target){
      const created=await createModel({workspaceId:context.workspaceId,description:source.description??undefined,icon:source.icon??undefined,proposedSchema:source.schema,createdBy:context.actorAdminUserId});
      if(!created.ok){failed=true;results.push({apiKey:source.apiKey,status:"failed",error:created.error});break;}
      results.push({apiKey:source.apiKey,status:"created",modelId:created.data.model.id,version:created.data.version.version_number});
    }else{
      const applied=await applyChange({model:target,proposedSchema:source.schema,changeSummary:`Developer platform schema ${params.operation??"promotion"}${params.approvalNote?`: ${params.approvalNote}`:""}`,acknowledgeUnsafe:Boolean(params.acknowledgeUnsafe),actorAdminUserId:context.actorAdminUserId});
      if(!applied.ok){failed=true;results.push({apiKey:source.apiKey,status:"failed",error:applied.error});break;}
      if(!applied.data.applied && !applied.data.noChanges){failed=true;results.push({apiKey:source.apiKey,status:"blocked",error:applied.data.blockedReason});break;}
      results.push({apiKey:source.apiKey,status:applied.data.applied?"updated":"noop",version:applied.data.version?.version_number??target.current_schema_version});
    }
  }
  const appliedCount=results.filter(r=>["created","updated"].includes(String(r.status))).length;
  const status=failed?(appliedCount?"partially_applied":"failed"):"applied";
  const run=await recordSchemaRun({context,operation:params.operation??"promotion",status,bundleHash:plan.bundleHash,plan,summary:{results,appliedCount,failed},sourceEnvironment:plan.bundle.environment,targetEnvironment:params.targetEnvironment,approvalNote:params.approvalNote,completed:true});
  await logSchemaDeliveryMutation(context,"developer.schema.promotion",run.id,{status,bundleHash:plan.bundleHash,results});
  return {applied:!failed,blocked:false,runId:run.id,status,results,...plan};
}

export async function modelBundle(workspaceId:string, model:ContentModelRow):Promise<SchemaBundle>{
  const version=await getVersion(model.id,model.current_schema_version); if(!version) throw new Error("Current schema version not found");
  return {format:"polynovea-cms-schema-bundle",formatVersion:1,generatedAt:new Date().toISOString(),models:[{apiKey:model.api_key,name:model.name,version:model.current_schema_version,schemaHash:version.schema_hash,schema:version.schema_json,description:model.description,icon:model.icon}]};
}
