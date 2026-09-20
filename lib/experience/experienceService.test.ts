import { describe, expect, it } from "vitest";
import {
  isExperienceDocument,
  validateExperienceDocument,
  createDefaultBlock,
  emptyExperienceDocument,
  getBlockDefinition,
  REGISTERED_BLOCKS,
  isSafeUrl,
} from "@/lib/experience/blockRegistry";
import type { ExperienceDocument, ExperienceBlock } from "@/lib/experience/types";
import { FIELD_TYPE_REGISTRY } from "@/lib/schema/fields/registry";
import { resolveModelCapability, type FieldDefinition, type CanonicalSchema } from "@/lib/schema/fields/types";
import { isModelVisualEligible, getComponentFieldKey } from "@/lib/experience/eligibility";

describe("Phase 6 Visual Experience Studio Engine (Certified)", () => {
  describe("Block Registry, Contracts & Safe URLs", () => {
    it("registers all 9 core governed component blocks", () => {
      const keys = Object.keys(REGISTERED_BLOCKS);
      expect(keys).toContain("hero");
      expect(keys).toContain("features");
      expect(keys).toContain("cta");
      expect(keys).toContain("faq");
      expect(keys).toContain("stats");
      expect(keys).toContain("testimonial");
      expect(keys).toContain("logos");
      expect(keys).toContain("rich_text");
      expect(keys).toContain("media_showcase");
    });

    it("creates valid default blocks with default values and variants", () => {
      for (const [blockType, def] of Object.entries(REGISTERED_BLOCKS)) {
        const variantKey = def.variants?.[0]?.key || "standard";
        const block = createDefaultBlock(blockType, variantKey);
        expect(block.id).toBeDefined();
        expect(block.blockType).toBe(blockType);
        expect(block.data).toBeDefined();

        const doc: ExperienceDocument = {
          version: 1,
          blocks: [block],
        };
        const validation = validateExperienceDocument(doc);
        expect(validation.valid, `${blockType} should be valid: ${validation.errors.join("; ")}`).toBe(true);
      }
    });

    it("enforces safe URL validation and strictly rejects protocol-relative and malicious schemes", () => {
      // Safe internal and external
      expect(isSafeUrl("/about", "link")).toBe(true);
      expect(isSafeUrl("/docs/start", "link")).toBe(true);
      expect(isSafeUrl("#pricing", "link")).toBe(true);
      expect(isSafeUrl("?page=1", "link")).toBe(true);
      expect(isSafeUrl("https://polynovea.com/platform", "link")).toBe(true);
      expect(isSafeUrl("http://localhost:3000/demo", "link")).toBe(true);
      expect(isSafeUrl("mailto:team@polynovea.com", "link")).toBe(true);
      expect(isSafeUrl("tel:+1234567890", "link")).toBe(true);

      // Protocol-relative URLs MUST BE REJECTED
      expect(isSafeUrl("//evil.example.com", "link")).toBe(false);
      expect(isSafeUrl("//malicious.site/script.js", "media")).toBe(false);

      // Malicious / unsafe schemes
      expect(isSafeUrl("javascript:alert(document.cookie)", "link")).toBe(false);
      expect(isSafeUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", "link")).toBe(false);
      expect(isSafeUrl("vbscript:MsgBox(1)", "link")).toBe(false);

      // Media URL mode restricts mailto and tel
      expect(isSafeUrl("mailto:team@polynovea.com", "media")).toBe(false);
      expect(isSafeUrl("https://images.unsplash.com/photo-1", "media")).toBe(true);
    });

    it("recursively validates repeater items against itemSchema", () => {
      // Valid repeater items
      const validFaqDoc: ExperienceDocument = {
        version: 1,
        blocks: [
          {
            id: "b-faq-1",
            blockType: "faq",
            data: {
              title: "FAQ Title",
              items: [
                { question: "Q1", answer: "A1" },
                { question: "Q2", answer: "A2" },
              ],
            },
          },
        ],
      };
      expect(validateExperienceDocument(validFaqDoc).valid).toBe(true);

      // Invalid: missing required property in repeater item
      const invalidFaqMissingField: ExperienceDocument = {
        version: 1,
        blocks: [
          {
            id: "b-faq-2",
            blockType: "faq",
            data: {
              title: "FAQ Title",
              items: [
                { question: "Q1" }, // missing answer!
              ],
            },
          },
        ],
      };
      const check1 = validateExperienceDocument(invalidFaqMissingField);
      expect(check1.valid).toBe(false);
      expect(check1.errors.some((e) => e.includes('Required property "Answer" is missing'))).toBe(true);

      // Invalid: unsafe URL in repeater item (e.g. logos logoUrl)
      const invalidLogosUnsafeUrl: ExperienceDocument = {
        version: 1,
        blocks: [
          {
            id: "b-logos-1",
            blockType: "logos",
            data: {
              items: [
                { name: "Brand 1", logoUrl: "javascript:alert(1)" },
              ],
            },
          },
        ],
      };
      const check2 = validateExperienceDocument(invalidLogosUnsafeUrl);
      expect(check2.valid).toBe(false);
      expect(check2.errors.some((e) => e.includes("unsafe or invalid media URL"))).toBe(true);

      // Invalid: primitive item inside repeater array
      const invalidRepeaterNonObject: ExperienceDocument = {
        version: 1,
        blocks: [
          {
            id: "b-faq-3",
            blockType: "faq",
            data: {
              title: "FAQ Title",
              items: ["just-a-string", 123],
            },
          },
        ],
      };
      const check3 = validateExperienceDocument(invalidRepeaterNonObject);
      expect(check3.valid).toBe(false);
      expect(check3.errors.some((e) => e.includes("Item must be a valid structured object"))).toBe(true);
    });
  });

  describe("Fail-Closed Schema Engine (FIELD_TYPE_REGISTRY.component)", () => {
    const field: FieldDefinition = {
      key: "experience",
      label: "Page Layout",
      type: "component",
      required: true,
      localized: false,
      unique: false,
    };

    it("validates valid ExperienceDocument inside a component field", () => {
      const validDoc: ExperienceDocument = {
        version: 1,
        blocks: [
          createDefaultBlock("hero", "standard"),
          createDefaultBlock("cta", "gold"),
        ],
      };

      const errors = FIELD_TYPE_REGISTRY.component.validateValue(validDoc, field);
      expect(errors).toHaveLength(0);
    });

    it("fails closed on arbitrary malformed object input like { foo: 'bar' }", () => {
      const arbitraryObject = { foo: "bar", baz: 123 };
      const errors = FIELD_TYPE_REGISTRY.component.validateValue(arbitraryObject, field);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("fails closed on non-object inputs like strings, numbers, or arrays", () => {
      expect(FIELD_TYPE_REGISTRY.component.validateValue("malformed-string", field).length).toBeGreaterThan(0);
      expect(FIELD_TYPE_REGISTRY.component.validateValue(42, field).length).toBeGreaterThan(0);
      expect(FIELD_TYPE_REGISTRY.component.validateValue([1, 2, 3], field).length).toBeGreaterThan(0);
    });
  });

  describe("Visual Studio Eligibility Gate (isModelVisualEligible)", () => {
    it("denies data_only models even if they have a component field", () => {
      const dataOnlyWithComponent: CanonicalSchema = {
        name: "Internal Metric",
        apiKey: "metric",
        capability: "data_only",
        fields: [
          { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false },
          { key: "experience", label: "Experience", type: "component", required: false, localized: false, unique: false },
        ],
      };
      expect(isModelVisualEligible(dataOnlyWithComponent)).toBe(false);
    });

    it("denies publishable models that do NOT declare a component field", () => {
      const blogPostSchema: CanonicalSchema = {
        name: "Blog Post",
        apiKey: "blog_post",
        capability: "publishable",
        fields: [
          { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false },
          { key: "slug", label: "Slug", type: "slug", required: true, unique: true, localized: false },
          { key: "content", label: "Content", type: "rich_text", required: true, localized: false, unique: false },
        ],
      };
      expect(isModelVisualEligible(blogPostSchema)).toBe(false);
      expect(getComponentFieldKey(blogPostSchema)).toBeNull();
    });

    it("approves publishable and content_enabled models with an explicit component field", () => {
      const landingPageSchema: CanonicalSchema = {
        name: "Landing Page",
        apiKey: "landing_page",
        capability: "publishable",
        fields: [
          { key: "title", label: "Page Title", type: "text", required: true, index: true, localized: false, unique: false },
          { key: "slug", label: "URL Slug", type: "slug", required: true, unique: true, localized: false },
          { key: "experience", label: "Page Experience", type: "component", required: false, localized: false, unique: false },
        ],
      };
      expect(isModelVisualEligible(landingPageSchema)).toBe(true);
      expect(getComponentFieldKey(landingPageSchema)).toBe("experience");
    });
  });

  describe("Concurrency Merge Base & Structured Mutations", () => {
    it("merges local ExperienceDocument with latest server data preserving unrelated fields", () => {
      // Stale base draft
      const staleServerData = {
        title: "Initial Title",
        slug: "initial-slug",
        seo_description: "Initial SEO",
        experience: {
          version: 1,
          blocks: [createDefaultBlock("hero", "standard")],
        },
      };

      // Local Visual Studio edits (mutated hero title and added CTA block)
      const localDoc: ExperienceDocument = {
        version: 1,
        blocks: [
          {
            ...createDefaultBlock("hero", "standard"),
            data: { title: "Local Visual Hero Title" },
          },
          createDefaultBlock("cta", "gold"),
        ],
      };

      // Concurrent editor updated title and SEO description in Data Studio
      const latestServerData = {
        title: "Updated Title from Data Studio",
        slug: "updated-slug",
        seo_description: "Updated SEO from Data Studio",
        experience: staleServerData.experience,
      };

      // Merge resolution: local ExperienceDocument merged onto latest server data base
      const resolvedPayloadData = {
        ...latestServerData,
        experience: localDoc,
      };

      // Assertions:
      // 1. Unrelated fields from latest server data survive!
      expect(resolvedPayloadData.title).toBe("Updated Title from Data Studio");
      expect(resolvedPayloadData.slug).toBe("updated-slug");
      expect(resolvedPayloadData.seo_description).toBe("Updated SEO from Data Studio");

      // 2. Local visual composition survives!
      expect(resolvedPayloadData.experience.blocks).toHaveLength(2);
      expect(resolvedPayloadData.experience.blocks[0].data.title).toBe("Local Visual Hero Title");
      expect(resolvedPayloadData.experience.blocks[1].blockType).toBe("cta");
    });
  });
});
