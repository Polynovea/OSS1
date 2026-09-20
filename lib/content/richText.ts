export type RichTextNode =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; language?: string; text: string }
  | { type: "bullet_list"; items: string[] }
  | { type: "callout"; tone: "info" | "warning" | "success"; text: string };

export interface RichTextDocument { type: "document"; version: 1; content: RichTextNode[]; }

export function emptyRichText(): RichTextDocument { return { type: "document", version: 1, content: [{ type: "paragraph", text: "" }] }; }

export function isRichTextDocument(value: unknown): value is RichTextDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Partial<RichTextDocument>;
  if (document.type !== "document" || document.version !== 1 || !Array.isArray(document.content)) return false;
  return document.content.every((node) => {
    if (!node || typeof node !== "object" || Array.isArray(node) || typeof (node as RichTextNode).type !== "string") return false;
    const candidate = node as RichTextNode;
    if (candidate.type === "heading") return [1, 2, 3, 4].includes(candidate.level) && typeof candidate.text === "string";
    if (candidate.type === "bullet_list") return Array.isArray(candidate.items) && candidate.items.every((item) => typeof item === "string");
    if (candidate.type === "callout") return ["info", "warning", "success"].includes(candidate.tone) && typeof candidate.text === "string";
    return ["paragraph", "quote", "code"].includes(candidate.type) && typeof candidate.text === "string";
  });
}

export function richTextPlainText(document: RichTextDocument): string {
  return document.content.map((node) => node.type === "bullet_list" ? node.items.join("\n") : node.text).join("\n");
}
