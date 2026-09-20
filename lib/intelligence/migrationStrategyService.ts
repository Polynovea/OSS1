import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { saveDraft } from "@/lib/content/entryService";
import { sha256Canonical } from "@/lib/intelligence/operationalCanonical";
import { assessDataAwareSchemaChange } from "@/lib/intelligence/migrationIntelligenceService";
import { deployAssessedCanonicalSchema, getDataAwareChangeAssessment } from "@/lib/intelligence/schemaDeploymentService";
import type { OperationalDeterministicClassification } from "@/lib/intelligence/operationalTypes";
import { getModel, getVersion } from "@/lib/schema/modelService";
import type { CanonicalSchema, FieldDefinition } from "@/lib/schema/fields/types";
import { logPlatformEvent } from "@/lib/platform/audit";

export const MIGRATION_STRATEGIES = [
  "direct_metadata_change",
  "staged_backfill",
  "copy_transform_verify",
  "deduplicate_then_unique",
  "deprecate_retain",
  "maintenance_window",
] as const;

export type MigrationStrategyKey = (typeof MIGRATION_STRATEGIES)[number];

export type MigrationTransformOperator =
  | "string_to_number"
  | "string_to_integer"
  | "number_to_string"
  | "string_to_boolean"
  | "trim_string";

export interface MigrationStrategyInput {
  batchSize?: number;
  transforms?: Array<{ fieldKey: string; operator: MigrationTransformOperator }>;
  maintenanceWindow?: { notBefore: string; note?: string };
}

const AUTOMATABLE_BLOCKERS = new Set(["REQUIRED_BACKFILL", "POPULATED_FIELD_REMOVAL", "INCOMPATIBLE_TYPE_VALUES"]);

function boundedBatchSize(value: unknown) {
  const parsed = Number(value ?? 250);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) throw Object.assign(new Error("Migration batchSize must be between 1 and 500"), { status: 400 });
  return parsed;
}

function fieldByKey(schema: CanonicalSchema) {
  return new Map(schema.fields.map((field) => [field.key, field]));
}

function blockerCodes(assessment: any): string[] {
  return (Array.isArray(assessment.hard_blockers_json) ? assessment.hard_blockers_json : []).map((item: any) => String(item?.code ?? ""));
}

function safeInputDescriptor(strategyKey: MigrationStrategyKey, input: MigrationStrategyInput, schema: CanonicalSchema) {
  const descriptor: Record<string, unknown> = {
    strategyKey,
    batchSize: boundedBatchSize(input.batchSize),
    rawContentValuesPersisted: false,
  };
  if (strategyKey === "staged_backfill") {
    descriptor.defaultSource = "canonical_schema";
    descriptor.fieldsWithDefaults = schema.fields.filter((field) => field.required && field.defaultValue !== undefined).map((field) => field.key);
  }
  if (strategyKey === "copy_transform_verify") {
    descriptor.transforms = (input.transforms ?? []).map((rule) => ({ fieldKey: rule.fieldKey, operator: rule.operator }));
  }
  if (strategyKey === "maintenance_window") {
    descriptor.maintenanceWindow = input.maintenanceWindow ? { notBefore: input.maintenanceWindow.notBefore, hasNote: Boolean(input.maintenanceWindow.note) } : null;
  }
  return descriptor;
}

export function migrationStrategyClassification(strategyKey: MigrationStrategyKey, assessment: any): OperationalDeterministicClassification {
  if (strategyKey === "direct_metadata_change" || strategyKey === "deprecate_retain") return "safe";
  if (strategyKey === "staged_backfill") return "requires_backfill";
  if (strategyKey === "copy_transform_verify" || strategyKey === "deduplicate_then_unique") return "requires_data_migration";
  if (strategyKey === "maintenance_window") return String(assessment.deterministic_classification) as OperationalDeterministicClassification;
  return String(assessment.deterministic_classification) as OperationalDeterministicClassification;
}

export function chooseAutomaticMigrationStrategy(assessment: any, schema: CanonicalSchema): { strategyKey: MigrationStrategyKey; input: MigrationStrategyInput; reason: string } | null {
  const blockers = Array.isArray(assessment.hard_blockers_json) ? assessment.hard_blockers_json : [];
  const codes = blockers.map((item: any) => String(item?.code ?? ""));
  if (!codes.length && ["safe", "requires_lock"].includes(String(assessment.deterministic_classification))) {
    return { strategyKey: "direct_metadata_change", input: {}, reason: "Target-data assessment has no hard blockers." };
  }
  if (codes.length && codes.every((code: string) => code === "POPULATED_FIELD_REMOVAL")) {
    return { strategyKey: "deprecate_retain", input: {}, reason: "Removed fields can be omitted from the active canonical schema while historical/current JSON payload values are retained." };
  }
  if (codes.length && codes.every((code: string) => code === "REQUIRED_BACKFILL")) {
    const byKey = fieldByKey(schema);
    const missingDefaults = blockers.map((item: any) => String(item?.fieldKey ?? "")).filter((key: string) => byKey.get(key)?.defaultValue === undefined);
    if (!missingDefaults.length) return { strategyKey: "staged_backfill", input: {}, reason: "Every required backfill field has an explicit canonical defaultValue." };
  }
  return null;
}

function validateStrategy(assessment: any, strategyKey: MigrationStrategyKey, schema: CanonicalSchema, input: MigrationStrategyInput) {
  const blockers = Array.isArray(assessment.hard_blockers_json) ? assessment.hard_blockers_json : [];
  const codes = blockerCodes(assessment);
  const entryCount = Number(assessment.data_profile_json?.entryCount ?? assessment.estimate_json?.entryCount ?? 0);
  if (assessment.provenance_state === "ambiguous" || (entryCount > 0 && assessment.provenance_state !== "proven")) {
    throw Object.assign(new Error("Migration execution is blocked because populated target schema provenance is not proven"), { status: 409 });
  }
  if (!assessment.target_schema_version || !assessment.target_schema_hash) throw Object.assign(new Error("Assessment is not pinned to a persisted target schema version/hash"), { status: 409 });

  if (strategyKey === "direct_metadata_change") {
    if (blockers.length) throw Object.assign(new Error("Direct metadata deployment cannot execute while hard blockers remain"), { status: 409, blockers });
    if (!["safe", "requires_lock"].includes(String(assessment.deterministic_classification))) throw Object.assign(new Error("Direct metadata deployment is not valid for this deterministic classification"), { status: 409 });
  } else if (strategyKey === "deprecate_retain") {
    if (!codes.length || !codes.every((code) => code === "POPULATED_FIELD_REMOVAL")) throw Object.assign(new Error("deprecate_retain is valid only when populated-field removal is the sole blocker class"), { status: 409 });
  } else if (strategyKey === "staged_backfill") {
    if (!codes.length || !codes.every((code) => code === "REQUIRED_BACKFILL")) throw Object.assign(new Error("staged_backfill is valid only when required-field backfill is the sole blocker class"), { status: 409 });
    const fields = fieldByKey(schema);
    const missing = blockers.map((item: any) => String(item?.fieldKey ?? "")).filter((key: string) => fields.get(key)?.defaultValue === undefined);
    if (missing.length) throw Object.assign(new Error(`staged_backfill requires canonical defaultValue for: ${missing.join(", ")}`), { status: 409 });
  } else if (strategyKey === "copy_transform_verify") {
    if (!codes.some((code) => code === "INCOMPATIBLE_TYPE_VALUES")) throw Object.assign(new Error("copy_transform_verify requires incompatible type evidence"), { status: 409 });
    if (codes.some((code) => !["INCOMPATIBLE_TYPE_VALUES"].includes(code))) throw Object.assign(new Error("copy_transform_verify cannot silently resolve unrelated blocker classes"), { status: 409, blockers });
    const rules = input.transforms ?? [];
    const needed = new Set<string>(blockers.filter((item: any) => String(item?.code ?? "") === "INCOMPATIBLE_TYPE_VALUES").map((item: any) => String(item?.fieldKey ?? "")));
    const provided = new Set(rules.map((rule) => rule.fieldKey));
    const missing = [...needed].filter((key) => !provided.has(key));
    if (missing.length) throw Object.assign(new Error(`Explicit deterministic transform rule required for: ${missing.join(", ")}`), { status: 409 });
  } else if (strategyKey === "deduplicate_then_unique") {
    throw Object.assign(new Error("Automatic deduplication is intentionally not implemented because choosing which customer record/value survives is semantic and potentially destructive. Supply a reviewed provider/manual migration and then reassess."), { status: 409 });
  } else if (strategyKey === "maintenance_window") {
    const raw = input.maintenanceWindow?.notBefore;
    if (!raw || Number.isNaN(new Date(raw).getTime())) throw Object.assign(new Error("maintenance_window requires a valid notBefore timestamp"), { status: 400 });
  }
}

async function targetSchemaForAssessment(workspaceId: string, assessment: any) {
  const model = await getModel(workspaceId, assessment.content_model_id);
  if (!model) throw Object.assign(new Error("Content model not found"), { status: 404 });
  const targetVersion = Number(assessment.target_schema_version ?? 0);
  const version = targetVersion > 0 ? await getVersion(model.id, targetVersion) : null;
  if (!version) throw Object.assign(new Error("Pinned canonical target version is unavailable"), { status: 409 });
  if (String(version.schema_hash) !== String(assessment.target_schema_hash)) throw Object.assign(new Error("Pinned target schema hash no longer matches the canonical version"), { status: 409 });
  return { model, version, schema: version.schema_json as CanonicalSchema };
}

async function existingOrCreateRun(params: { workspaceId: string; environmentId: string; actorId: string; assessment: any; strategyKey: MigrationStrategyKey; input: MigrationStrategyInput; schema: CanonicalSchema }) {
  const db = createServiceRoleClient();
  const descriptor = safeInputDescriptor(params.strategyKey, params.input, params.schema);
  const inputHash = sha256Canonical({ strategyKey: params.strategyKey, input: params.input });
  const { data: existing } = await db.from("operational_migration_runs")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("environment_id", params.environmentId)
    .eq("assessment_id", params.assessment.id)
    .eq("strategy_key", params.strategyKey)
    .eq("input_hash_sha256", inputHash)
    .in("status", ["planned", "running", "paused", "blocked", "succeeded"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return { run: existing, inputHash, created: false };
  const correlationId = randomUUID();
  const { data: run, error } = await db.from("operational_migration_runs").insert({
    workspace_id: params.workspaceId,
    environment_id: params.environmentId,
    content_model_id: params.assessment.content_model_id,
    assessment_id: params.assessment.id,
    strategy_key: params.strategyKey,
    status: "planned",
    deterministic_classification: migrationStrategyClassification(params.strategyKey, params.assessment),
    input_hash_sha256: inputHash,
    input_descriptor_json: descriptor,
    provenance_json: {
      assessmentId: params.assessment.id,
      sourceSchemaVersion: params.assessment.source_schema_version ?? null,
      sourceSchemaHash: params.assessment.source_schema_hash ?? null,
      targetSchemaVersion: params.assessment.target_schema_version ?? null,
      targetSchemaHash: params.assessment.target_schema_hash ?? null,
      provenanceState: params.assessment.provenance_state ?? "unverified",
    },
    plan_json: { strategyKey: params.strategyKey, descriptor, resumable: ["staged_backfill", "copy_transform_verify"].includes(params.strategyKey) },
    correlation_id: correlationId,
    created_by: params.actorId,
  }).select().single();
  if (error || !run) throw new Error(error?.message || "Could not create migration strategy run");
  return { run, inputHash, created: true };
}

function transformedValue(value: unknown, operator: MigrationTransformOperator) {
  if (operator === "string_to_number") {
    if (typeof value !== "string" || value.trim() === "" || !Number.isFinite(Number(value))) throw new Error("value is not deterministically convertible from string to number");
    return Number(value);
  }
  if (operator === "string_to_integer") {
    if (typeof value !== "string" || !/^[+-]?\d+$/.test(value.trim())) throw new Error("value is not deterministically convertible from string to integer");
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error("integer conversion exceeds safe numeric range");
    return parsed;
  }
  if (operator === "number_to_string") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("value is not a finite number");
    return String(value);
  }
  if (operator === "string_to_boolean") {
    if (typeof value !== "string") throw new Error("value is not a string");
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
    throw new Error("string is not one of the explicitly supported boolean representations");
  }
  if (operator === "trim_string") {
    if (typeof value !== "string") throw new Error("value is not a string");
    return value.trim();
  }
  throw new Error(`Unsupported deterministic transform operator ${operator}`);
}

async function loadCurrentEntryBatch(params: { workspaceId: string; modelId: string; cursorId?: string | null; batchSize: number }) {
  const db = createServiceRoleClient();
  let query = db.from("content_entries")
    .select("id,current_draft_version_id,published_version_id")
    .eq("workspace_id", params.workspaceId)
    .eq("content_model_id", params.modelId)
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(params.batchSize);
  if (params.cursorId) query = query.gt("id", params.cursorId);
  const { data: entries, error } = await query;
  if (error) throw new Error(error.message);
  const versionIds = (entries ?? []).map((entry) => entry.current_draft_version_id ?? entry.published_version_id).filter(Boolean);
  const { data: versions, error: versionError } = versionIds.length
    ? await db.from("content_entry_versions").select("id,entry_id,version_number,locale,data_jsonb").in("id", versionIds)
    : { data: [], error: null };
  if (versionError) throw new Error(versionError.message);
  const versionById = new Map((versions ?? []).map((version) => [version.id, version]));
  return (entries ?? []).map((entry) => ({ entry, version: versionById.get(entry.current_draft_version_id ?? entry.published_version_id) ?? null }));
}

async function executeDataBatch(params: { workspaceId: string; actorId: string; modelId: string; run: any; strategyKey: MigrationStrategyKey; input: MigrationStrategyInput; schema: CanonicalSchema; batchSize: number }) {
  const db = createServiceRoleClient();
  const cursorBefore = params.run.cursor_json ?? {};
  const rows = await loadCurrentEntryBatch({ workspaceId: params.workspaceId, modelId: params.modelId, cursorId: cursorBefore.lastEntryId ?? null, batchSize: params.batchSize });
  const batchNumber = Number(params.run.progress_json?.batches ?? 0) + 1;
  const { data: batch, error: batchError } = await db.from("operational_migration_batches").insert({
    workspace_id: params.workspaceId,
    migration_run_id: params.run.id,
    batch_number: batchNumber,
    status: "running",
    cursor_before_json: cursorBefore,
  }).select().single();
  if (batchError || !batch) throw new Error(batchError?.message || "Could not start migration batch");

  const byField = fieldByKey(params.schema);
  const requiredBackfillKeys = params.strategyKey === "staged_backfill"
    ? (params.run.plan_json?.requiredBackfillKeys ?? []).map(String)
    : [];
  const transformRules = new Map((params.input.transforms ?? []).map((rule) => [rule.fieldKey, rule.operator]));
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let lastEntryId: string | null = cursorBefore.lastEntryId ?? null;
  const safeResults: Array<Record<string, unknown>> = [];
  let fatal: Error | null = null;

  for (const row of rows) {
    lastEntryId = row.entry.id;
    processed++;
    if (!row.version) {
      safeResults.push({ entryId: row.entry.id, status: "skipped", reason: "no_current_version" });
      succeeded++;
      continue;
    }
    const data = { ...(row.version.data_jsonb ?? {}) } as Record<string, unknown>;
    let changed = false;
    try {
      if (params.strategyKey === "staged_backfill") {
        for (const key of requiredBackfillKeys) {
          const current = data[key];
          const missing = current === undefined || current === null || (typeof current === "string" && current.trim() === "");
          if (!missing) continue;
          const field = byField.get(key);
          if (!field || field.defaultValue === undefined) throw new Error(`Canonical defaultValue is unavailable for ${key}`);
          data[key] = structuredClone(field.defaultValue);
          changed = true;
        }
      } else if (params.strategyKey === "copy_transform_verify") {
        for (const [fieldKey, operator] of transformRules) {
          if (!(fieldKey in data) || data[fieldKey] === null) continue;
          const next = transformedValue(data[fieldKey], operator);
          if (!Object.is(next, data[fieldKey])) { data[fieldKey] = next; changed = true; }
        }
      }
      if (!changed) {
        succeeded++;
        safeResults.push({ entryId: row.entry.id, status: "already_converged" });
        continue;
      }
      const saved = await saveDraft({
        workspaceId: params.workspaceId,
        entryId: row.entry.id,
        data,
        locale: row.version.locale,
        actorAdminUserId: params.actorId,
        changeSummary: `Phase 12.75 ${params.strategyKey} migration`,
        expectedVersionNumber: Number(row.version.version_number),
      });
      if (!saved.ok) throw new Error(saved.error);
      succeeded++;
      safeResults.push({ entryId: row.entry.id, status: "migrated", versionNumber: saved.data.version.version_number });
    } catch (error) {
      failed++;
      fatal = error instanceof Error ? error : new Error("Migration row failed");
      safeResults.push({ entryId: row.entry.id, status: "failed", error: fatal.message.slice(0, 500) });
      break;
    }
  }

  const cursorAfter = { lastEntryId, endReached: rows.length < params.batchSize || fatal !== null };
  const status = fatal ? (succeeded ? "partial" : "failed") : "succeeded";
  await db.from("operational_migration_batches").update({
    status,
    cursor_after_json: cursorAfter,
    processed_count: processed,
    succeeded_count: succeeded,
    failed_count: failed,
    safe_results_json: safeResults,
    error_json: fatal ? { message: fatal.message.slice(0, 1000) } : {},
    completed_at: new Date().toISOString(),
  }).eq("id", batch.id);

  const previous = params.run.progress_json ?? {};
  const progress = {
    batches: Number(previous.batches ?? 0) + 1,
    processed: Number(previous.processed ?? 0) + processed,
    succeeded: Number(previous.succeeded ?? 0) + succeeded,
    failed: Number(previous.failed ?? 0) + failed,
  };
  const { data: updated, error: updateError } = await db.from("operational_migration_runs").update({
    status: fatal ? "blocked" : "running",
    cursor_json: cursorAfter,
    progress_json: progress,
    last_error: fatal ? fatal.message.slice(0, 2000) : null,
    updated_at: new Date().toISOString(),
  }).eq("id", params.run.id).select().single();
  if (updateError || !updated) throw new Error(updateError?.message || "Could not persist migration progress");
  return { run: updated, batch, endReached: Boolean(cursorAfter.endReached), fatal };
}

async function refreshAndDeploy(params: { workspaceId: string; environmentId: string; actorId: string; modelId: string; targetSchema: CanonicalSchema; strategyKey: MigrationStrategyKey; originalAssessmentId: string }) {
  const reassessed = await assessDataAwareSchemaChange({ workspaceId: params.workspaceId, environmentId: params.environmentId, modelId: params.modelId, actorId: params.actorId, proposedSchema: params.targetSchema });
  const blockers = Array.isArray(reassessed.assessment.hard_blockers_json) ? reassessed.assessment.hard_blockers_json : [];
  if (blockers.length) throw Object.assign(new Error("Post-migration assessment still contains hard blockers"), { status: 409, blockers, reassessmentId: reassessed.assessment.id });
  const deployed = await deployAssessedCanonicalSchema({ workspaceId: params.workspaceId, environmentId: params.environmentId, modelId: params.modelId, actorId: params.actorId, assessmentId: reassessed.assessment.id });
  return { reassessment: reassessed.assessment, deployment: deployed, originalAssessmentId: params.originalAssessmentId };
}

export async function executeAssessedMigrationStrategy(params: {
  workspaceId: string;
  environmentId: string;
  actorId: string;
  assessmentId: string;
  strategyKey: MigrationStrategyKey;
  input?: MigrationStrategyInput;
  maxBatches?: number;
}) {
  const input = params.input ?? {};
  const assessment = await getDataAwareChangeAssessment(params.workspaceId, params.assessmentId);
  if (assessment.environment_id !== params.environmentId) throw Object.assign(new Error("Assessment belongs to a different environment"), { status: 409 });
  const { model, schema } = await targetSchemaForAssessment(params.workspaceId, assessment);
  validateStrategy(assessment, params.strategyKey, schema, input);
  const db = createServiceRoleClient();
  const { run: initialRun, inputHash } = await existingOrCreateRun({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, assessment, strategyKey: params.strategyKey, input, schema });
  if (initialRun.input_hash_sha256 !== inputHash) throw Object.assign(new Error("Migration resume input hash mismatch"), { status: 409 });
  if (initialRun.status === "succeeded") return { run: initialRun, resumed: true, alreadySucceeded: true };

  const now = new Date().toISOString();
  let run = initialRun;
  if (!run.started_at) {
    const planPatch: Record<string, unknown> = { ...(run.plan_json ?? {}) };
    if (params.strategyKey === "staged_backfill") {
      planPatch.requiredBackfillKeys = (Array.isArray(assessment.hard_blockers_json) ? assessment.hard_blockers_json : []).filter((item: any) => String(item?.code ?? "") === "REQUIRED_BACKFILL").map((item: any) => String(item?.fieldKey ?? ""));
    }
    const { data: started, error } = await db.from("operational_migration_runs").update({ status: "running", started_at: now, updated_at: now, plan_json: planPatch }).eq("id", run.id).select().single();
    if (error || !started) throw new Error(error?.message || "Could not start migration run");
    run = started;
  }

  if (params.strategyKey === "maintenance_window") {
    const notBefore = new Date(input.maintenanceWindow!.notBefore);
    if (Date.now() < notBefore.getTime()) {
      const { data: paused } = await db.from("operational_migration_runs").update({ status: "paused", postcondition_json: { notBefore: notBefore.toISOString(), ready: false }, updated_at: new Date().toISOString() }).eq("id", run.id).select().single();
      return { run: paused ?? run, pausedUntil: notBefore.toISOString() };
    }
    throw Object.assign(new Error("maintenance_window is a scheduling wrapper; execute a concrete assessed migration strategy once the window opens"), { status: 409 });
  }

  if (params.strategyKey === "direct_metadata_change" || params.strategyKey === "deprecate_retain") {
    const deployment = await deployAssessedCanonicalSchema({ workspaceId: params.workspaceId, environmentId: params.environmentId, modelId: model.id, actorId: params.actorId, assessmentId: assessment.id, strategyKey: params.strategyKey });
    const completedAt = new Date().toISOString();
    const { data: completed, error } = await db.from("operational_migration_runs").update({ status: "succeeded", completed_at: completedAt, updated_at: completedAt, postcondition_json: { deployed: true, schemaVersion: deployment.schemaVersion, schemaHash: deployment.schemaHash, retainedRemovedFieldData: params.strategyKey === "deprecate_retain" } }).eq("id", run.id).select().single();
    if (error || !completed) throw new Error(error?.message || "Could not finalize migration run");
    await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "operational.migration.succeeded", entityType: "operational_migration_run", entityId: run.id, metadata: { environmentId: params.environmentId, modelId: model.id, strategyKey: params.strategyKey, assessmentId: assessment.id } });
    return { run: completed, deployment };
  }

  if (params.strategyKey === "deduplicate_then_unique") {
    throw Object.assign(new Error("Automatic deduplication remains blocked by design"), { status: 409 });
  }

  const batchSize = boundedBatchSize(input.batchSize ?? assessment.estimate_json?.batchRecommendation ?? 250);
  const maxBatches = Math.max(1, Math.min(Number(params.maxBatches ?? 100), 100));
  let endReached = false;
  for (let i = 0; i < maxBatches; i++) {
    const batchResult = await executeDataBatch({ workspaceId: params.workspaceId, actorId: params.actorId, modelId: model.id, run, strategyKey: params.strategyKey, input, schema, batchSize });
    run = batchResult.run;
    if (batchResult.fatal) throw Object.assign(new Error(`Migration paused after batch failure: ${batchResult.fatal.message}`), { status: 409, migrationRunId: run.id });
    endReached = batchResult.endReached;
    if (endReached) break;
  }

  if (!endReached) {
    const { data: paused, error } = await db.from("operational_migration_runs").update({ status: "paused", updated_at: new Date().toISOString(), postcondition_json: { complete: false, reason: "batch_execution_cap_reached", resumeRequired: true } }).eq("id", run.id).select().single();
    if (error || !paused) throw new Error(error?.message || "Could not pause resumable migration run");
    return { run: paused, resumeRequired: true };
  }

  const verification = await refreshAndDeploy({ workspaceId: params.workspaceId, environmentId: params.environmentId, actorId: params.actorId, modelId: model.id, targetSchema: schema, strategyKey: params.strategyKey, originalAssessmentId: assessment.id });
  const completedAt = new Date().toISOString();
  const { data: completed, error } = await db.from("operational_migration_runs").update({
    status: "succeeded",
    completed_at: completedAt,
    updated_at: completedAt,
    postcondition_json: { complete: true, reassessmentId: verification.reassessment.id, deploymentId: verification.deployment.deployment.id, schemaVersion: verification.deployment.schemaVersion, schemaHash: verification.deployment.schemaHash },
  }).eq("id", run.id).select().single();
  if (error || !completed) throw new Error(error?.message || "Could not finalize migration run");
  await logPlatformEvent({ workspaceId: params.workspaceId, actorAdminUserId: params.actorId, action: "operational.migration.succeeded", entityType: "operational_migration_run", entityId: run.id, metadata: { environmentId: params.environmentId, modelId: model.id, strategyKey: params.strategyKey, assessmentId: assessment.id, reassessmentId: verification.reassessment.id, processed: completed.progress_json?.processed ?? null } });
  return { run: completed, verification };
}

export async function listMigrationRuns(workspaceId: string, environmentId: string, modelId?: string | null) {
  const db = createServiceRoleClient();
  let query = db.from("operational_migration_runs").select("*").eq("workspace_id", workspaceId).eq("environment_id", environmentId);
  if (modelId) query = query.eq("content_model_id", modelId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
}
