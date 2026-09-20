import { describe, expect, it } from "vitest";
import { emptyRichText, isRichTextDocument, richTextPlainText } from "@/lib/content/richText";

describe("portable rich-text document", () => {
  it("recognizes the canonical document format", () => expect(isRichTextDocument(emptyRichText())).toBe(true));
  it("rejects opaque HTML and extracts plain text from valid documents", () => {
    expect(isRichTextDocument("<h1>Unsafe canonical HTML</h1>")).toBe(false);
    expect(richTextPlainText({ type: "document", version: 1, content: [{ type: "heading", level: 2, text: "Hello" }, { type: "bullet_list", items: ["One", "Two"] }] })).toBe("Hello\nOne\nTwo");
  });
});
