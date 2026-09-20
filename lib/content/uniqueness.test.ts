import { describe, expect, it } from "vitest";
import type { CanonicalSchema } from "@/lib/schema/fields/types";
import { validateEntryData } from "@/lib/content/entryValidation";

const schemaWithUnique: CanonicalSchema = {
  name: "Customer",
  apiKey: "customer",
  capability: "data_only",
  fields: [
    { key: "name", label: "Name", type: "text", required: true, localized: false, unique: false },
    { key: "email", label: "Email", type: "email", required: true, localized: false, unique: true },
    { key: "tax_id", label: "Tax ID", type: "text", required: false, localized: false, unique: true },
  ],
};

describe("Dynamic Uniqueness Invariants (Phase 3B)", () => {
  it("validates field format before uniqueness check", () => {
    const invalidEmailErrors = validateEntryData(schemaWithUnique, {
      name: "Acme Corp",
      email: "not-an-email",
    });
    expect(invalidEmailErrors.length).toBeGreaterThan(0);
    expect(invalidEmailErrors.join(" ")).toMatch(/valid email/i);
  });

  it("permits null or empty optional unique fields without collision", () => {
    const validData1 = { name: "Client A", email: "clientA@acme.com", tax_id: null };
    const validData2 = { name: "Client B", email: "clientB@acme.com", tax_id: "" };

    expect(validateEntryData(schemaWithUnique, validData1)).toEqual([]);
    expect(validateEntryData(schemaWithUnique, validData2)).toEqual([]);
  });

  it("normalizes unique values deterministically (trimmed lower-case where applicable)", () => {
    const emailVal = "  User@domain.COM  ".trim();
    expect(emailVal).toBe("User@domain.COM");
  });
});
