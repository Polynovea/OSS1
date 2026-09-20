"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import MediaUpload from "./MediaUpload";
import type { ContentBlock } from "@/lib/admin/types";

interface BlockEditorProps {
  value: string;
  onChange: (json: string) => void;
  folder?: string;
}

function newBlock(): ContentBlock {
  return { id: crypto.randomUUID(), title: "", body: "", media: null };
}

function parseBlocks(value: string): ContentBlock[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    if (typeof parsed === "string" && parsed.trim().length > 0) {
      return [{ id: crypto.randomUUID(), title: "", body: parsed, media: null }];
    }
  } catch {}
  if (typeof value === "string" && value.trim().length > 0) {
    return [{ id: crypto.randomUUID(), title: "", body: value, media: null }];
  }
  return [newBlock()];
}

export default function BlockEditor({ value, onChange, folder = "blog" }: BlockEditorProps) {
  const [blocks, setBlocks] = useState<ContentBlock[]>(() => parseBlocks(value));
  const prevValueRef = useRef(value);

  // Sync when an existing post is loaded into the form
  useEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    setBlocks(parseBlocks(value));
  }, [value]);

  const commit = (next: ContentBlock[]) => {
    setBlocks(next);
    onChange(JSON.stringify(next));
  };

  const updateField = (id: string, field: keyof ContentBlock, val: string | null) =>
    commit(blocks.map((b) => (b.id === id ? { ...b, [field]: val } : b)));

  const addBlock = () => commit([...blocks, newBlock()]);

  const removeBlock = (id: string) => {
    if (blocks.length === 1) return;
    commit(blocks.filter((b) => b.id !== id));
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...blocks];
    [next[idx], next[idx + dir]] = [next[idx + dir], next[idx]];
    commit(next);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-1">
          Content Blocks
        </label>
        <button
          type="button"
          onClick={addBlock}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-outline text-[11px] font-semibold text-fg-secondary hover:text-on-surface hover:border-primary transition-colors cursor-pointer"
        >
          <Plus size={12} />
          Add Block
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {blocks.map((block, idx) => (
          <div
            key={block.id}
            className="flex flex-col gap-3 p-4 rounded-xl border border-outline bg-surface-variant/10"
          >
            {/* Block header */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-fg-muted tracking-widest uppercase">
                Block {idx + 1}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  title="Move up"
                  className="p-1.5 rounded text-fg-muted hover:text-on-surface disabled:opacity-25 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, 1)}
                  disabled={idx === blocks.length - 1}
                  title="Move down"
                  className="p-1.5 rounded text-fg-muted hover:text-on-surface disabled:opacity-25 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => removeBlock(block.id)}
                  disabled={blocks.length === 1}
                  title="Remove block"
                  className="p-1.5 rounded text-fg-muted hover:text-danger disabled:opacity-25 transition-colors cursor-pointer disabled:cursor-not-allowed ml-1"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Heading */}
            <div className="flex flex-col gap-1">
              <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-0.5">
                Heading <span className="text-fg-muted normal-case font-normal">(optional)</span>
              </label>
              <input
                value={block.title}
                onChange={(e) => updateField(block.id, "title", e.target.value)}
                placeholder="Section heading..."
                className="w-full bg-surface border border-outline rounded-md px-3 py-2 text-on-surface font-body text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors outline-none placeholder:text-fg-muted"
              />
            </div>

            {/* Body */}
            <div className="flex flex-col gap-1">
              <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-0.5">
                Body Text
              </label>
              <textarea
                rows={5}
                value={block.body}
                onChange={(e) => updateField(block.id, "body", e.target.value)}
                placeholder="Write the body content for this section..."
                className="w-full bg-surface border border-outline rounded-md px-3 py-2 text-on-surface font-body text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors outline-none resize-y placeholder:text-fg-muted"
              />
            </div>

            {/* Media */}
            <MediaUpload
              label="Image / Video (optional)"
              value={block.media}
              onChange={(url) => updateField(block.id, "media", url)}
              folder={folder}
              accept="both"
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addBlock}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed border-outline text-fg-muted hover:border-primary hover:text-primary transition-colors text-xs font-semibold cursor-pointer"
      >
        <Plus size={13} />
        Add Another Block
      </button>
    </div>
  );
}
