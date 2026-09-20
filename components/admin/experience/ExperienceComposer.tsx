"use client";

import React, { useState, useRef, useEffect } from "react";
import type {
  ExperienceDocument,
  ExperienceBlock,
  ViewportMode,
} from "@/lib/experience/types";
import {
  createDefaultBlock,
  emptyExperienceDocument,
  getBlockDefinition,
} from "@/lib/experience/blockRegistry";
import BlockRenderer from "./BlockRenderer";
import BlockPickerModal from "./BlockPickerModal";
import BlockInspector from "./BlockInspector";
import {
  Monitor,
  Tablet,
  Smartphone,
  Plus,
  Eye,
  PenTool,
  Layers,
  ChevronUp,
  ChevronDown,
  Sparkles,
  LayoutTemplate,
  SlidersHorizontal,
  ZoomIn,
} from "lucide-react";

interface ExperienceComposerProps {
  value: ExperienceDocument | null | undefined;
  onChange: (document: ExperienceDocument) => void;
  isReadOnly?: boolean;
}

const LOGICAL_VIEWPORT_WIDTHS: Record<ViewportMode, number> = {
  desktop: 1440,
  tablet: 768,
  mobile: 390,
};

export default function ExperienceComposer({
  value,
  onChange,
  isReadOnly = false,
}: ExperienceComposerProps) {
  const document = value || emptyExperienceDocument();
  const blocks = document.blocks || [];

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(
    blocks[0]?.id || null
  );
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [zoomSetting, setZoomSetting] = useState<string>("fit");
  const [calculatedScale, setCalculatedScale] = useState<number>(1);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isOutlineOpen, setIsOutlineOpen] = useState(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const selectedBlock =
    blocks.find((b) => b.id === selectedBlockId) || null;
  const selectedIndex = selectedBlock
    ? blocks.findIndex((b) => b.id === selectedBlockId)
    : -1;

  const logicalWidth = LOGICAL_VIEWPORT_WIDTHS[viewportMode];

  // Scale calculation
  useEffect(() => {
    const updateScale = () => {
      if (!canvasContainerRef.current) return;
      const availableWidth = canvasContainerRef.current.clientWidth - 48;

      if (zoomSetting === "fit") {
        if (viewportMode === "desktop") {
          const s = Math.min(1, Math.max(0.4, availableWidth / logicalWidth));
          setCalculatedScale(Number(s.toFixed(2)));
        } else if (viewportMode === "tablet") {
          const s = Math.min(1, Math.max(0.5, availableWidth / logicalWidth));
          setCalculatedScale(Number(s.toFixed(2)));
        } else {
          setCalculatedScale(1);
        }
      } else if (zoomSetting === "100") {
        setCalculatedScale(1);
      } else if (zoomSetting === "75") {
        setCalculatedScale(0.75);
      } else if (zoomSetting === "50") {
        setCalculatedScale(0.5);
      }
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [viewportMode, zoomSetting, logicalWidth, isOutlineOpen, isInspectorOpen]);

  const handleAddBlock = (blockType: string, variant?: string) => {
    const newBlock = createDefaultBlock(blockType, variant);
    const nextBlocks = [...blocks, newBlock];
    onChange({
      version: 1,
      blocks: nextBlocks,
    });
    setSelectedBlockId(newBlock.id);
    setIsInspectorOpen(true);
  };

  const handleUpdateBlock = (updated: ExperienceBlock) => {
    const nextBlocks = blocks.map((b) => (b.id === updated.id ? updated : b));
    onChange({
      version: 1,
      blocks: nextBlocks,
    });
  };

  const handleDeleteBlock = (id: string) => {
    const nextBlocks = blocks.filter((b) => b.id !== id);
    onChange({
      version: 1,
      blocks: nextBlocks,
    });
    if (selectedBlockId === id) {
      setSelectedBlockId(nextBlocks[0]?.id || null);
    }
  };

  const handleDuplicateBlock = (id: string) => {
    const target = blocks.find((b) => b.id === id);
    if (!target) return;
    const clone: ExperienceBlock = {
      ...target,
      id: crypto.randomUUID(),
      data: JSON.parse(JSON.stringify(target.data)),
    };
    const idx = blocks.findIndex((b) => b.id === id);
    const nextBlocks = [...blocks];
    nextBlocks.splice(idx + 1, 0, clone);
    onChange({
      version: 1,
      blocks: nextBlocks,
    });
    setSelectedBlockId(clone.id);
    setIsInspectorOpen(true);
  };

  const handleMoveBlock = (id: string, direction: -1 | 1) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= blocks.length) return;

    const nextBlocks = [...blocks];
    const [moved] = nextBlocks.splice(idx, 1);
    nextBlocks.splice(targetIdx, 0, moved);

    onChange({
      version: 1,
      blocks: nextBlocks,
    });
  };

  const handleApplyTemplate = (
    templateName: "landing_page" | "product_showcase"
  ) => {
    let newBlocks: ExperienceBlock[] = [];
    if (templateName === "landing_page") {
      newBlocks = [
        createDefaultBlock("hero", "standard"),
        createDefaultBlock("logos", "standard"),
        createDefaultBlock("features", "3_col"),
        createDefaultBlock("stats", "grid"),
        createDefaultBlock("testimonial", "card"),
        createDefaultBlock("faq", "standard"),
        createDefaultBlock("cta", "gold"),
      ];
    } else {
      newBlocks = [
        createDefaultBlock("hero", "fullscreen"),
        createDefaultBlock("features", "2_col"),
        createDefaultBlock("media_showcase", "standard"),
        createDefaultBlock("stats", "bar"),
        createDefaultBlock("cta", "glass"),
      ];
    }

    onChange({
      version: 1,
      blocks: newBlocks,
    });
    setSelectedBlockId(newBlocks[0]?.id || null);
  };

  return (
    <div className="flex flex-col flex-1 h-full w-full bg-canvas overflow-hidden">
      {/* ── Top Studio Toolbar ─────────────────────────────────────────── */}
      <header className="px-4 py-2.5 border-b border-subtle bg-surface-2 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          {!isPreviewMode && (
            <button
              type="button"
              onClick={() => setIsOutlineOpen(!isOutlineOpen)}
              title={isOutlineOpen ? "Hide Outline" : "Show Outline"}
              className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                isOutlineOpen
                  ? "bg-surface-2 border-default text-action"
                  : "border-subtle text-fg-secondary hover:text-white"
              }`}
            >
              <Layers size={13} />
              <span className="hidden md:inline">Outline</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-success-muted animate-pulse hidden sm:inline-block" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-action">
              Canvas
            </span>
          </div>

          <span className="text-xs font-semibold text-fg-muted hidden sm:inline">
            ({blocks.length} {blocks.length === 1 ? "block" : "blocks"})
          </span>
        </div>

        {/* Viewport & Zoom Controls */}
        <div className="flex items-center gap-2">
          {/* Logical Viewport Switcher */}
          <div className="flex items-center gap-0.5 bg-field border border-subtle p-0.5 rounded-lg">
            <button
              type="button"
              onClick={() => setViewportMode("desktop")}
              title="Desktop Logical Viewport (1440px)"
              className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                viewportMode === "desktop"
                  ? "ui-btn ui-btn-primary"
                  : "text-fg-secondary hover:text-white"
              }`}
            >
              <Monitor size={13} />
              <span className="hidden md:inline text-[11px]">Desktop (1440px)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportMode("tablet")}
              title="Tablet Logical Viewport (768px)"
              className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                viewportMode === "tablet"
                  ? "ui-btn ui-btn-primary"
                  : "text-fg-secondary hover:text-white"
              }`}
            >
              <Tablet size={13} />
              <span className="hidden md:inline text-[11px]">Tablet (768px)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportMode("mobile")}
              title="Mobile Logical Viewport (390px)"
              className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                viewportMode === "mobile"
                  ? "ui-btn ui-btn-primary"
                  : "text-fg-secondary hover:text-white"
              }`}
            >
              <Smartphone size={13} />
              <span className="hidden md:inline text-[11px]">Mobile (390px)</span>
            </button>
          </div>

          {/* Zoom Selector */}
          <div className="flex items-center gap-1 bg-field border border-subtle px-2 py-1 rounded-lg text-xs text-fg-secondary">
            <ZoomIn size={12} className="text-fg-muted" />
            <select
              value={zoomSetting}
              onChange={(e) => setZoomSetting(e.target.value)}
              className="bg-transparent text-xs text-fg-secondary font-semibold focus:outline-none cursor-pointer"
            >
              <option value="fit" className="bg-surface-2">Fit ({Math.round(calculatedScale * 100)}%)</option>
              <option value="100" className="bg-surface-2">100%</option>
              <option value="75" className="bg-surface-2">75%</option>
              <option value="50" className="bg-surface-2">50%</option>
            </select>
          </div>

          {/* Preview Toggle */}
          <button
            type="button"
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
              isPreviewMode
                ? "bg-review-muted border-review text-review"
                : "border-subtle text-fg-secondary hover:bg-surface-2"
            }`}
          >
            {isPreviewMode ? <PenTool size={12} /> : <Eye size={12} />}
            <span className="hidden sm:inline">
              {isPreviewMode ? "Edit Canvas" : "Clean Preview"}
            </span>
          </button>

          {!isPreviewMode && selectedBlock && (
            <button
              type="button"
              onClick={() => setIsInspectorOpen(!isInspectorOpen)}
              title={isInspectorOpen ? "Hide Inspector" : "Show Inspector"}
              className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                isInspectorOpen
                  ? "bg-surface-2 border-default text-action"
                  : "border-subtle text-fg-secondary hover:text-white"
              }`}
            >
              <SlidersHorizontal size={13} />
              <span className="hidden lg:inline text-[11px]">Inspector</span>
            </button>
          )}

          {!isReadOnly && (
            <button
              type="button"
              onClick={() => setIsPickerOpen(true)}
              className="px-3 py-1 rounded-lg ui-btn ui-btn-primary font-bold text-xs uppercase tracking-wider flex items-center gap-1 hover:bg-action-hover transition-colors cursor-pointer shrink-0"
            >
              <Plus size={13} />
              <span>Add Block</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Workspace: Outline | Canvas | Inspector ──────────────────── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Outline / Block Tree Panel */}
        {!isPreviewMode && isOutlineOpen && (
          <aside className="w-60 border-r border-subtle bg-surface-1 flex flex-col shrink-0 z-10 shadow-lg">
            <div className="p-3 border-b border-subtle bg-surface-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-fg-secondary flex items-center gap-1.5">
                <Layers size={12} /> Page Outline
              </span>
              <button
                type="button"
                onClick={() => setIsPickerOpen(true)}
                className="p-1 rounded text-fg-secondary hover:text-action cursor-pointer"
                title="Add Block"
              >
                <Plus size={13} />
              </button>
            </div>

            <div className="flex-1 p-2 overflow-y-auto flex flex-col gap-1">
              {blocks.length === 0 ? (
                <div className="p-4 text-center text-fg-muted text-xs">
                  No blocks yet. Click "+ Add Block" to begin composing.
                </div>
              ) : (
                blocks.map((b, idx) => {
                  const def = getBlockDefinition(b.blockType);
                  const isSelected = b.id === selectedBlockId;
                  const label =
                    (b.data?.title as string) ||
                    (b.data?.label as string) ||
                    def?.label ||
                    b.blockType;

                  return (
                    <div
                      key={b.id}
                      onClick={() => {
                        setSelectedBlockId(b.id);
                        setIsInspectorOpen(true);
                      }}
                      className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-action/10 text-action border border-action/30"
                          : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-[10px] font-mono opacity-50 shrink-0">
                          {idx + 1}
                        </span>
                        <div className="flex flex-col truncate">
                          <span className="truncate text-fg-primary font-medium text-[11px]">
                            {label}
                          </span>
                          <span className="text-[8px] uppercase tracking-wider text-fg-muted">
                            {b.blockType.replace("_", " ")}
                          </span>
                        </div>
                      </div>

                      {/* Move shortcuts */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveBlock(b.id, -1);
                          }}
                          disabled={idx === 0}
                          className="p-1 text-fg-muted hover:text-white disabled:opacity-20 cursor-pointer"
                          title="Move up"
                        >
                          <ChevronUp size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveBlock(b.id, 1);
                          }}
                          disabled={idx === blocks.length - 1}
                          className="p-1 text-fg-muted hover:text-white disabled:opacity-20 cursor-pointer"
                          title="Move down"
                        >
                          <ChevronDown size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Starter Presets */}
            {blocks.length === 0 && (
              <div className="p-3 border-t border-subtle bg-surface-2 flex flex-col gap-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-fg-secondary flex items-center gap-1">
                  <LayoutTemplate size={11} /> Starter Presets
                </span>
                <button
                  type="button"
                  onClick={() => handleApplyTemplate("landing_page")}
                  className="w-full py-1.5 px-2 rounded-lg bg-surface-2 hover:bg-action-hover hover:text-on-primary text-[10px] font-semibold text-fg-secondary transition-colors text-left cursor-pointer"
                >
                  🚀 Full Landing Page
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyTemplate("product_showcase")}
                  className="w-full py-1.5 px-2 rounded-lg bg-surface-2 hover:bg-action-hover hover:text-on-primary text-[10px] font-semibold text-fg-secondary transition-colors text-left cursor-pointer"
                >
                  ✨ Product Showcase
                </button>
              </div>
            )}
          </aside>
        )}

        {/* Center Scaled Canvas */}
        <main
          ref={canvasContainerRef}
          className="flex-1 bg-canvas p-6 md:p-10 overflow-y-auto overflow-x-auto flex flex-col items-center min-w-0"
        >
          {blocks.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 md:p-20 text-center my-auto rounded-3xl border border-dashed border-subtle bg-surface-1 max-w-xl">
              <div className="w-14 h-14 rounded-2xl bg-action/10 border border-action/20 flex items-center justify-center text-action mb-5">
                <Sparkles size={28} />
              </div>
              <h3 className="text-xl font-bold text-white">
                Blank Visual Experience Canvas
              </h3>
              <p className="text-xs text-fg-secondary max-w-sm mt-2 leading-relaxed">
                Compose digital pages from developer-approved, responsive components with direct on-canvas editing.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsPickerOpen(true)}
                  className="px-5 py-2.5 rounded-xl ui-btn ui-btn-primary font-bold text-xs uppercase tracking-wider hover:bg-action-hover transition-colors cursor-pointer"
                >
                  Add Component Block
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyTemplate("landing_page")}
                  className="px-5 py-2.5 rounded-xl border border-subtle bg-surface-2 text-fg-primary font-semibold text-xs hover:bg-surface-2 transition-colors cursor-pointer"
                >
                  Load Landing Template
                </button>
              </div>
            </div>
          ) : (
            <div
              style={{
                width: `${logicalWidth}px`,
                transform: `scale(${calculatedScale})`,
                transformOrigin: "top center",
                marginBottom: `${(calculatedScale < 1 ? (1 - calculatedScale) * 500 : 0)}px`,
              }}
              className="rounded-2xl overflow-hidden border border-subtle bg-canvas shadow-2xl shrink-0 transition-transform duration-200"
            >
              {blocks.map((block) => (
                <BlockRenderer
                  key={block.id}
                  block={block}
                  isSelected={!isPreviewMode && block.id === selectedBlockId}
                  onSelect={() => {
                    if (!isPreviewMode) {
                      setSelectedBlockId(block.id);
                      setIsInspectorOpen(true);
                    }
                  }}
                  onUpdateBlock={handleUpdateBlock}
                  isPreviewOnly={isPreviewMode}
                />
              ))}
            </div>
          )}
        </main>

        {/* Right Inspector Panel */}
        {!isPreviewMode && isInspectorOpen && selectedBlock && (
          <BlockInspector
            block={selectedBlock}
            onUpdateBlock={handleUpdateBlock}
            onDeleteBlock={handleDeleteBlock}
            onDuplicateBlock={handleDuplicateBlock}
            onMoveBlock={handleMoveBlock}
            canMoveUp={selectedIndex > 0}
            canMoveDown={
              selectedIndex !== -1 && selectedIndex < blocks.length - 1
            }
            onClose={() => setIsInspectorOpen(false)}
          />
        )}
      </div>

      {/* Block Picker Modal */}
      <BlockPickerModal
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelectBlock={handleAddBlock}
      />
    </div>
  );
}
