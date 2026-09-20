import { randomUUID } from "crypto";
import * as cheerio from "cheerio";
import mammoth from "mammoth";
import { marked } from "marked";
import type { ContentBlock } from "./types";
import { slugify } from "./slugify";

export interface BlogDraft {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
}

const MIN_EXCERPT = 20;
const MAX_EXCERPT = 500;
const HEADING_PREVIEW_COUNT = 3;

export const SUPPORTED_IMPORT_EXTENSIONS = ["docx", "md", "markdown", "html", "htm"] as const;
export type SupportedImportExtension = (typeof SUPPORTED_IMPORT_EXTENSIONS)[number];

export function isSupportedImportExtension(ext: string): ext is SupportedImportExtension {
  return (SUPPORTED_IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function convertToHtml(buffer: Buffer, ext: SupportedImportExtension): Promise<string> {
  switch (ext) {
    case "docx": {
      const result = await mammoth.convertToHtml(
        { buffer },
        { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"] },
      );
      return result.value;
    }
    case "md":
    case "markdown":
      return marked.parse(buffer.toString("utf-8"), { async: false });
    case "html":
    case "htm":
      return buffer.toString("utf-8");
  }
}

function newBlock(title = ""): ContentBlock {
  return { id: randomUUID(), title, body: "", media: null };
}

export function htmlToBlogDraft(html: string, filename: string): BlogDraft {
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  const root = $("#__root");

  let title = "";
  const blocks: ContentBlock[] = [];
  const previewParagraphs: string[] = [];
  let current: ContentBlock | null = null;

  const commitCurrent = () => {
    if (current && current.body.trim().length > 0) blocks.push(current);
    current = null;
  };

  root.children().each((_, el) => {
    const node = $(el);

    if (node.is("h1") && !title) {
      title = node.text().replace(/\s+/g, " ").trim();
      return;
    }

    if (node.is("h1, h2, h3")) {
      commitCurrent();
      current = newBlock(node.text().replace(/\s+/g, " ").trim());
      return;
    }

    const text = node.is("ul, ol")
      ? node
          .find("li")
          .toArray()
          .map((li) => `- ${$(li).text().replace(/\s+/g, " ").trim()}`)
          .filter(Boolean)
          .join("\n")
      : node.text().replace(/\s+/g, " ").trim();

    if (!text) return;
    if (previewParagraphs.length < HEADING_PREVIEW_COUNT) previewParagraphs.push(text);
    if (!current) current = newBlock();
    current = { ...current, body: current.body ? `${current.body}\n\n${text}` : text };
  });
  commitCurrent();

  if (blocks.length === 0) blocks.push(newBlock());
  if (!title) title = titleFromFilename(filename);

  let excerpt = previewParagraphs.join(" ").trim();
  if (excerpt.length > MAX_EXCERPT) excerpt = `${excerpt.slice(0, MAX_EXCERPT - 1).trim()}…`;
  if (excerpt.length < MIN_EXCERPT) excerpt = `Imported from ${filename}. ${excerpt}`.trim();

  return {
    title,
    slug: slugify(title),
    excerpt,
    content: JSON.stringify(blocks),
  };
}
