export const FIELD_TYPES = [
  "text",
  "long_text",
  "rich_text",
  "markdown",
  "number",
  "integer",
  "boolean",
  "date",
  "datetime",
  "slug",
  "email",
  "url",
  "select",
  "multi_select",
  "json",
  "media",
  "file",
  "relation",
  "component",
  "repeater",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldValidationConfig {
  required?: boolean;
  unique?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  options?: string[];
}

export interface RelationConfig {
  targetModelApiKey: string;
  cardinality: "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
  onDelete: "block" | "remove_reference" | "archive_dependents";
}

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  localized: boolean;
  unique: boolean;
  defaultValue?: unknown;
  validation?: FieldValidationConfig;
  relation?: RelationConfig;
  /** For "slug" fields: the field key this one is generated from. */
  generatedFrom?: string;
  /** Request a basic (non-unique) index for filter/sort performance. `unique` already implies one. */
  index?: boolean;
  /**
   * True when this field's storage/behavior depends on a specific database
   * provider (e.g. a provider-only full-text/vector type) rather than the
   * portable PostgreSQL core. Surfaced by the Advanced/API studio views as a
   * portability warning — see ADR-011/ADR-012 and ADR-016.
   */
  providerSpecific?: boolean;
  uiHints?: Record<string, unknown>;
}

/**
 * What a Data Model is allowed to do. "data_only" models never expose
 * publish/workflow/route/preview controls; "publishable" models get the
 * full content-operations surface. See ADR-016.
 */
export const MODEL_CAPABILITIES = ["data_only", "content_enabled", "publishable"] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const MODEL_OPERATIONS = ["read", "create", "edit", "publish", "archive", "delete"] as const;
export type ModelOperation = (typeof MODEL_OPERATIONS)[number];

/**
 * Schema-level intent for who may perform which record operations on this
 * model, compiled later into platform permissions (and, where applicable,
 * RLS policy) by the permission engine. Never a second permissions
 * authority — the platform `permissions`/`role_permissions` tables remain
 * authoritative at enforcement time.
 */
export interface ModelPermissionPolicy {
  role: string;
  operations: ModelOperation[];
}

export interface CanonicalSchema {
  name: string;
  apiKey: string;
  description?: string;
  /**
   * Defaults to "content_enabled" when omitted (see
   * `resolveModelCapability`) so canonical schema versions persisted before
   * this field existed remain valid without a retroactive migration.
   */
  capability?: ModelCapability;
  permissions?: ModelPermissionPolicy[];
  fields: FieldDefinition[];
}

/** Read a schema's capability, defaulting older versions that predate this field. */
export function resolveModelCapability(schema: Pick<CanonicalSchema, "capability">): ModelCapability {
  return schema.capability ?? "content_enabled";
}

/**
 * Strips the `publish` operation from every policy once a model becomes
 * `data_only` — the same structural rule `CanonicalSchemaZ` enforces
 * server-side (ADR-016), applied proactively so a UI that lets an author
 * switch capability after already granting `publish` doesn't leave a stale,
 * disabled-but-checked checkbox that only surfaces as a 400 on submit.
 */
export function stripDisallowedPermissions(capability: ModelCapability, permissions: ModelPermissionPolicy[]): ModelPermissionPolicy[] {
  if (capability !== "data_only") return permissions;
  return permissions.map((policy) => ({ ...policy, operations: policy.operations.filter((op) => op !== "publish") }));
}

/** A new record's starting data: every field's declared `defaultValue`, keyed by field key. */
export function defaultEntryData(schema: Pick<CanonicalSchema, "fields">): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (field.defaultValue !== undefined) data[field.key] = field.defaultValue;
  }
  return data;
}

/**
 * Everything the schema engine needs to know about one field type, in one
 * place — the alternative to spreading `switch (field.type)` logic across
 * the admin UI, the API routes, and the (future) schema compiler. See
 * docs/adr/ADR-004-content-field-registry.md.
 */
export interface FieldTypeDefinition {
  type: FieldType;
  label: string;
  /**
   * The Postgres type this field WOULD compile to if/when a physical
   * per-model table is ever generated (not done in Phase 1 — entries are
   * stored generically as JSONB in content_entries, see ADR-005). Recorded
   * now so the "Advanced Schema Studio" compatibility view (brief §24) has
   * something to show without redesigning the registry later.
   */
  postgresType: string;
  /** Which FieldValidationConfig keys are meaningful for this type. */
  supportedValidation: (keyof FieldValidationConfig)[];
  /** Validates one value against this field's definition. Empty array = valid. */
  validateValue: (value: unknown, field: FieldDefinition) => string[];
}
