import { describe, expect, it } from "vitest";
import { compileModelContract } from "@/lib/schema/compilerContract";
import type { CanonicalSchema } from "@/lib/schema/fields/types";

const testSchema: CanonicalSchema = {
  name: "Product",
  apiKey: "product",
  description: "E-commerce product catalog",
  capability: "content_enabled",
  fields: [
    {
      key: "title",
      label: "Title",
      type: "text",
      required: true,
      localized: false,
      unique: false,
      validation: { minLength: 3, maxLength: 100 },
      uiHints: { placeholder: "Product name" },
    },
    {
      key: "sku",
      label: "SKU",
      type: "text",
      required: true,
      localized: false,
      unique: true,
      index: true,
    },
    {
      key: "price",
      label: "Price",
      type: "number",
      required: true,
      localized: false,
      unique: false,
      defaultValue: 0,
      validation: { min: 0 },
    },
    {
      key: "category",
      label: "Category",
      type: "text",
      required: false,
      localized: false,
      unique: false,
      relation: {
        targetModelApiKey: "category",
        cardinality: "many_to_one",
        onDelete: "block",
      },
    },
    {
      key: "body",
      label: "Description",
      type: "rich_text",
      required: false,
      localized: false,
      unique: false,
    },
  ],
};

describe("Canonical Schema Compiler Contract (Phase 1E)", () => {
  it("compiles canonical schema into typed internal model contract", () => {
    const contract = compileModelContract(testSchema, 1);

    expect(contract.apiKey).toBe("product");
    expect(contract.version).toBe(1);
    expect(contract.primaryKey).toBe("id");
    expect(contract.tableMapping.canonicalTable).toBe("content_entries");
    expect(contract.tableMapping.versionTable).toBe("content_entry_versions");
    expect(contract.tableMapping.uniqueProjectionTable).toBe("content_entry_unique_values");

    // Form mapping
    expect(contract.fields.title.form.componentType).toBe("TextInput");
    expect(contract.fields.title.form.placeholder).toBe("Product name");
    expect(contract.fields.price.form.componentType).toBe("NumberInput");
    expect(contract.fields.body.form.componentType).toBe("RichTextEditor");

    // PostgreSQL migration intent
    expect(contract.fields.title.postgres.isNullable).toBe(false);
    expect(contract.fields.sku.postgres.hasUniqueConstraint).toBe(true);
    expect(contract.fields.sku.postgres.hasIndex).toBe(true);
    expect(contract.fields.category.postgres.foreignKeyTarget).toEqual({
      targetModelApiKey: "category",
      onDelete: "block",
    });

    // Portability summary
    expect(contract.portabilitySummary.isStandardPostgresCompatible).toBe(true);
    expect(contract.portabilitySummary.requiresPgTrgm).toBe(true);
  });
});
