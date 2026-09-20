import { describe, expect, it } from "vitest";
import { validateCanonicalSchema } from "@/lib/schema/canonicalSchema";

const validSchema = {
  name: "Blog Post",
  apiKey: "blog_post",
  fields: [
    { key: "title", label: "Title", type: "text", required: true, validation: { minLength: 5, maxLength: 150 } },
    { key: "slug", label: "Slug", type: "slug", required: true, unique: true, generatedFrom: "title" },
  ],
};

describe("validateCanonicalSchema", () => {
  it("accepts a well-formed schema", () => {
    const result = validateCanonicalSchema(validSchema);
    expect(result.valid).toBe(true);
    expect(result.schema?.apiKey).toBe("blog_post");
  });

  it("rejects an apiKey that isn't lowercase snake_case", () => {
    const result = validateCanonicalSchema({ ...validSchema, apiKey: "Blog-Post" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/apiKey/i);
  });

  it("rejects an unknown field type", () => {
    const result = validateCanonicalSchema({
      ...validSchema,
      fields: [{ key: "title", label: "Title", type: "paragraph_of_doom" }],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects duplicate field keys", () => {
    const result = validateCanonicalSchema({
      name: "Dup",
      apiKey: "dup",
      fields: [
        { key: "title", label: "Title", type: "text" },
        { key: "title", label: "Title Again", type: "text" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/duplicate/i);
  });

  it("rejects a slug field's generatedFrom pointing at a nonexistent field", () => {
    const result = validateCanonicalSchema({
      name: "Broken",
      apiKey: "broken",
      fields: [{ key: "slug", label: "Slug", type: "slug", generatedFrom: "does_not_exist" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/generatedFrom/i);
  });

  it("rejects a field key that isn't lowercase snake_case", () => {
    const result = validateCanonicalSchema({
      name: "Bad Field",
      apiKey: "bad_field",
      fields: [{ key: "Title Field", label: "Title", type: "text" }],
    });
    expect(result.valid).toBe(false);
  });

  it("defaults required/localized/unique to false when omitted", () => {
    const result = validateCanonicalSchema({
      name: "Minimal",
      apiKey: "minimal",
      fields: [{ key: "title", label: "Title", type: "text" }],
    });
    expect(result.valid).toBe(true);
    expect(result.schema?.fields[0]).toMatchObject({ required: false, localized: false, unique: false });
  });

  it("defaults capability to content_enabled when omitted", () => {
    const result = validateCanonicalSchema(validSchema);
    expect(result.valid).toBe(true);
    expect(result.schema?.capability).toBe("content_enabled");
  });

  it("accepts a data_only model with non-publish role permissions", () => {
    const result = validateCanonicalSchema({
      ...validSchema,
      apiKey: "customer",
      capability: "data_only",
      permissions: [{ role: "editor", operations: ["read", "edit"] }],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a data_only model that grants a publish operation", () => {
    const result = validateCanonicalSchema({
      ...validSchema,
      apiKey: "customer",
      capability: "data_only",
      permissions: [{ role: "editor", operations: ["publish"] }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/publish/i);
  });

  it("rejects a duplicate permission policy role", () => {
    const result = validateCanonicalSchema({
      ...validSchema,
      permissions: [
        { role: "editor", operations: ["read"] },
        { role: "editor", operations: ["edit"] },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/duplicate/i);
  });

  it("rejects an unknown capability value", () => {
    const result = validateCanonicalSchema({ ...validSchema, capability: "sometimes" });
    expect(result.valid).toBe(false);
  });

  it("accepts field-level index and providerSpecific flags", () => {
    const result = validateCanonicalSchema({
      ...validSchema,
      fields: [{ key: "title", label: "Title", type: "text", index: true, providerSpecific: true }],
    });
    expect(result.valid).toBe(true);
    expect(result.schema?.fields[0]).toMatchObject({ index: true, providerSpecific: true });
  });

  it("preserves editor-facing field help in canonical ui hints", () => {
    const result = validateCanonicalSchema({
      ...validSchema,
      fields: [{ key: "title", label: "Title", type: "text", uiHints: { helpText: "Use the customer-facing title." } }],
    });
    expect(result.valid).toBe(true);
    expect(result.schema?.fields[0].uiHints).toMatchObject({ helpText: "Use the customer-facing title." });
  });

  describe("defaultValue validation against field type (Phase 1C)", () => {
    it("rejects string default on number field", () => {
      const result = validateCanonicalSchema({
        ...validSchema,
        fields: [{ key: "age", label: "Age", type: "number", defaultValue: "hello" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toMatch(/Invalid default value.*must be a number/i);
    });

    it("rejects string default on boolean field", () => {
      const result = validateCanonicalSchema({
        ...validSchema,
        fields: [{ key: "active", label: "Active", type: "boolean", defaultValue: "true" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toMatch(/Invalid default value.*must be true or false/i);
    });

    it("rejects select default value outside allowed options", () => {
      const result = validateCanonicalSchema({
        ...validSchema,
        fields: [{ key: "status", label: "Status", type: "select", defaultValue: "archived", validation: { options: ["draft", "published"] } }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toMatch(/must be one of: draft, published/i);
    });

    it("rejects multi_select default containing invalid options", () => {
      const result = validateCanonicalSchema({
        ...validSchema,
        fields: [{ key: "tags", label: "Tags", type: "multi_select", defaultValue: ["tech", "invalid_tag"], validation: { options: ["tech", "news"] } }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toMatch(/outside the allowed options/i);
    });

    it("rejects invalid URL default", () => {
      const result = validateCanonicalSchema({
        ...validSchema,
        fields: [{ key: "website", label: "Website", type: "url", defaultValue: "not-a-url" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toMatch(/must be a valid http\(s\) URL/i);
    });

    it("accepts valid defaults matching field definitions", () => {
      const result = validateCanonicalSchema({
        ...validSchema,
        fields: [
          { key: "age", label: "Age", type: "number", defaultValue: 25 },
          { key: "active", label: "Active", type: "boolean", defaultValue: true },
          { key: "status", label: "Status", type: "select", defaultValue: "draft", validation: { options: ["draft", "published"] } },
          { key: "tags", label: "Tags", type: "multi_select", defaultValue: ["tech"], validation: { options: ["tech", "news"] } },
          { key: "website", label: "Website", type: "url", defaultValue: "https://polynovea.com" },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });
});
