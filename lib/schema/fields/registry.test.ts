import { describe, expect, it } from "vitest";
import { FIELD_TYPE_REGISTRY } from "@/lib/schema/fields/registry";
import { FIELD_TYPES } from "@/lib/schema/fields/types";
import type { FieldDefinition } from "@/lib/schema/fields/types";

function field(overrides: Partial<FieldDefinition> & { key: string; type: FieldDefinition["type"] }): FieldDefinition {
  return { label: overrides.key, required: false, localized: false, unique: false, ...overrides };
}

describe("FIELD_TYPE_REGISTRY", () => {
  it("has an entry for every declared field type", () => {
    for (const type of FIELD_TYPES) {
      expect(FIELD_TYPE_REGISTRY[type], `missing registry entry for "${type}"`).toBeDefined();
    }
  });

  it("text: enforces required, minLength, and maxLength", () => {
    const def = FIELD_TYPE_REGISTRY.text;
    const f = field({ key: "title", type: "text", required: true, validation: { minLength: 5, maxLength: 10 } });
    expect(def.validateValue(undefined, f)).toHaveLength(1);
    expect(def.validateValue("hi", f)).toHaveLength(1); // too short
    expect(def.validateValue("this is way too long", f)).toHaveLength(1); // too long
    expect(def.validateValue("hello", f)).toHaveLength(0);
  });

  it("integer: rejects non-integers and enforces min/max", () => {
    const def = FIELD_TYPE_REGISTRY.integer;
    const f = field({ key: "count", type: "integer", validation: { min: 0, max: 10 } });
    expect(def.validateValue(3.5, f)).toHaveLength(1);
    expect(def.validateValue(-1, f)).toHaveLength(1);
    expect(def.validateValue(11, f)).toHaveLength(1);
    expect(def.validateValue(5, f)).toHaveLength(0);
  });

  it("boolean: only accepts true/false", () => {
    const def = FIELD_TYPE_REGISTRY.boolean;
    const f = field({ key: "active", type: "boolean" });
    expect(def.validateValue("yes", f)).toHaveLength(1);
    expect(def.validateValue(true, f)).toHaveLength(0);
    expect(def.validateValue(false, f)).toHaveLength(0);
  });

  it("slug: enforces lowercase-hyphen format", () => {
    const def = FIELD_TYPE_REGISTRY.slug;
    const f = field({ key: "slug", type: "slug", required: true });
    expect(def.validateValue("Not A Slug", f)).toHaveLength(1);
    expect(def.validateValue("valid-slug-123", f)).toHaveLength(0);
  });

  it("email: enforces a plausible email shape", () => {
    const def = FIELD_TYPE_REGISTRY.email;
    const f = field({ key: "contact", type: "email" });
    expect(def.validateValue("not-an-email", f)).toHaveLength(1);
    expect(def.validateValue("person@example.com", f)).toHaveLength(0);
  });

  it("select: only accepts one of the configured options", () => {
    const def = FIELD_TYPE_REGISTRY.select;
    const f = field({ key: "status", type: "select", validation: { options: ["draft", "published"] } });
    expect(def.validateValue("archived", f)).toHaveLength(1);
    expect(def.validateValue("draft", f)).toHaveLength(0);
  });

  it("multi_select: rejects non-arrays and values outside the option set", () => {
    const def = FIELD_TYPE_REGISTRY.multi_select;
    const f = field({ key: "tags", type: "multi_select", validation: { options: ["a", "b"] } });
    expect(def.validateValue("a", f)).toHaveLength(1);
    expect(def.validateValue(["a", "z"], f)).toHaveLength(1);
    expect(def.validateValue(["a", "b"], f)).toHaveLength(0);
  });

  it("repeater: requires an array", () => {
    const def = FIELD_TYPE_REGISTRY.repeater;
    const f = field({ key: "items", type: "repeater" });
    expect(def.validateValue({ not: "an array" }, f)).toHaveLength(1);
    expect(def.validateValue([1, 2, 3], f)).toHaveLength(0);
  });
});
