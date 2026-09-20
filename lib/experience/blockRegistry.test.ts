import { describe, expect, it } from "vitest";
import {
  REGISTERED_BLOCKS,
  createDefaultBlock,
  emptyExperienceDocument,
  getBlockDefinition,
  getRegisteredBlocks,
  isExperienceDocument,
  validateExperienceDocument,
} from "./blockRegistry";
import type { ExperienceDocument } from "./types";

describe("Block Registry & Experience Engine", () => {
  it("registers 9 core production blocks", () => {
    const blocks = getRegisteredBlocks();
    expect(blocks.length).toBe(9);
    expect(Object.keys(REGISTERED_BLOCKS)).toEqual([
      "hero",
      "features",
      "cta",
      "faq",
      "stats",
      "testimonial",
      "logos",
      "rich_text",
      "media_showcase",
    ]);
  });

  it("retrieves block definition by type", () => {
    const heroDef = getBlockDefinition("hero");
    expect(heroDef).toBeDefined();
    expect(heroDef?.label).toBe("Hero Showcase");
    expect(heroDef?.category).toBe("hero");
    expect(heroDef?.fields.some((f) => f.key === "title")).toBe(true);

    const missingDef = getBlockDefinition("unknown_block");
    expect(missingDef).toBeUndefined();
  });

  it("creates valid default blocks with pre-populated field defaults", () => {
    const heroBlock = createDefaultBlock("hero");
    expect(heroBlock.id).toBeDefined();
    expect(heroBlock.blockType).toBe("hero");
    expect(heroBlock.variant).toBe("standard");
    expect(heroBlock.data.title).toBe("Content Operations Elevated");
    expect(heroBlock.data.alignment).toBe("left");

    const featuresBlock = createDefaultBlock("features", "2_col");
    expect(featuresBlock.blockType).toBe("features");
    expect(featuresBlock.variant).toBe("2_col");
    expect(Array.isArray(featuresBlock.data.items)).toBe(true);
  });

  it("creates empty experience documents", () => {
    const doc = emptyExperienceDocument();
    expect(doc.version).toBe(1);
    expect(doc.blocks).toEqual([]);
    expect(isExperienceDocument(doc)).toBe(true);
  });

  it("validates well-formed experience documents", () => {
    const doc: ExperienceDocument = {
      version: 1,
      blocks: [
        createDefaultBlock("hero"),
        createDefaultBlock("features"),
        createDefaultBlock("cta"),
      ],
    };

    const res = validateExperienceDocument(doc);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("detects and reports unknown block types", () => {
    const doc: ExperienceDocument = {
      version: 1,
      blocks: [
        {
          id: "block-1",
          blockType: "unsupported_widget",
          data: {},
        },
      ],
    };

    const res = validateExperienceDocument(doc);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('Unknown block type "unsupported_widget"');
  });

  it("detects invalid block variants", () => {
    const doc: ExperienceDocument = {
      version: 1,
      blocks: [
        {
          id: "hero-1",
          blockType: "hero",
          variant: "invalid_variant_name",
          data: {
            title: "Valid Title",
          },
        },
      ],
    };

    const res = validateExperienceDocument(doc);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('Invalid variant "invalid_variant_name"');
  });

  it("detects missing required block fields", () => {
    const doc: ExperienceDocument = {
      version: 1,
      blocks: [
        {
          id: "hero-1",
          blockType: "hero",
          variant: "standard",
          data: {
            title: "", // Required!
          },
        },
      ],
    };

    const res = validateExperienceDocument(doc);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('Required field "Headline" is missing');
  });

  it("identifies non-experience structures safely", () => {
    expect(isExperienceDocument(null)).toBe(false);
    expect(isExperienceDocument({})).toBe(false);
    expect(isExperienceDocument({ version: 2, blocks: [] })).toBe(false);
    expect(isExperienceDocument({ version: 1, blocks: "invalid" })).toBe(false);
  });
});
