import { z } from "zod";
import { FIELD_TYPES, MODEL_CAPABILITIES, MODEL_OPERATIONS } from "@/lib/schema/fields/types";
import type { CanonicalSchema } from "@/lib/schema/fields/types";

const API_KEY_RE = /^[a-z][a-z0-9_]*$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;

const FieldValidationConfigZ = z
  .object({
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    options: z.array(z.string()).optional(),
  })
  .strict();

const RelationConfigZ = z.object({
  targetModelApiKey: z.string().regex(API_KEY_RE),
  cardinality: z.enum(["one_to_one", "one_to_many", "many_to_one", "many_to_many"]),
  onDelete: z.enum(["block", "remove_reference", "archive_dependents"]),
});

const FieldDefinitionZ = z.object({
  key: z.string().regex(FIELD_KEY_RE, "Field keys must be lowercase snake_case, starting with a letter"),
  label: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  localized: z.boolean().default(false),
  unique: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  validation: FieldValidationConfigZ.optional(),
  relation: RelationConfigZ.optional(),
  generatedFrom: z.string().optional(),
  index: z.boolean().optional(),
  providerSpecific: z.boolean().optional(),
  uiHints: z.record(z.string(), z.unknown()).optional(),
});

const ModelPermissionPolicyZ = z.object({
  role: z.string().min(1),
  operations: z.array(z.enum(MODEL_OPERATIONS)).min(1),
});

import { FIELD_TYPE_REGISTRY } from "@/lib/schema/fields/registry";

export const CanonicalSchemaZ = z
  .object({
    name: z.string().min(1),
    apiKey: z.string().regex(API_KEY_RE, "apiKey must be lowercase snake_case, starting with a letter"),
    description: z.string().optional(),
    capability: z.enum(MODEL_CAPABILITIES).default("content_enabled"),
    permissions: z.array(ModelPermissionPolicyZ).optional(),
    fields: z.array(FieldDefinitionZ),
  })
  .superRefine((schema, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < schema.fields.length; i++) {
      const field = schema.fields[i];
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate field key "${field.key}"`,
          path: ["fields", i, "key"],
        });
      }
      seen.add(field.key);

      if (field.type === "slug" && field.generatedFrom && !seen.has(field.generatedFrom)) {
        const targetExists = schema.fields.some((f) => f.key === field.generatedFrom);
        if (!targetExists) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Field "${field.key}" has generatedFrom "${field.generatedFrom}", which is not a field on this model`,
            path: ["fields", i, "generatedFrom"],
          });
        }
      }

      // Validate default value against field type registry
      if (field.defaultValue !== undefined && field.defaultValue !== null) {
        const validator = FIELD_TYPE_REGISTRY[field.type];
        if (validator) {
          const defErrors = validator.validateValue(field.defaultValue, { ...field, required: false });
          if (defErrors.length > 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Invalid default value for field "${field.key}": ${defErrors.join(", ")}`,
              path: ["fields", i, "defaultValue"],
            });
          }
        }
      }
    }

    if (schema.capability === "data_only" && schema.permissions?.some((p) => p.operations.includes("publish"))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A "data_only" model cannot grant a "publish" operation — publishing does not apply to non-content data`,
        path: ["permissions"],
      });
    }

    const seenRoles = new Set<string>();
    for (const policy of schema.permissions ?? []) {
      if (seenRoles.has(policy.role)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate permission policy for role "${policy.role}"`,
          path: ["permissions"],
        });
      }
      seenRoles.add(policy.role);
    }
  });

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  schema?: CanonicalSchema;
}

export function validateCanonicalSchema(input: unknown): ValidationResult {
  const result = CanonicalSchemaZ.safeParse(input);
  if (!result.success) {
    return { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
  }
  return { valid: true, errors: [], schema: result.data as CanonicalSchema };
}
