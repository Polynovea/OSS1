import { describe, expect, it } from "vitest";
import { chooseAutomaticMigrationStrategy, migrationStrategyClassification } from "@/lib/intelligence/migrationStrategyService";
import type { CanonicalSchema } from "@/lib/schema/fields/types";

function schema(fields: Array<Record<string, unknown>>): CanonicalSchema {
  return { name: "Phase 12.75 Test", apiKey: "phase_test", fields } as unknown as CanonicalSchema;
}

function assessment(input: Partial<Record<string, unknown>> = {}) {
  return {
    hard_blockers_json: [],
    deterministic_classification: "safe",
    provenance_state: "proven",
    target_schema_version: 2,
    target_schema_hash: "target-hash",
    ...input,
  };
}

describe("Phase 12.75 migration strategy intelligence", () => {
  it("chooses direct metadata deployment only when target evidence has no hard blockers", () => {
    expect(chooseAutomaticMigrationStrategy(assessment(), schema([]))).toMatchObject({ strategyKey: "direct_metadata_change" });
  });

  it("chooses a staged backfill only when every required field has an explicit canonical default", () => {
    const target = schema([{ key: "region", label: "Region", type: "text", required: true, defaultValue: "unknown" }]);
    expect(chooseAutomaticMigrationStrategy(assessment({
      hard_blockers_json: [{ code: "REQUIRED_BACKFILL", fieldKey: "region", affectedRecords: 10 }],
      deterministic_classification: "requires_backfill",
    }), target)).toMatchObject({ strategyKey: "staged_backfill" });
  });

  it("refuses to invent a backfill value when a required field has no canonical default", () => {
    const target = schema([{ key: "region", label: "Region", type: "text", required: true }]);
    expect(chooseAutomaticMigrationStrategy(assessment({
      hard_blockers_json: [{ code: "REQUIRED_BACKFILL", fieldKey: "region", affectedRecords: 10 }],
      deterministic_classification: "requires_backfill",
    }), target)).toBeNull();
  });

  it("uses retain-and-deprecate only when populated field removal is the sole blocker class", () => {
    expect(chooseAutomaticMigrationStrategy(assessment({
      hard_blockers_json: [{ code: "POPULATED_FIELD_REMOVAL", fieldKey: "legacy", affectedRecords: 5 }],
      deterministic_classification: "potentially_destructive",
    }), schema([]))).toMatchObject({ strategyKey: "deprecate_retain" });
  });

  it("does not auto-resolve semantic duplicate conflicts", () => {
    expect(chooseAutomaticMigrationStrategy(assessment({
      hard_blockers_json: [{ code: "DUPLICATE_VALUES", fieldKey: "slug", affectedRecords: 3 }],
      deterministic_classification: "requires_data_migration",
    }), schema([{ key: "slug", label: "Slug", type: "text", unique: true }]))).toBeNull();
  });

  it("never downgrades staged data work to SAFE classification", () => {
    expect(migrationStrategyClassification("staged_backfill", assessment())).toBe("requires_backfill");
    expect(migrationStrategyClassification("copy_transform_verify", assessment())).toBe("requires_data_migration");
    expect(migrationStrategyClassification("deprecate_retain", assessment({ deterministic_classification: "potentially_destructive" }))).toBe("safe");
  });
});
