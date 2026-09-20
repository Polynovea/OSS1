import type { CanonicalSchema, FieldDefinition } from "@/lib/schema/fields/types";
import { resolveModelCapability } from "@/lib/schema/fields/types";

/**
 * Visual Experience Studio Eligibility Gate (Master Plan V2 §3, §5, §13 Phase 6).
 *
 * A content model is eligible for Visual Experience Studio IF AND ONLY IF:
 * 1. Its capability is publishable or content_enabled (never data_only).
 * 2. Its canonical schema explicitly declares at least one field of type "component".
 *
 * Models without a component field (e.g. blog_post with rich_text only, customer data)
 * MUST NOT enter Visual Studio.
 */
export function isModelVisualEligible(schema: CanonicalSchema | null | undefined): boolean {
  if (!schema || !Array.isArray(schema.fields)) return false;

  const capability = resolveModelCapability(schema);
  if (capability === "data_only") {
    return false;
  }

  // Must have an explicit component field in the canonical schema
  return schema.fields.some((f) => f.type === "component");
}

/**
 * Resolves the primary component field key that holds the ExperienceDocument.
 */
export function getComponentFieldKey(schema: CanonicalSchema | null | undefined): string | null {
  if (!schema || !Array.isArray(schema.fields)) return null;
  const field =
    schema.fields.find((f) => f.type === "component" && (f.key === "experience" || f.key === "blocks")) ||
    schema.fields.find((f) => f.type === "component");
  return field?.key || null;
}
