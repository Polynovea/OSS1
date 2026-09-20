import { describe, expect, it } from "vitest";
import { validateCanonicalSchema } from "@/lib/schema/canonicalSchema";
import { MODEL_TEMPLATES } from "@/lib/schema/templates";

describe("MODEL_TEMPLATES", () => {
  it("every template produces a structurally valid canonical schema once named", () => {
    for (const template of MODEL_TEMPLATES) {
      const result = validateCanonicalSchema({ name: template.label, apiKey: template.key, ...template.schema });
      expect(result.valid, `${template.key}: ${result.errors.join("; ")}`).toBe(true);
    }
  });

  it("has no duplicate template keys", () => {
    const keys = MODEL_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
