import { describe, expect, it } from "vitest";
import { evaluatePreflight } from "@/lib/content/preflightRules";
import type { CanonicalSchema } from "@/lib/schema/fields/types";

const schema: CanonicalSchema = { name: "Article", apiKey: "article", fields: [
  { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false },
  { key: "slug", label: "Slug", type: "slug", required: true, localized: false, unique: true },
  { key: "link", label: "Link", type: "url", required: false, localized: false, unique: false },
  { key: "related", label: "Related", type: "relation", required: false, localized: false, unique: false, relation: { targetModelApiKey: "article", cardinality: "many_to_one", onDelete: "block" } },
] };
const base = { schema, data: { title: "A story", slug: "a-story", link: "https://example.com" }, entryStatus: "approved", duplicateFields: [], missingRelations: [], unpublishedRelations: [], previewAvailable: true };
describe("evaluatePreflight", () => {
  it("returns ready evidence for a complete approved draft", () => { const results = evaluatePreflight(base); expect(results.some((item) => item.status === "fail")).toBe(false); expect(results.find((item) => item.rule_id === "workflow.approval")?.status).toBe("pass"); });
  it("blocks localhost, duplicate unique values, missing dependencies, and unapproved content", () => { const results = evaluatePreflight({ ...base, data: { ...base.data, link: "http://localhost:3000" }, entryStatus: "draft", duplicateFields: ["slug"], missingRelations: ["related"] }); expect(results.filter((item) => item.status === "fail").map((item) => item.rule_id)).toEqual(expect.arrayContaining(["link.localhost", "content.unique", "reference.exists", "workflow.approval"])); });
});
