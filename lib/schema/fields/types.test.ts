import { describe, expect, it } from "vitest";
import { defaultEntryData, resolveModelCapability, stripDisallowedPermissions } from "@/lib/schema/fields/types";
import type { CanonicalSchema, FieldDefinition } from "@/lib/schema/fields/types";

describe("resolveModelCapability", () => {
  it("defaults to content_enabled when capability is absent (pre-ADR-016 schema versions)", () => {
    expect(resolveModelCapability({})).toBe("content_enabled");
  });
  it("returns the declared capability when present", () => {
    expect(resolveModelCapability({ capability: "data_only" })).toBe("data_only");
  });
});

describe("stripDisallowedPermissions", () => {
  it("removes publish from every policy when capability is data_only", () => {
    const result = stripDisallowedPermissions("data_only", [
      { role: "editor", operations: ["read", "publish"] },
      { role: "admin", operations: ["publish", "delete"] },
    ]);
    expect(result).toEqual([
      { role: "editor", operations: ["read"] },
      { role: "admin", operations: ["delete"] },
    ]);
  });

  it("leaves permissions untouched for content_enabled and publishable capabilities", () => {
    const policies = [{ role: "editor", operations: ["publish"] as ("publish")[] }];
    expect(stripDisallowedPermissions("content_enabled", [...policies])).toEqual(policies);
    expect(stripDisallowedPermissions("publishable", [...policies])).toEqual(policies);
  });
});

describe("defaultEntryData", () => {
  const field = (overrides: Partial<FieldDefinition> & { key: string; type: FieldDefinition["type"] }): FieldDefinition => ({
    label: overrides.key, required: false, localized: false, unique: false, ...overrides,
  });

  it("collects only fields that declare a defaultValue", () => {
    const schema: Pick<CanonicalSchema, "fields"> = {
      fields: [
        field({ key: "status", type: "select", defaultValue: "draft" }),
        field({ key: "title", type: "text" }),
        field({ key: "featured", type: "boolean", defaultValue: false }),
      ],
    };
    expect(defaultEntryData(schema)).toEqual({ status: "draft", featured: false });
  });

  it("returns an empty object when no field declares a default", () => {
    expect(defaultEntryData({ fields: [field({ key: "title", type: "text" })] })).toEqual({});
  });
});
