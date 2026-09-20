import type { CanonicalSchema } from "@/lib/schema/fields/types";
import { createDefaultBlock } from "./blockRegistry";
import type { ExperienceDocument } from "./types";

export const LANDING_PAGE_MODEL_SCHEMA: CanonicalSchema = {
  name: "Landing Page",
  apiKey: "landing_page",
  capability: "publishable",
  fields: [
    { key: "title", label: "Page Title", type: "text", required: true, index: true, localized: false, unique: false },
    { key: "slug", label: "URL Slug", type: "slug", required: true, unique: true, generatedFrom: "title", localized: false },
    { key: "seo_description", label: "SEO Description", type: "long_text", required: false, localized: false, unique: false },
    { key: "experience", label: "Page Experience", type: "component", required: false, localized: false, unique: false },
  ],
};

export function getDefaultStarterExperience(): ExperienceDocument {
  return {
    version: 1,
    blocks: [
      createDefaultBlock("hero", "standard"),
      createDefaultBlock("logos", "standard"),
      createDefaultBlock("features", "3_col"),
      createDefaultBlock("stats", "grid"),
      createDefaultBlock("testimonial", "card"),
      createDefaultBlock("faq", "standard"),
      createDefaultBlock("cta", "gold"),
    ],
  };
}
