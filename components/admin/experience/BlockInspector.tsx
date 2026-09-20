"use client";

import React from "react";
import { getBlockDefinition } from "@/lib/experience/blockRegistry";
import type {
  ExperienceBlock,
  BlockPropertyField,
} from "@/lib/experience/types";
import {
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Plus,
  Sparkles,
  Layers,
  Settings2,
} from "lucide-react";

interface BlockInspectorProps {
  block: ExperienceBlock | null;
  onUpdateBlock: (updated: ExperienceBlock) => void;
  onDeleteBlock: (id: string) => void;
  onDuplicateBlock: (id: string) => void;
  onMoveBlock: (id: string, direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose?: () => void;
}

export default function BlockInspector({
  block,
  onUpdateBlock,
  onDeleteBlock,
  onDuplicateBlock,
  onMoveBlock,
  canMoveUp,
  canMoveDown,
  onClose,
}: BlockInspectorProps) {
  if (!block) {
    return (
      <aside className="w-80 border-l border-subtle bg-surface-1 p-6 flex flex-col items-center justify-center text-center text-fg-muted">
        <Settings2 size={28} className="text-fg-muted mb-3" />
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-secondary">
          No Block Selected
        </p>
        <p className="text-[11px] text-fg-muted mt-1 max-w-xs">
          Click any block in the canvas or outline list to inspect and edit its properties.
        </p>
      </aside>
    );
  }

  const def = getBlockDefinition(block.blockType);
  const data = block.data || {};

  const handleFieldChange = (key: string, value: unknown) => {
    onUpdateBlock({
      ...block,
      data: {
        ...data,
        [key]: value,
      },
    });
  };

  const handleVariantChange = (variant: string) => {
    onUpdateBlock({
      ...block,
      variant,
    });
  };

  const handleToggleHidden = () => {
    onUpdateBlock({
      ...block,
      hidden: !block.hidden,
    });
  };

  const renderFieldInput = (
    field: BlockPropertyField,
    value: unknown,
    onChange: (val: unknown) => void
  ) => {
    switch (field.type) {
      case "text":
      case "url":
      case "media":
        return (
          <input
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.defaultValue ? String(field.defaultValue) : ""}
            className="w-full bg-field border border-subtle rounded-lg px-3 py-2 text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none focus:border-action transition-colors"
          />
        );

      case "textarea":
        return (
          <textarea
            rows={4}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.defaultValue ? String(field.defaultValue) : ""}
            className="w-full bg-field border border-subtle rounded-lg px-3 py-2 text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none focus:border-action transition-colors resize-y"
          />
        );

      case "number":
        return (
          <input
            type="number"
            value={value !== undefined && value !== null ? Number(value) : ""}
            onChange={(e) =>
              onChange(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="w-full bg-field border border-subtle rounded-lg px-3 py-2 text-xs text-fg-primary focus:outline-none focus:border-action transition-colors"
          />
        );

      case "boolean":
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              className="rounded border-default bg-field text-action focus:ring-[#e6d3a3] h-4 w-4"
            />
            <span className="text-xs text-fg-secondary">
              {value ? "Enabled" : "Disabled"}
            </span>
          </label>
        );

      case "select":
        return (
          <select
            value={(value as string) ?? field.defaultValue ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-field border border-subtle rounded-lg px-3 py-2 text-xs text-fg-primary focus:outline-none focus:border-action transition-colors"
          >
            {(field.options || []).map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-surface-2">
                {opt.label}
              </option>
            ))}
          </select>
        );

      case "repeater": {
        const items = Array.isArray(value) ? value : [];
        const itemSchema = field.itemSchema || [];

        const handleAddItem = () => {
          const newItem: Record<string, unknown> = {};
          itemSchema.forEach((s) => {
            if (s.defaultValue !== undefined) {
              newItem[s.key] = s.defaultValue;
            }
          });
          onChange([...items, newItem]);
        };

        const handleRemoveItem = (idx: number) => {
          onChange(items.filter((_, i) => i !== idx));
        };

        const handleUpdateItem = (
          idx: number,
          itemKey: string,
          itemVal: unknown
        ) => {
          const updated = items.map((it, i) =>
            i === idx ? { ...it, [itemKey]: itemVal } : it
          );
          onChange(updated);
        };

        return (
          <div className="flex flex-col gap-3">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg border border-subtle bg-field flex flex-col gap-2 relative group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-fg-muted uppercase">
                    Item #{idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(idx)}
                    className="p-1 rounded text-fg-muted hover:text-danger transition-colors cursor-pointer"
                    title="Remove item"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {itemSchema.map((s) => (
                  <div key={s.key} className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-fg-secondary">
                      {s.label}
                    </label>
                    {renderFieldInput(
                      s as BlockPropertyField,
                      item[s.key],
                      (val) => handleUpdateItem(idx, s.key, val)
                    )}
                  </div>
                ))}
              </div>
            ))}

            <button
              type="button"
              onClick={handleAddItem}
              className="flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-subtle text-xs font-semibold text-fg-secondary hover:text-action hover:border-action/40 transition-colors cursor-pointer"
            >
              <Plus size={13} />
              <span>Add Item</span>
            </button>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <aside className="w-80 border-l border-subtle bg-surface-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-subtle bg-surface-2 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-action bg-action/10 px-1.5 py-0.5 rounded">
              {block.blockType}
            </span>
            {block.hidden && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-warning bg-warning-muted px-1.5 py-0.5 rounded flex items-center gap-1">
                <EyeOff size={10} /> Hidden
              </span>
            )}
          </div>
          <h3 className="font-bold text-sm text-white mt-1">
            {def?.label || block.blockType}
          </h3>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMoveBlock(block.id, -1)}
            disabled={!canMoveUp}
            title="Move Up"
            className="p-1.5 rounded text-fg-secondary hover:text-white hover:bg-surface-2 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            onClick={() => onMoveBlock(block.id, 1)}
            disabled={!canMoveDown}
            title="Move Down"
            className="p-1.5 rounded text-fg-secondary hover:text-white hover:bg-surface-2 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            onClick={handleToggleHidden}
            title={block.hidden ? "Unhide Block" : "Hide Block"}
            className="p-1.5 rounded text-fg-secondary hover:text-white hover:bg-surface-2 cursor-pointer"
          >
            {block.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            type="button"
            onClick={() => onDuplicateBlock(block.id)}
            title="Duplicate Block"
            className="p-1.5 rounded text-fg-secondary hover:text-white hover:bg-surface-2 cursor-pointer"
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={() => onDeleteBlock(block.id)}
            title="Delete Block"
            className="p-1.5 rounded text-fg-secondary hover:text-danger hover:bg-danger-muted cursor-pointer"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Body: Form fields */}
      <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-4">
        {/* Variant Picker */}
        {def?.variants && def.variants.length > 1 && (
          <div className="flex flex-col gap-1 pb-3 border-b border-subtle">
            <label className="text-[10px] font-bold uppercase tracking-wider text-fg-secondary">
              Style Variant
            </label>
            <select
              value={block.variant || def.defaultVariant}
              onChange={(e) => handleVariantChange(e.target.value)}
              className="w-full bg-field border border-subtle rounded-lg px-3 py-2 text-xs text-action font-semibold focus:outline-none focus:border-action"
            >
              {def.variants.map((v) => (
                <option key={v.key} value={v.key} className="bg-surface-2 text-white">
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Dynamic Fields */}
        {def ? (
          def.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-fg-secondary flex items-center justify-between">
                <span>{field.label}</span>
                {field.required && (
                  <span className="text-danger text-[9px] font-normal lowercase">
                    required
                  </span>
                )}
              </label>
              {field.description && (
                <p className="text-[10px] text-fg-muted leading-tight">
                  {field.description}
                </p>
              )}
              {renderFieldInput(field, data[field.key], (val) =>
                handleFieldChange(field.key, val)
              )}
            </div>
          ))
        ) : (
          <div className="p-3 bg-danger-muted text-danger text-xs rounded-lg">
            Block definition not found in registry.
          </div>
        )}
      </div>
    </aside>
  );
}
