/**
 * Canonical Schema Compiler Contract (Phase 1E).
 *
 * Defines the internal deterministic compiler output representation for:
 * - Validation metadata & rules
 * - Form metadata & UI hints
 * - PostgreSQL migration intent
 * - REST / Delivery API representation
 * - Multi-cloud portability warnings
 *
 * Note: External SDK / OpenAPI / CLI generation is assigned to Phase 12.
 */
import type { CanonicalSchema, FieldDefinition, FieldType } from "@/lib/schema/fields/types";
import { FIELD_TYPE_REGISTRY } from "@/lib/schema/fields/registry";

export interface CompiledFieldValidationMetadata {
  required: boolean;
  unique: boolean;
  localized: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  options?: string[];
}

export interface CompiledFieldFormMetadata {
  componentType: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  hidden?: boolean;
  readOnly?: boolean;
}

export interface CompiledPostgresMigrationIntent {
  columnName: string;
  postgresType: string;
  isNullable: boolean;
  hasUniqueConstraint: boolean;
  hasIndex: boolean;
  foreignKeyTarget?: { targetModelApiKey: string; onDelete: string };
}

export interface CompiledFieldMetadata {
  key: string;
  type: FieldType;
  label: string;
  defaultValue: unknown;
  validation: CompiledFieldValidationMetadata;
  form: CompiledFieldFormMetadata;
  postgres: CompiledPostgresMigrationIntent;
  apiExposed: boolean;
  portabilityWarnings: string[];
}

export interface CompiledModelContract {
  apiKey: string;
  name: string;
  description: string | null;
  capability: string;
  version: number;
  fields: Record<string, CompiledFieldMetadata>;
  primaryKey: string;
  tableMapping: {
    canonicalTable: "content_entries";
    versionTable: "content_entry_versions";
    uniqueProjectionTable: "content_entry_unique_values";
  };
  apiEndpoints: {
    list: string;
    get: string;
    create: string;
    update: string;
    publish: string;
    archive: string;
  };
  portabilitySummary: {
    isStandardPostgresCompatible: boolean;
    requiresPgTrgm: boolean;
    hasProviderSpecificFields: boolean;
  };
}

/**
 * Compiles a canonical schema definition into its typed internal compiler contract.
 */
export function compileModelContract(schema: CanonicalSchema, currentVersion = 1): CompiledModelContract {
  const fields: Record<string, CompiledFieldMetadata> = {};
  let hasProviderSpecific = false;

  for (const field of schema.fields) {
    const registryEntry = FIELD_TYPE_REGISTRY[field.type];
    const postgresType = registryEntry?.postgresType ?? "jsonb";
    const portabilityWarnings: string[] = [];

    if (field.providerSpecific) {
      hasProviderSpecific = true;
      portabilityWarnings.push(`Field "${field.key}" uses provider-specific features.`);
    }

    if (field.type === "rich_text" || field.type === "component") {
      portabilityWarnings.push(`Field "${field.key}" stores JSONB documents requiring JSON-aware indexing.`);
    }

    fields[field.key] = {
      key: field.key,
      type: field.type,
      label: field.label,
      defaultValue: field.defaultValue ?? null,
      validation: {
        required: Boolean(field.required),
        unique: Boolean(field.unique),
        localized: Boolean(field.localized),
        minLength: field.validation?.minLength,
        maxLength: field.validation?.maxLength,
        min: field.validation?.min,
        max: field.validation?.max,
        pattern: field.validation?.pattern,
        options: field.validation?.options,
      },
      form: {
        componentType: deriveFormComponentType(field.type),
        label: field.label,
        placeholder: (field.uiHints?.placeholder as string) || undefined,
        helpText: (field.uiHints?.helpText as string) || undefined,
        hidden: Boolean(field.uiHints?.hidden),
        readOnly: Boolean(field.uiHints?.readOnly),
      },
      postgres: {
        columnName: field.key,
        postgresType,
        isNullable: !field.required,
        hasUniqueConstraint: Boolean(field.unique),
        hasIndex: Boolean(field.index || field.unique),
        foreignKeyTarget: field.relation
          ? {
              targetModelApiKey: field.relation.targetModelApiKey,
              onDelete: field.relation.onDelete,
            }
          : undefined,
      },
      apiExposed: true,
      portabilityWarnings,
    };
  }

  return {
    apiKey: schema.apiKey,
    name: schema.name,
    description: schema.description ?? null,
    capability: schema.capability ?? "content_enabled",
    version: currentVersion,
    fields,
    primaryKey: "id",
    tableMapping: {
      canonicalTable: "content_entries",
      versionTable: "content_entry_versions",
      uniqueProjectionTable: "content_entry_unique_values",
    },
    apiEndpoints: {
      list: `/api/content/${schema.apiKey}`,
      get: `/api/content/${schema.apiKey}/:id`,
      create: `/api/entries?modelId=${schema.apiKey}`,
      update: `/api/entries/:id`,
      publish: `/api/entries/:id/publish`,
      archive: `/api/entries/:id/archive`,
    },
    portabilitySummary: {
      isStandardPostgresCompatible: true,
      requiresPgTrgm: true,
      hasProviderSpecificFields: hasProviderSpecific,
    },
  };
}

function deriveFormComponentType(type: FieldType): string {
  switch (type) {
    case "text":
    case "email":
    case "url":
    case "slug":
      return "TextInput";
    case "long_text":
      return "TextArea";
    case "rich_text":
      return "RichTextEditor";
    case "markdown":
      return "MarkdownEditor";
    case "number":
    case "integer":
      return "NumberInput";
    case "boolean":
      return "SwitchToggle";
    case "date":
      return "DatePicker";
    case "datetime":
      return "DateTimePicker";
    case "select":
      return "SelectDropdown";
    case "multi_select":
      return "MultiSelectPills";
    case "json":
      return "JsonEditor";
    case "component":
      return "ExperienceBlockEditor";
    default:
      return "GenericInput";
  }
}
