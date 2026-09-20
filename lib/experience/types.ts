import { z } from "zod";

export type ViewportMode = "desktop" | "tablet" | "mobile";

export type BlockFieldType =
  | "text"
  | "textarea"
  | "select"
  | "boolean"
  | "media"
  | "url"
  | "number"
  | "repeater";

export interface BlockPropertyField {
  key: string;
  label: string;
  type: BlockFieldType;
  description?: string;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  itemSchema?: Array<Omit<BlockPropertyField, "itemSchema">>; // For repeater fields
  required?: boolean;
}

export interface BlockVariant {
  key: string;
  label: string;
  description?: string;
}

export interface BlockDefinition {
  type: string;
  label: string;
  category: "hero" | "content" | "social_proof" | "cta" | "media";
  description: string;
  icon: string;
  variants?: BlockVariant[];
  defaultVariant?: string;
  fields: BlockPropertyField[];
}

export interface ExperienceBlock {
  id: string;
  blockType: string;
  variant?: string;
  data: Record<string, unknown>;
  hidden?: boolean;
}

export interface ExperienceDocument {
  version: 1;
  blocks: ExperienceBlock[];
}

export const ExperienceBlockZ = z.object({
  id: z.string().min(1),
  blockType: z.string().min(1),
  variant: z.string().optional(),
  data: z.record(z.unknown()),
  hidden: z.boolean().optional(),
});

export const ExperienceDocumentZ = z.object({
  version: z.literal(1),
  blocks: z.array(ExperienceBlockZ),
});
