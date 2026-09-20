import { resolveModelCapability, type CanonicalSchema, type FieldDefinition } from "@/lib/schema/fields/types";

export type ChangeClassification = "SAFE" | "POTENTIALLY_DESTRUCTIVE" | "DESTRUCTIVE" | "REQUIRES_DATA_MIGRATION";

const SEVERITY_ORDER: ChangeClassification[] = ["SAFE", "POTENTIALLY_DESTRUCTIVE", "DESTRUCTIVE", "REQUIRES_DATA_MIGRATION"];

function severityRank(c: ChangeClassification): number {
  return SEVERITY_ORDER.indexOf(c);
}

export interface FieldDiffEntry {
  kind: "added" | "removed" | "changed";
  fieldKey: string;
  before?: FieldDefinition;
  after?: FieldDefinition;
  classification: ChangeClassification;
  reason: string;
}

export interface SchemaDiff {
  entries: FieldDiffEntry[];
  overallClassification: ChangeClassification;
}

function classifyAddedField(field: FieldDefinition): FieldDiffEntry {
  if (field.required && field.defaultValue === undefined) {
    return {
      kind: "added",
      fieldKey: field.key,
      after: field,
      classification: "POTENTIALLY_DESTRUCTIVE",
      reason: `"${field.key}" is required with no default value — existing entries will not satisfy it until backfilled`,
    };
  }
  return {
    kind: "added",
    fieldKey: field.key,
    after: field,
    classification: "SAFE",
    reason: `Added optional field "${field.key}"`,
  };
}

function classifyRemovedField(field: FieldDefinition): FieldDiffEntry {
  return {
    kind: "removed",
    fieldKey: field.key,
    before: field,
    classification: "DESTRUCTIVE",
    reason: `"${field.key}" removed — any data already stored under this key is orphaned, not deleted`,
  };
}

function classifyChangedField(before: FieldDefinition, after: FieldDefinition): FieldDiffEntry | null {
  if (before.type !== after.type) {
    return {
      kind: "changed",
      fieldKey: after.key,
      before,
      after,
      classification: "REQUIRES_DATA_MIGRATION",
      reason: `"${after.key}" type changed from "${before.type}" to "${after.type}" — existing values must be reviewed/transformed`,
    };
  }

  const reasons: string[] = [];
  let classification: ChangeClassification = "SAFE";

  const escalate = (next: ChangeClassification, reason: string) => {
    if (severityRank(next) > severityRank(classification)) classification = next;
    reasons.push(reason);
  };

  if (!before.required && after.required) {
    escalate("POTENTIALLY_DESTRUCTIVE", `"${after.key}" became required — existing entries may not have a value`);
  }
  if (!before.unique && after.unique) {
    escalate("POTENTIALLY_DESTRUCTIVE", `"${after.key}" became unique — existing duplicate values would violate it`);
  }

  const beforeMax = before.validation?.maxLength;
  const afterMax = after.validation?.maxLength;
  if (afterMax !== undefined && (beforeMax === undefined || afterMax < beforeMax)) {
    escalate("POTENTIALLY_DESTRUCTIVE", `"${after.key}" maxLength narrowed to ${afterMax} — existing values may exceed it`);
  }

  const beforeMin = before.validation?.minLength;
  const afterMin = after.validation?.minLength;
  if (afterMin !== undefined && (beforeMin === undefined || afterMin > beforeMin)) {
    escalate("POTENTIALLY_DESTRUCTIVE", `"${after.key}" minLength widened to ${afterMin} — existing values may be shorter`);
  }

  const beforeOptions = before.validation?.options ?? [];
  const afterOptions = after.validation?.options ?? [];
  const removedOptions = beforeOptions.filter((o) => !afterOptions.includes(o));
  if (removedOptions.length > 0) {
    escalate("POTENTIALLY_DESTRUCTIVE", `"${after.key}" removed option(s): ${removedOptions.join(", ")} — existing entries using them would become invalid`);
  }

  if (reasons.length === 0) return null; // no meaningful change

  return { kind: "changed", fieldKey: after.key, before, after, classification, reason: reasons.join("; ") };
}

function classifyCapabilityChange(before: CanonicalSchema, after: CanonicalSchema): FieldDiffEntry | null {
  const beforeCapability = resolveModelCapability(before);
  const afterCapability = resolveModelCapability(after);
  if (beforeCapability === afterCapability) return null;

  const downgradesToDataOnly = afterCapability === "data_only" && beforeCapability !== "data_only";
  const downgradesFromPublishable = beforeCapability === "publishable" && afterCapability !== "publishable";
  const classification: ChangeClassification = downgradesToDataOnly || downgradesFromPublishable ? "POTENTIALLY_DESTRUCTIVE" : "SAFE";

  return {
    kind: "changed",
    fieldKey: "__capability__",
    classification,
    reason:
      classification === "SAFE"
        ? `Model capability changed from "${beforeCapability}" to "${afterCapability}"`
        : `Model capability changed from "${beforeCapability}" to "${afterCapability}" — existing publish/workflow state for this model's records may become unreachable`,
  };
}

export function computeSchemaDiff(before: CanonicalSchema, after: CanonicalSchema): SchemaDiff {
  const beforeByKey = new Map(before.fields.map((f) => [f.key, f]));
  const afterByKey = new Map(after.fields.map((f) => [f.key, f]));

  const entries: FieldDiffEntry[] = [];

  const capabilityEntry = classifyCapabilityChange(before, after);
  if (capabilityEntry) entries.push(capabilityEntry);

  for (const field of after.fields) {
    if (!beforeByKey.has(field.key)) {
      entries.push(classifyAddedField(field));
    }
  }

  for (const field of before.fields) {
    if (!afterByKey.has(field.key)) {
      entries.push(classifyRemovedField(field));
    }
  }

  for (const field of after.fields) {
    const beforeField = beforeByKey.get(field.key);
    if (!beforeField) continue;
    const entry = classifyChangedField(beforeField, field);
    if (entry) entries.push(entry);
  }

  const overallClassification = entries.reduce<ChangeClassification>(
    (worst, entry) => (severityRank(entry.classification) > severityRank(worst) ? entry.classification : worst),
    "SAFE",
  );

  return { entries, overallClassification };
}
