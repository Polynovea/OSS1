"use client";

import { useState } from "react";
import { AlertCircle, Code2, List, MessageSquareQuote, Plus, Quote, TextQuote } from "lucide-react";
import { emptyRichText, type RichTextDocument, type RichTextNode } from "@/lib/content/richText";

const templates: Array<{ type: RichTextNode["type"]; label: string; icon: typeof TextQuote }> = [
  { type: "paragraph", label: "Paragraph", icon: TextQuote }, { type: "heading", label: "Heading", icon: Quote }, { type: "bullet_list", label: "List", icon: List }, { type: "quote", label: "Quote", icon: MessageSquareQuote }, { type: "code", label: "Code", icon: Code2 }, { type: "callout", label: "Callout", icon: AlertCircle },
];
const createNode = (type: RichTextNode["type"]): RichTextNode => type === "heading" ? { type, level: 2, text: "" } : type === "bullet_list" ? { type, items: [""] } : type === "callout" ? { type, tone: "info", text: "" } : { type: type as "paragraph" | "quote" | "code", text: "" };

export default function RichTextEditor({ value, onChange }: { value: RichTextDocument | undefined; onChange: (value: RichTextDocument) => void }) {
  const document = value || emptyRichText(); const [pickerOpen, setPickerOpen] = useState(false);
  const patch = (index: number, node: RichTextNode) => onChange({ ...document, content: document.content.map((current, i) => i === index ? node : current) });
  return <div className="overflow-hidden rounded-xl border border-default bg-field">
    <div className="flex items-center justify-between border-b border-subtle bg-surface-2 px-3 py-2"><span className="text-[10px] font-bold uppercase tracking-[0.16em] text-fg-muted">Structured document · v1</span><button type="button" onClick={() => setPickerOpen((open) => !open)} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-action"><Plus size={13} /> Block</button></div>
    {pickerOpen && <div className="grid grid-cols-3 gap-1 border-b border-subtle p-2">{templates.map((template) => { const Icon = template.icon; return <button key={template.type} type="button" onClick={() => { onChange({ ...document, content: [...document.content, createNode(template.type)] }); setPickerOpen(false); }} className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-fg-muted hover:bg-action/8 hover:text-action"><Icon size={13} />{template.label}</button>; })}</div>}
    <div className="space-y-3 p-3">{document.content.map((node, index) => <Block key={index} node={node} onChange={(next) => patch(index, next)} onRemove={() => onChange({ ...document, content: document.content.length === 1 ? [createNode("paragraph")] : document.content.filter((_, i) => i !== index) })} />)}</div>
  </div>;
}
function Block({ node, onChange, onRemove }: { node: RichTextNode; onChange: (node: RichTextNode) => void; onRemove: () => void }) {
  const label = node.type.replace("_", " ");
  return <div className="group relative rounded-lg border border-subtle bg-surface-2 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-widest text-fg-muted">{label}</span><button type="button" onClick={onRemove} className="hidden text-[10px] font-bold uppercase text-fg-muted hover:text-danger group-hover:block">Remove</button></div>{node.type === "bullet_list" ? <textarea value={node.items.join("\n")} onChange={(e) => onChange({ ...node, items: e.target.value.split("\n") })} placeholder="One item per line" rows={3} className="w-full resize-none bg-transparent text-sm text-fg-primary outline-none" /> : <textarea value={node.text} onChange={(e) => onChange({ ...node, text: e.target.value })} placeholder={node.type === "heading" ? "Section heading" : "Write…"} rows={node.type === "code" ? 5 : node.type === "paragraph" ? 4 : 2} className={`w-full resize-y bg-transparent outline-none ${node.type === "heading" ? "text-xl font-bold text-fg-primary" : node.type === "code" ? "font-mono text-sm text-success" : "text-sm leading-6 text-fg-primary"}`} />}</div>;
}
