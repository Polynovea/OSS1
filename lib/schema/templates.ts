import type { CanonicalSchema, FieldDefinition } from "@/lib/schema/fields/types";

const base = (key: string, type: FieldDefinition["type"], overrides: Partial<FieldDefinition> = {}): FieldDefinition => ({
  key,
  label: overrides.label ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
  type,
  required: overrides.required ?? false,
  localized: overrides.localized ?? false,
  unique: overrides.unique ?? false,
  ...overrides,
});

export interface ModelTemplate {
  key: string;
  label: string;
  description: string;
  /** apiKey/name are always overwritten by whatever the author types — this is just a starting point. */
  schema: Omit<CanonicalSchema, "apiKey" | "name">;
}

/**
 * Starter field sets for the "create from template" flow (V2 §4.3 / §13
 * Phase 2). These are plain data, not a second schema authority — picking
 * one just seeds the same `CanonicalSchemaZ`-validated form the blank flow
 * produces, and every field remains fully editable before submit.
 */
export const MODEL_TEMPLATES: ModelTemplate[] = [
  {
    key: "customer",
    label: "Customer",
    description: "A data-only record for CRM-style customer tracking — no publishing surface.",
    schema: {
      capability: "data_only",
      fields: [
        base("full_name", "text", { required: true, index: true }),
        base("email", "email", { required: true, unique: true }),
        base("company", "text"),
        base("status", "select", { validation: { options: ["lead", "active", "churned"] }, defaultValue: "lead" }),
        base("notes", "long_text"),
      ],
    },
  },
  {
    key: "project",
    label: "Project",
    description: "Internal project tracking with owner and status — no publishing surface.",
    schema: {
      capability: "data_only",
      fields: [
        base("title", "text", { required: true, index: true }),
        base("status", "select", { validation: { options: ["planned", "in_progress", "done", "on_hold"] }, defaultValue: "planned" }),
        base("due_date", "date"),
        base("description", "long_text"),
      ],
    },
  },
  {
    key: "product",
    label: "Product",
    description: "Publishable catalog item with price and availability.",
    schema: {
      capability: "publishable",
      fields: [
        base("name", "text", { required: true, index: true }),
        base("slug", "slug", { required: true, unique: true, generatedFrom: "name" }),
        base("price", "number", { required: true, validation: { min: 0 } }),
        base("sku", "text", { unique: true }),
        base("description", "rich_text"),
        base("cover_image", "media"),
      ],
    },
  },
  {
    key: "event",
    label: "Event",
    description: "Publishable event listing with schedule fields.",
    schema: {
      capability: "publishable",
      fields: [
        base("title", "text", { required: true, index: true }),
        base("slug", "slug", { required: true, unique: true, generatedFrom: "title" }),
        base("starts_at", "datetime", { required: true }),
        base("ends_at", "datetime"),
        base("location", "text"),
        base("summary", "long_text"),
      ],
    },
  },
  {
    key: "page",
    label: "Landing Page",
    description: "Publishable visual page composed from developer-approved components.",
    schema: {
      capability: "publishable",
      fields: [
        base("title", "text", { required: true, index: true }),
        base("slug", "slug", { required: true, unique: true, generatedFrom: "title" }),
        base("seo_description", "long_text"),
        base("experience", "component", { label: "Page Experience" }),
      ],
    },
  },
];
