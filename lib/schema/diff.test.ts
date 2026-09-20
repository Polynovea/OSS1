import { describe, expect, it } from "vitest";
import { computeSchemaDiff } from "@/lib/schema/diff";
import type { CanonicalSchema, FieldDefinition } from "@/lib/schema/fields/types";

function field(overrides: Partial<FieldDefinition> & { key: string; type: FieldDefinition["type"] }): FieldDefinition {
  return {
    label: overrides.key,
    required: false,
    localized: false,
    unique: false,
    ...overrides,
  };
}

function schema(fields: FieldDefinition[], overrides: Partial<CanonicalSchema> = {}): CanonicalSchema {
  return { name: "Test Model", apiKey: "test_model", fields, ...overrides };
}

describe("computeSchemaDiff", () => {
  it("reports no entries and SAFE overall when nothing changed", () => {
    const s = schema([field({ key: "title", type: "text", required: true })]);
    const diff = computeSchemaDiff(s, s);
    expect(diff.entries).toEqual([]);
    expect(diff.overallClassification).toBe("SAFE");
  });

  it("classifies an added optional field as SAFE", () => {
    const before = schema([field({ key: "title", type: "text" })]);
    const after = schema([field({ key: "title", type: "text" }), field({ key: "subtitle", type: "text" })]);
    const diff = computeSchemaDiff(before, after);
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]).toMatchObject({ kind: "added", fieldKey: "subtitle", classification: "SAFE" });
    expect(diff.overallClassification).toBe("SAFE");
  });

  it("classifies an added required field with no default as POTENTIALLY_DESTRUCTIVE", () => {
    const before = schema([field({ key: "title", type: "text" })]);
    const after = schema([field({ key: "title", type: "text" }), field({ key: "seo_title", type: "text", required: true })]);
    const diff = computeSchemaDiff(before, after);
    expect(diff.entries[0].classification).toBe("POTENTIALLY_DESTRUCTIVE");
    expect(diff.overallClassification).toBe("POTENTIALLY_DESTRUCTIVE");
  });

  it("classifies an added required field WITH a default as SAFE", () => {
    const before = schema([field({ key: "title", type: "text" })]);
    const after = schema([
      field({ key: "title", type: "text" }),
      field({ key: "status", type: "select", required: true, defaultValue: "draft" }),
    ]);
    const diff = computeSchemaDiff(before, after);
    expect(diff.entries[0].classification).toBe("SAFE");
  });

  it("classifies a removed field as DESTRUCTIVE", () => {
    const before = schema([field({ key: "title", type: "text" }), field({ key: "legacy_banner", type: "text" })]);
    const after = schema([field({ key: "title", type: "text" })]);
    const diff = computeSchemaDiff(before, after);
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]).toMatchObject({ kind: "removed", fieldKey: "legacy_banner", classification: "DESTRUCTIVE" });
    expect(diff.overallClassification).toBe("DESTRUCTIVE");
  });

  it("classifies a field type change as REQUIRES_DATA_MIGRATION", () => {
    const before = schema([field({ key: "revenue", type: "text" })]);
    const after = schema([field({ key: "revenue", type: "number" })]);
    const diff = computeSchemaDiff(before, after);
    expect(diff.entries[0].classification).toBe("REQUIRES_DATA_MIGRATION");
    expect(diff.overallClassification).toBe("REQUIRES_DATA_MIGRATION");
  });

  it("classifies narrowing maxLength as POTENTIALLY_DESTRUCTIVE and widening it as no change", () => {
    const before = schema([field({ key: "excerpt", type: "text", validation: { maxLength: 250 } })]);
    const narrowed = schema([field({ key: "excerpt", type: "text", validation: { maxLength: 100 } })]);
    const widened = schema([field({ key: "excerpt", type: "text", validation: { maxLength: 400 } })]);

    expect(computeSchemaDiff(before, narrowed).entries[0].classification).toBe("POTENTIALLY_DESTRUCTIVE");
    expect(computeSchemaDiff(before, widened).entries).toEqual([]);
  });

  it("classifies making an existing field required as POTENTIALLY_DESTRUCTIVE", () => {
    const before = schema([field({ key: "author", type: "text", required: false })]);
    const after = schema([field({ key: "author", type: "text", required: true })]);
    const diff = computeSchemaDiff(before, after);
    expect(diff.entries[0].classification).toBe("POTENTIALLY_DESTRUCTIVE");
  });

  it("takes the worst classification across multiple changes as the overall result", () => {
    const before = schema([
      field({ key: "title", type: "text" }),
      field({ key: "legacy_banner", type: "text" }),
    ]);
    const after = schema([
      field({ key: "title", type: "text" }),
      field({ key: "new_optional", type: "text" }),
    ]);
    const diff = computeSchemaDiff(before, after);
    // legacy_banner removed (DESTRUCTIVE) + new_optional added (SAFE) -> overall DESTRUCTIVE
    expect(diff.overallClassification).toBe("DESTRUCTIVE");
  });

  it("classifies downgrading capability to data_only as POTENTIALLY_DESTRUCTIVE", () => {
    const before = schema([field({ key: "title", type: "text" })], { capability: "publishable" });
    const after = schema([field({ key: "title", type: "text" })], { capability: "data_only" });
    const diff = computeSchemaDiff(before, after);
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]).toMatchObject({ fieldKey: "__capability__", classification: "POTENTIALLY_DESTRUCTIVE" });
  });

  it("classifies upgrading capability from content_enabled to publishable as SAFE", () => {
    const before = schema([field({ key: "title", type: "text" })], { capability: "content_enabled" });
    const after = schema([field({ key: "title", type: "text" })], { capability: "publishable" });
    const diff = computeSchemaDiff(before, after);
    expect(diff.entries[0]).toMatchObject({ fieldKey: "__capability__", classification: "SAFE" });
    expect(diff.overallClassification).toBe("SAFE");
  });

  it("reports no capability entry when capability is unchanged", () => {
    const before = schema([field({ key: "title", type: "text" })], { capability: "content_enabled" });
    const after = schema([field({ key: "title", type: "text" })]);
    const diff = computeSchemaDiff(before, after);
    expect(diff.entries).toEqual([]);
  });
});
