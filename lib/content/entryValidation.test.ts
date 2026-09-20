import { describe, expect, it } from "vitest";
import { extractEntryRelations, validateEntryData } from "@/lib/content/entryValidation";
import type { CanonicalSchema } from "@/lib/schema/fields/types";

const schema: CanonicalSchema = {
  name: "Article", apiKey: "article", fields: [
    { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false },
    { key: "author", label: "Author", type: "relation", required: false, localized: false, unique: false, relation: { targetModelApiKey: "person", cardinality: "many_to_one", onDelete: "block" } },
  ],
};

describe("generic entry validation", () => {
  it("rejects unknown and missing required fields", () => {
    expect(validateEntryData(schema, { unknown: true })).toEqual(expect.arrayContaining([expect.stringMatching(/Unknown/), expect.stringMatching(/required/)]));
  });
  it("extracts authoritative relation edges from relation fields", () => {
    expect(extractEntryRelations(schema, { title: "Hello", author: "entry-1" })).toEqual([{ fieldKey: "author", targetEntryId: "entry-1", relationType: "many_to_one" }]);
  });
});
