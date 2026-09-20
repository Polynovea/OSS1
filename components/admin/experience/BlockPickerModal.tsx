"use client";

import React, { useState } from "react";
import {
  getRegisteredBlocks,
  getBlockDefinition,
} from "@/lib/experience/blockRegistry";
import type { BlockDefinition } from "@/lib/experience/types";
import {
  X,
  Sparkles,
  Layers,
  Megaphone,
  HelpCircle,
  TrendingUp,
  Quote,
  Shield,
  FileText,
  Image,
  Plus,
} from "lucide-react";

interface BlockPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectBlock: (blockType: string, variant?: string) => void;
}

const CATEGORY_MAP: Record<
  BlockDefinition["category"],
  { label: string; icon: React.ElementType }
> = {
  hero: { label: "Hero & Headers", icon: Sparkles },
  content: { label: "Content & Features", icon: Layers },
  social_proof: { label: "Social Proof & Metrics", icon: TrendingUp },
  cta: { label: "Call to Action", icon: Megaphone },
  media: { label: "Media Showcase", icon: Image },
};

const BLOCK_ICONS: Record<string, React.ElementType> = {
  hero: Sparkles,
  features: Layers,
  cta: Megaphone,
  faq: HelpCircle,
  stats: TrendingUp,
  testimonial: Quote,
  logos: Shield,
  rich_text: FileText,
  media_showcase: Image,
};

export default function BlockPickerModal({
  isOpen,
  onClose,
  onSelectBlock,
}: BlockPickerModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  if (!isOpen) return null;

  const blocks = getRegisteredBlocks();

  const filteredBlocks = blocks.filter((b) => {
    const matchesCategory =
      selectedCategory === "all" || b.category === selectedCategory;
    const matchesSearch =
      b.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.type.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl rounded-2xl border border-subtle bg-surface-1 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-subtle bg-surface-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-action">
              Visual Experience Studio
            </p>
            <h2 className="text-xl font-bold text-white mt-1">
              Add Registered Component Block
            </h2>
            <p className="text-xs text-fg-secondary mt-1">
              Choose from developer-approved, responsive components to insert into your page.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-fg-muted hover:text-white hover:bg-surface-2 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar: Category tabs & search */}
        <div className="px-6 py-3 border-b border-subtle bg-canvas flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-colors cursor-pointer ${
                selectedCategory === "all"
                  ? "ui-btn ui-btn-primary"
                  : "text-fg-secondary hover:text-fg-primary hover:bg-surface-2"
              }`}
            >
              All Blocks ({blocks.length})
            </button>
            {(
              Object.keys(CATEGORY_MAP) as Array<BlockDefinition["category"]>
            ).map((cat) => {
              const meta = CATEGORY_MAP[cat];
              const count = blocks.filter((b) => b.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide flex items-center gap-1.5 transition-colors cursor-pointer ${
                    selectedCategory === cat
                      ? "ui-btn ui-btn-primary"
                      : "text-fg-secondary hover:text-fg-primary hover:bg-surface-2"
                  }`}
                >
                  <meta.icon size={13} />
                  <span>{meta.label}</span>
                  <span className="opacity-60 text-[10px]">({count})</span>
                </button>
              );
            })}
          </div>

          <input
            type="text"
            placeholder="Search blocks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-field border border-subtle rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-fg-muted focus:outline-none focus:border-action w-48"
          />
        </div>

        {/* Block Grid */}
        <div className="p-6 overflow-y-auto flex-1 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredBlocks.map((block) => {
            const Icon = BLOCK_ICONS[block.type] || Layers;
            return (
              <div
                key={block.type}
                className="rounded-xl border border-subtle bg-surface-2 p-5 flex flex-col justify-between hover:border-action/40 hover:-translate-y-0.5 transition-all group"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-9 h-9 rounded-lg bg-action/10 border border-action/20 flex items-center justify-center text-action">
                      <Icon size={18} />
                    </div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-fg-muted bg-surface-2 px-2 py-0.5 rounded">
                      {block.category.replace("_", " ")}
                    </span>
                  </div>
                  <h3 className="font-bold text-sm text-white group-hover:text-action transition-colors">
                    {block.label}
                  </h3>
                  <p className="text-xs text-fg-secondary mt-1 leading-relaxed line-clamp-2">
                    {block.description}
                  </p>
                </div>

                <div className="mt-5 pt-3 border-t border-subtle">
                  {block.variants && block.variants.length > 1 ? (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[10px] font-semibold text-fg-muted uppercase tracking-wider">
                        Select Variant:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {block.variants.map((v) => (
                          <button
                            key={v.key}
                            type="button"
                            onClick={() => {
                              onSelectBlock(block.type, v.key);
                              onClose();
                            }}
                            className="px-2 py-1 rounded bg-surface-2 hover:bg-action-hover hover:text-on-primary text-[11px] font-medium text-fg-secondary transition-colors cursor-pointer"
                          >
                            {v.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectBlock(block.type, block.defaultVariant);
                        onClose();
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-surface-2 hover:bg-action-hover hover:text-on-primary text-xs font-bold text-fg-primary transition-colors cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>Insert Block</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
