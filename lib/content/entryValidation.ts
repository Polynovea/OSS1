import { FIELD_TYPE_REGISTRY } from "@/lib/schema/fields/registry";
import type { CanonicalSchema, FieldDefinition } from "@/lib/schema/fields/types";

export function validateEntryData(schema: CanonicalSchema, data: unknown): string[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["Entry data must be an object"];
  const record = data as Record<string, unknown>;
  const known = new Set(schema.fields.map((field) => field.key));
  const errors: string[] = [];
  for (const key of Object.keys(record)) if (!known.has(key)) errors.push(`Unknown field "${key}"`);
  for (const field of schema.fields) {
    const registry = FIELD_TYPE_REGISTRY[field.type];
    errors.push(...registry.validateValue(record[field.key], field));
    if (field.relation && record[field.key] !== undefined && record[field.key] !== null && !isRelationValue(record[field.key], field)) {
      errors.push(`"${field.key}" must contain a relation entry id or list of entry ids`);
    }
  }
  return errors;
}

function isRelationValue(value: unknown, field: FieldDefinition): boolean {
  const values = ["one_to_many", "many_to_many"].includes(field.relation?.cardinality ?? "") ? value : [value];
  return Array.isArray(values) && values.every((item) => typeof item === "string" && item.length > 0);
}

export function extractEntryRelations(schema: CanonicalSchema, data: Record<string, unknown>): Array<{ fieldKey: string; targetEntryId: string; relationType: string }> {
  return schema.fields.flatMap((field) => {
    if (!field.relation) return [];
    const raw = data[field.key];
    if (raw === undefined || raw === null || raw === "") return [];
    const ids = Array.isArray(raw) ? raw : [raw];
    return ids.filter((id): id is string => typeof id === "string" && id.length > 0).map((targetEntryId) => ({ fieldKey: field.key, targetEntryId, relationType: field.relation!.cardinality }));
  });
}

/** Media/file references stored by the canonical editors are workspace asset IDs. */
export function extractAssetReferences(schema: CanonicalSchema, data: Record<string, unknown>): Array<{ fieldKey: string; assetId: string }> {
  const refs: Array<{ fieldKey: string; assetId: string }> = [];
  const seen = new Set<string>();
  const add = (fieldKey: string, value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    const key = `${fieldKey}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ fieldKey, assetId: value });
  };

  for (const field of schema.fields) {
    if (field.type === "media" || field.type === "file") add(field.key, data[field.key]);
    if (field.type === "component" || field.type === "repeater" || field.type === "json") {
      walkAssetIds(data[field.key], field.key, add);
    }
  }
  return refs;
}

function walkAssetIds(value: unknown, fieldKey: string, add: (fieldKey: string, value: unknown) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkAssetIds(item, fieldKey, add);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/^(assetId|targetAssetId|iconAssetId|imageAssetId|mediaAssetId)$/i.test(key)) add(`${fieldKey}.${key}`, nested);
    else walkAssetIds(nested, fieldKey, add);
  }
}

/** Internal links become route edges when their current-locale route exists. */
export function extractInternalPathReferences(schema: CanonicalSchema, data: Record<string, unknown>): Array<{ fieldKey: string; path: string }> {
  const refs: Array<{ fieldKey: string; path: string }> = [];
  const seen = new Set<string>();
  const add = (fieldKey: string, value: string) => {
    const path = value.trim().split(/[?#]/, 1)[0];
    if (!path.startsWith("/") || path.startsWith("//")) return;
    const key = `${fieldKey}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ fieldKey, path });
  };

  for (const field of schema.fields) {
    const value = data[field.key];
    if (field.type === "url" && typeof value === "string") add(field.key, value);
    if (field.type === "markdown" && typeof value === "string") {
      for (const match of value.matchAll(/\]\((\/[^)\s?#]+(?:[?#][^)]*)?)\)/g)) add(field.key, match[1]);
    }
    if (field.type === "component" || field.type === "repeater" || field.type === "json") {
      walkInternalLinks(value, field.key, add);
    }
  }
  return refs;
}

function walkInternalLinks(value: unknown, fieldKey: string, add: (fieldKey: string, value: string) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkInternalLinks(item, fieldKey, add);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/^(url|href|path|link)$/i.test(key) && typeof nested === "string") add(`${fieldKey}.${key}`, nested);
    else walkInternalLinks(nested, fieldKey, add);
  }
}
