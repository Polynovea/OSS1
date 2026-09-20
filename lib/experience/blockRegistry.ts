import type {
  BlockDefinition,
  ExperienceBlock,
  ExperienceDocument,
} from "./types";
import { ExperienceDocumentZ } from "./types";

export function isSafeUrl(url: unknown, mode: "link" | "media" = "link"): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed === "" || trimmed === "#") return true;

  // Protocol-relative URLs like //evil.example.com MUST BE REJECTED
  if (trimmed.startsWith("//")) {
    return false;
  }

  // Safe relative paths, fragments, and queries
  if (
    (trimmed.startsWith("/") && !trimmed.startsWith("//")) ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("?") ||
    trimmed.startsWith("./")
  ) {
    return true;
  }

  // Reject unsafe schemes explicitly
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return false;
  }

  // Check valid absolute URLs with allowed protocols
  try {
    const parsed = new URL(trimmed);
    const allowed = mode === "media" ? ["https:", "http:"] : ["https:", "http:", "mailto:", "tel:"];
    return allowed.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export const REGISTERED_BLOCKS: Record<string, BlockDefinition> = {
  hero: {
    type: "hero",
    label: "Hero Showcase",
    category: "hero",
    description: "High-impact opening section with headline, subtext, actions, and media.",
    icon: "Sparkles",
    defaultVariant: "standard",
    variants: [
      { key: "standard", label: "Standard", description: "Balanced headline with side/background media." },
      { key: "fullscreen", label: "Fullscreen", description: "Immersive viewport-filling hero." },
      { key: "compact", label: "Compact", description: "Subtle header section for content pages." },
    ],
    fields: [
      { key: "badge", label: "Eyebrow / Badge", type: "text", defaultValue: "Introducing Polynovea" },
      { key: "title", label: "Headline", type: "text", required: true, defaultValue: "Content Operations Elevated" },
      { key: "subtitle", label: "Subheadline", type: "textarea", defaultValue: "Governed visual composition, safe releases, and real-time delivery observability for mission-critical teams." },
      { key: "primaryCtaLabel", label: "Primary Button Label", type: "text", defaultValue: "Get Started" },
      { key: "primaryCtaUrl", label: "Primary Button URL", type: "url", defaultValue: "/get-started" },
      { key: "secondaryCtaLabel", label: "Secondary Button Label", type: "text", defaultValue: "View Demo" },
      { key: "secondaryCtaUrl", label: "Secondary Button URL", type: "url", defaultValue: "/demo" },
      { key: "mediaUrl", label: "Cover Image / Media URL", type: "media", defaultValue: "" },
      {
        key: "alignment",
        label: "Text Alignment",
        type: "select",
        defaultValue: "left",
        options: [
          { label: "Left Aligned", value: "left" },
          { label: "Center Aligned", value: "center" },
        ],
      },
    ],
  },
  features: {
    type: "features",
    label: "Feature Grid",
    category: "content",
    description: "Structured product or capability highlights in responsive multi-column layouts.",
    icon: "Layers",
    defaultVariant: "3_col",
    variants: [
      { key: "2_col", label: "2 Columns", description: "Expansive two-column cards with large detail." },
      { key: "3_col", label: "3 Columns", description: "Classic balanced three-column feature cards." },
      { key: "4_col", label: "4 Columns", description: "Dense multi-feature matrix." },
    ],
    fields: [
      { key: "kicker", label: "Section Kicker", type: "text", defaultValue: "CORE ARCHITECTURE" },
      { key: "title", label: "Section Title", type: "text", required: true, defaultValue: "Engineered for Enterprise Delivery" },
      { key: "subtitle", label: "Section Description", type: "textarea", defaultValue: "Unified content workflows combining developer-controlled contracts with visual agility." },
      {
        key: "items",
        label: "Feature Cards",
        type: "repeater",
        itemSchema: [
          { key: "title", label: "Card Title", type: "text", required: true },
          { key: "description", label: "Card Description", type: "textarea" },
          { key: "icon", label: "Icon Name", type: "text" },
        ],
        defaultValue: [
          { title: "Visual Schema Studio", description: "Model complex entities with relational integrity and automated migrations.", icon: "Layers" },
          { title: "Safe Atomic Releases", description: "Bundle entries and dependencies for transactional promotion across stages.", icon: "ShieldCheck" },
          { title: "Real-Time Observability", description: "Live edge delivery metrics, cache ratios, and instant rollback safety.", icon: "GitCommit" },
        ],
      },
    ],
  },
  cta: {
    type: "cta",
    label: "Call to Action",
    category: "cta",
    description: "High-conversion banner driving audience to signup, contact, or release demos.",
    icon: "ArrowRight",
    defaultVariant: "gold",
    variants: [
      { key: "gold", label: "Obsidian Gold Glow", description: "Polynovea signature dark gold border with glow." },
      { key: "glass", label: "Glassmorphism", description: "Translucent frosted background." },
      { key: "minimal", label: "Minimalist Border", description: "Clean border without gradient fill." },
    ],
    fields: [
      { key: "title", label: "Headline", type: "text", required: true, defaultValue: "Ready to Transform Your Content Operations?" },
      { key: "description", label: "Supporting Text", type: "textarea", defaultValue: "Join forward-thinking engineering and editorial teams shipping governed digital experiences faster." },
      { key: "primaryLabel", label: "Primary Button Text", type: "text", required: true, defaultValue: "Start Free Today" },
      { key: "primaryUrl", label: "Primary Button URL", type: "url", required: true, defaultValue: "/signup" },
      { key: "secondaryLabel", label: "Secondary Button Text", type: "text", defaultValue: "Talk to Engineering" },
      { key: "secondaryUrl", label: "Secondary Button URL", type: "url", defaultValue: "/contact" },
    ],
  },
  faq: {
    type: "faq",
    label: "FAQ Accordion",
    category: "content",
    description: "Collapsible questions and answers addressing customer inquiries.",
    icon: "HelpCircle",
    defaultVariant: "standard",
    variants: [
      { key: "standard", label: "Single Column", description: "Centered single-column accordion." },
      { key: "two_column", label: "Two Column Grid", description: "Split layout for extensive question sets." },
    ],
    fields: [
      { key: "kicker", label: "Section Kicker", type: "text", defaultValue: "FREQUENTLY ASKED QUESTIONS" },
      { key: "title", label: "Title", type: "text", required: true, defaultValue: "Everything You Need to Know" },
      { key: "subtitle", label: "Subtitle", type: "textarea", defaultValue: "Common technical and operational questions about Polynovea CMS." },
      {
        key: "items",
        label: "Questions & Answers",
        type: "repeater",
        itemSchema: [
          { key: "question", label: "Question", type: "text", required: true },
          { key: "answer", label: "Answer", type: "textarea", required: true },
        ],
        defaultValue: [
          { question: "How does the Visual Experience Studio work?", answer: "Developers build and lock responsive component contracts. Editors safely compose, reorder, and populate blocks without arbitrary HTML/CSS escape." },
          { question: "Can we rollback changes instantly?", answer: "Yes. Every save creates an immutable version. Releases can be rolled back transactionally with sub-second propagation." },
          { question: "Does this replace the headless API?", answer: "No. Visual compositions are stored as canonical structured JSON consumed directly by the public API and Next.js frontends." },
        ],
      },
    ],
  },
  stats: {
    type: "stats",
    label: "Key Metrics & Stats",
    category: "social_proof",
    description: "Numeric proof points highlighting performance, uptime, and scale.",
    icon: "BarChart2",
    defaultVariant: "grid",
    variants: [
      { key: "grid", label: "4-Column Grid", description: "Evenly spaced metric cards." },
      { key: "bar", label: "Horizontal Bar", description: "Single grouped stat bar." },
    ],
    fields: [
      { key: "title", label: "Section Title (Optional)", type: "text", defaultValue: "Proven Scale & Reliability" },
      {
        key: "items",
        label: "Metrics",
        type: "repeater",
        itemSchema: [
          { key: "value", label: "Metric Value", type: "text", required: true },
          { key: "suffix", label: "Suffix", type: "text" },
          { key: "label", label: "Metric Label", type: "text", required: true },
        ],
        defaultValue: [
          { value: "99.99", suffix: "%", label: "Edge Delivery SLA" },
          { value: "< 12", suffix: "ms", label: "Average Global Latency" },
          { value: "10M", suffix: "+", label: "Monthly API Transactions" },
          { value: "0", suffix: "sec", label: "Rollback Propagation Time" },
        ],
      },
    ],
  },
  testimonial: {
    type: "testimonial",
    label: "Testimonial Card",
    category: "social_proof",
    description: "Customer quote with avatar, title, company, and rating.",
    icon: "Quote",
    defaultVariant: "card",
    variants: [
      { key: "card", label: "Contained Card", description: "Dark obsidian card with golden star rating." },
      { key: "heroic", label: "Large Heroic Quote", description: "Extra large typography without boundary card." },
    ],
    fields: [
      { key: "quote", label: "Quote Text", type: "textarea", required: true, defaultValue: "Polynovea eliminated the tension between our frontend developers and editorial team. We ship landing pages in minutes with zero breaking changes." },
      { key: "author", label: "Author Name", type: "text", required: true, defaultValue: "Elena Vance" },
      { key: "role", label: "Role / Title", type: "text", defaultValue: "VP of Digital Engineering" },
      { key: "company", label: "Company", type: "text", defaultValue: "Aether Dynamics" },
      { key: "avatarUrl", label: "Avatar Image URL", type: "media", defaultValue: "" },
      { key: "rating", label: "Star Rating (1-5)", type: "number", defaultValue: 5 },
    ],
  },
  logos: {
    type: "logos",
    label: "Logo Wall / Proof",
    category: "social_proof",
    description: "Row of partner, customer, or investor brand logos.",
    icon: "Sparkles",
    defaultVariant: "standard",
    variants: [
      { key: "standard", label: "Monochrome Row", description: "Subtle grayscale brand marks with hover reveal." },
      { key: "grid", label: "Logo Grid", description: "Structured matrix for 6+ partner logos." },
    ],
    fields: [
      { key: "label", label: "Section Label", type: "text", defaultValue: "TRUSTED BY ENGINEERING TEAMS AT" },
      { key: "grayscale", label: "Grayscale Effect", type: "boolean", defaultValue: true },
      {
        key: "items",
        label: "Brand Items",
        type: "repeater",
        itemSchema: [
          { key: "name", label: "Brand Name", type: "text", required: true },
          { key: "logoUrl", label: "Logo Media URL", type: "media" },
        ],
        defaultValue: [
          { name: "VORTEX CLOUD", logoUrl: "" },
          { name: "SYNAPSE LABS", logoUrl: "" },
          { name: "CHRONOS AI", logoUrl: "" },
          { name: "HYPERION DATA", logoUrl: "" },
          { name: "NEBULA HEALTH", logoUrl: "" },
        ],
      },
    ],
  },
  rich_text: {
    type: "rich_text",
    label: "Rich Editorial Prose",
    category: "content",
    description: "Long-form editorial body with headings, formatted paragraphs, and lists.",
    icon: "FileText",
    defaultVariant: "standard",
    variants: [
      { key: "standard", label: "Standard Width", description: "Optimal 72ch reading width." },
      { key: "narrow", label: "Narrow Editorial", description: "Centered reading column." },
      { key: "wide", label: "Wide Layout", description: "Fuller width for technical documentation." },
    ],
    fields: [
      { key: "content", label: "Prose Body", type: "textarea", required: true, defaultValue: "Polynovea provides an opinionated yet modular architecture for modern content engineering..." },
    ],
  },
  media_showcase: {
    type: "media_showcase",
    label: "Media & Graphic Showcase",
    category: "media",
    description: "Heroic standalone photo, graphic, or video demonstration.",
    icon: "Image",
    defaultVariant: "standard",
    variants: [
      { key: "standard", label: "Standard Framed", description: "Contained within page width with subtle border." },
      { key: "full_bleed", label: "Full Bleed", description: "Stretches edge-to-edge across the screen." },
    ],
    fields: [
      { key: "mediaUrl", label: "Image or Video URL", type: "media", required: true, defaultValue: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80" },
      { key: "caption", label: "Caption / Description", type: "text", defaultValue: "Architectural overview diagram" },
      { key: "altText", label: "Alt Text (Accessibility)", type: "text", defaultValue: "System architecture preview" },
      {
        key: "aspectRatio",
        label: "Aspect Ratio",
        type: "select",
        defaultValue: "16:9",
        options: [
          { label: "16 : 9 (Widescreen)", value: "16:9" },
          { label: "4 : 3 (Classic)", value: "4:3" },
          { label: "1 : 1 (Square)", value: "1:1" },
          { label: "Auto (Natural)", value: "auto" },
        ],
      },
    ],
  },
};

export function getRegisteredBlocks(): BlockDefinition[] {
  return Object.values(REGISTERED_BLOCKS);
}

export function getBlockDefinition(type: string): BlockDefinition | undefined {
  return REGISTERED_BLOCKS[type];
}

export function emptyExperienceDocument(): ExperienceDocument {
  return {
    version: 1,
    blocks: [],
  };
}

export function createDefaultBlock(type: string, variant?: string): ExperienceBlock {
  const def = getBlockDefinition(type);
  if (!def) {
    return {
      id: crypto.randomUUID(),
      blockType: type,
      variant: variant || "standard",
      data: {},
    };
  }

  const initialData: Record<string, unknown> = {};
  for (const field of def.fields) {
    if (field.defaultValue !== undefined) {
      initialData[field.key] = field.defaultValue;
    }
  }

  return {
    id: crypto.randomUUID(),
    blockType: type,
    variant: variant || def.defaultVariant || "standard",
    data: initialData,
  };
}

export function isExperienceDocument(value: unknown): value is ExperienceDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const parsed = ExperienceDocumentZ.safeParse(value);
  if (!parsed.success) return false;
  return validateExperienceDocument(parsed.data).valid;
}

export function validateExperienceDocument(doc: unknown): { valid: boolean; errors: string[] } {
  const parsed = ExperienceDocumentZ.safeParse(doc);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  const errors: string[] = [];
  const document = parsed.data;

  for (let idx = 0; idx < document.blocks.length; idx++) {
    const block = document.blocks[idx];
    const def = getBlockDefinition(block.blockType);
    if (!def) {
      errors.push(`Block #${idx + 1} (${block.id}): Unknown block type "${block.blockType}"`);
      continue;
    }

    if (block.variant && def.variants) {
      const allowedKeys = def.variants.map((v) => v.key);
      if (!allowedKeys.includes(block.variant)) {
        errors.push(
          `Block #${idx + 1} (${def.label}): Invalid variant "${block.variant}". Allowed: ${allowedKeys.join(", ")}`
        );
      }
    }

    for (const field of def.fields) {
      const val = block.data[field.key];

      // Required check
      if (field.required) {
        if (val === undefined || val === null || val === "") {
          errors.push(`Block #${idx + 1} (${def.label}): Required field "${field.label}" is missing`);
          continue;
        }
      }

      // If value is provided, validate field type & structure
      if (val !== undefined && val !== null && val !== "") {
        switch (field.type) {
          case "text":
          case "textarea":
            if (typeof val !== "string") {
              errors.push(`Block #${idx + 1} (${def.label}): "${field.label}" must be a string`);
            }
            break;

          case "number":
            if (typeof val !== "number" && isNaN(Number(val))) {
              errors.push(`Block #${idx + 1} (${def.label}): "${field.label}" must be a valid number`);
            }
            break;

          case "boolean":
            if (typeof val !== "boolean") {
              errors.push(`Block #${idx + 1} (${def.label}): "${field.label}" must be a boolean`);
            }
            break;

          case "url":
            if (!isSafeUrl(val, "link")) {
              errors.push(
                `Block #${idx + 1} (${def.label}): "${field.label}" contains an unsafe or invalid URL protocol`
              );
            }
            break;

          case "media":
            if (!isSafeUrl(val, "media")) {
              errors.push(
                `Block #${idx + 1} (${def.label}): "${field.label}" contains an unsafe or invalid media URL protocol`
              );
            }
            break;

          case "select":
            if (field.options && !field.options.some((opt) => opt.value === val)) {
              errors.push(
                `Block #${idx + 1} (${def.label}): "${val}" is not an allowed option for "${field.label}"`
              );
            }
            break;

          case "repeater":
            if (!Array.isArray(val)) {
              errors.push(`Block #${idx + 1} (${def.label}): "${field.label}" must be a list of items`);
              break;
            }

            if (field.itemSchema && Array.isArray(field.itemSchema)) {
              for (let rIdx = 0; rIdx < val.length; rIdx++) {
                const item = val[rIdx];
                if (!item || typeof item !== "object" || Array.isArray(item)) {
                  errors.push(
                    `Block #${idx + 1} (${def.label}) -> ${field.label} #${rIdx + 1}: Item must be a valid structured object`
                  );
                  continue;
                }

                for (const itemField of field.itemSchema) {
                  const itemVal = item[itemField.key];

                  if (itemField.required) {
                    if (itemVal === undefined || itemVal === null || itemVal === "") {
                      errors.push(
                        `Block #${idx + 1} (${def.label}) -> ${field.label} #${rIdx + 1}: Required property "${itemField.label}" is missing`
                      );
                      continue;
                    }
                  }

                  if (itemVal !== undefined && itemVal !== null && itemVal !== "") {
                    if ((itemField.type === "text" || itemField.type === "textarea") && typeof itemVal !== "string") {
                      errors.push(
                        `Block #${idx + 1} (${def.label}) -> ${field.label} #${rIdx + 1}: "${itemField.label}" must be a string`
                      );
                    } else if (itemField.type === "number" && typeof itemVal !== "number" && isNaN(Number(itemVal))) {
                      errors.push(
                        `Block #${idx + 1} (${def.label}) -> ${field.label} #${rIdx + 1}: "${itemField.label}" must be a valid number`
                      );
                    } else if (itemField.type === "boolean" && typeof itemVal !== "boolean") {
                      errors.push(
                        `Block #${idx + 1} (${def.label}) -> ${field.label} #${rIdx + 1}: "${itemField.label}" must be a boolean`
                      );
                    } else if (itemField.type === "url" && !isSafeUrl(itemVal, "link")) {
                      errors.push(
                        `Block #${idx + 1} (${def.label}) -> ${field.label} #${rIdx + 1}: "${itemField.label}" contains an unsafe or invalid URL`
                      );
                    } else if (itemField.type === "media" && !isSafeUrl(itemVal, "media")) {
                      errors.push(
                        `Block #${idx + 1} (${def.label}) -> ${field.label} #${rIdx + 1}: "${itemField.label}" contains an unsafe or invalid media URL`
                      );
                    }
                  }
                }
              }
            }
            break;
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
