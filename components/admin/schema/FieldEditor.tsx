"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { FIELD_TYPES, type FieldDefinition, type FieldType } from "@/lib/schema/fields/types";
import { FIELD_TYPE_REGISTRY } from "@/lib/schema/fields/registry";

export const toFieldKey = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^\d+|_+$/g, "");

interface RelationTarget {
  apiKey: string;
  name: string;
}

interface FieldEditorProps {
  field: FieldDefinition;
  index: number;
  total: number;
  onChange: (patch: Partial<FieldDefinition>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  relationTargets: RelationTarget[];
  otherFieldKeys: string[];
}

const inputClass = "w-full rounded-lg border border-default bg-field px-3 py-2 text-sm normal-case tracking-normal text-fg-primary outline-none focus:border-action/50";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-fg-muted";

const NUMBER_DEFAULT_TYPES = new Set<FieldType>(["number", "integer"]);
const NO_VISUAL_DEFAULT_TYPES = new Set<FieldType>(["rich_text", "json", "media", "file", "relation", "component", "repeater"]);

function updateValidation(field: FieldDefinition, patch: Partial<NonNullable<FieldDefinition["validation"]>>) {
  return { ...field.validation, ...patch };
}

function updateHelpText(field: FieldDefinition, value: string): Partial<FieldDefinition> {
  const uiHints = { ...field.uiHints };
  if (value.trim()) uiHints.helpText = value;
  else delete uiHints.helpText;
  return { uiHints };
}

export default function FieldEditor({ field, index, total, onChange, onRemove, onMove, relationTargets, otherFieldKeys }: FieldEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const registryEntry = FIELD_TYPE_REGISTRY[field.type];
  const supports = new Set(registryEntry?.supportedValidation ?? []);
  const isOptionType = field.type === "select" || field.type === "multi_select";

  const defaultValueEditor = (() => {
    if (field.type === "boolean") {
      return (
        <select
          value={field.defaultValue === undefined ? "" : String(field.defaultValue)}
          onChange={(e) => onChange({ defaultValue: e.target.value === "" ? undefined : e.target.value === "true" })}
          className={`mt-1.5 ${inputClass}`}
        >
          <option value="">No default</option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      );
    }

    if (field.type === "multi_select") {
      return (
        <input
          value={Array.isArray(field.defaultValue) ? field.defaultValue.join(", ") : ""}
          onChange={(e) => onChange({ defaultValue: e.target.value.trim() ? e.target.value.split(",").map((value) => value.trim()).filter(Boolean) : undefined })}
          placeholder="No default; or comma-separated values"
          className={`mt-1.5 ${inputClass}`}
        />
      );
    }

    if (NO_VISUAL_DEFAULT_TYPES.has(field.type)) {
      return <p className="mt-1.5 rounded-lg border border-subtle bg-field px-3 py-2 text-xs font-normal normal-case tracking-normal text-fg-muted">Complex structured defaults are omitted or managed in specialized editors; basic scalar fields support defaults here.</p>;
    }

    return (
      <input
        type={NUMBER_DEFAULT_TYPES.has(field.type) ? "number" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text"}
        step={field.type === "number" ? "any" : undefined}
        value={typeof field.defaultValue === "string" || typeof field.defaultValue === "number" ? String(field.defaultValue) : ""}
        onChange={(e) => onChange({
          defaultValue: e.target.value === ""
            ? undefined
            : NUMBER_DEFAULT_TYPES.has(field.type)
              ? Number(e.target.value)
              : e.target.value,
        })}
        placeholder="No default"
        className={`mt-1.5 ${inputClass}`}
      />
    );
  })();

  return (
    <div className="rounded-xl border border-subtle bg-field p-4">
      <div className="grid gap-3 md:grid-cols-[28px_1fr_1fr_170px_auto]">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex h-9 items-center justify-center rounded-md bg-surface-2 text-fg-muted hover:text-action" aria-label="Toggle field details">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <input
          required
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value, key: field.key ? field.key : toFieldKey(e.target.value) })}
          placeholder="Field label"
          className={inputClass}
        />
        <input
          required
          pattern="[a-z][a-z0-9_]*"
          value={field.key}
          onChange={(e) => onChange({ key: toFieldKey(e.target.value) })}
          placeholder="field_key"
          className={`${inputClass} font-mono text-action`}
        />
        <select
          value={field.type}
          onChange={(e) => {
            const type = e.target.value as FieldType;
            onChange({
              type,
              defaultValue: type === field.type ? field.defaultValue : undefined,
              relation: type === "relation" ? field.relation : undefined,
              generatedFrom: type === "slug" ? field.generatedFrom : undefined,
            });
          }}
          className={inputClass}
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>{type.replaceAll("_", " ")}</option>
          ))}
        </select>
        <div className="flex items-center">
          <button type="button" aria-label="Move field up" disabled={index === 0} onClick={() => onMove(-1)} className="rounded-l-lg p-2 text-fg-muted hover:text-action disabled:opacity-20"><ArrowUp size={14} /></button>
          <button type="button" aria-label="Move field down" disabled={index === total - 1} onClick={() => onMove(1)} className="p-2 text-fg-muted hover:text-action disabled:opacity-20"><ArrowDown size={14} /></button>
          <button type="button" aria-label="Remove field" onClick={onRemove} className="rounded-r-lg p-2 text-fg-muted hover:bg-danger-muted hover:text-danger"><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 md:pl-[40px]">
        {(["required", "localized", "unique"] as const).map((flag) => (
          <label key={flag} className="flex items-center gap-2 text-xs font-medium capitalize text-fg-muted">
            <input type="checkbox" checked={field[flag]} onChange={(e) => onChange({ [flag]: e.target.checked })} className="accent-[#E6D3A3]" />
            {flag}
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs font-medium text-fg-muted" title="Requests a basic index for filter/sort performance. Unique fields already get one.">
          <input type="checkbox" checked={Boolean(field.index)} disabled={field.unique} onChange={(e) => onChange({ index: e.target.checked })} className="accent-[#E6D3A3]" />
          Indexed
        </label>
        {field.providerSpecific && (
          <span className="flex items-center gap-1 rounded-full border border-warning bg-warning-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
            <AlertTriangle size={11} /> Provider-specific
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-4 grid gap-3 border-t border-subtle pt-4 md:grid-cols-2 md:pl-[40px]">
          <label className={labelClass}>
            Default value
            {defaultValueEditor}
          </label>

          <label className={`${labelClass} md:col-span-2`}>
            Help text for editors
            <input value={typeof field.uiHints?.helpText === "string" ? field.uiHints.helpText : ""} onChange={(e) => onChange(updateHelpText(field, e.target.value))} placeholder="Explain what belongs in this field" className={`mt-1.5 ${inputClass}`} />
          </label>

          {supports.has("minLength") && (
            <label className={labelClass}>
              Min length
              <input type="number" min={0} value={field.validation?.minLength ?? ""} onChange={(e) => onChange({ validation: updateValidation(field, { minLength: e.target.value === "" ? undefined : Number(e.target.value) }) })} className={`mt-1.5 ${inputClass}`} />
            </label>
          )}
          {supports.has("maxLength") && (
            <label className={labelClass}>
              Max length
              <input type="number" min={0} value={field.validation?.maxLength ?? ""} onChange={(e) => onChange({ validation: updateValidation(field, { maxLength: e.target.value === "" ? undefined : Number(e.target.value) }) })} className={`mt-1.5 ${inputClass}`} />
            </label>
          )}
          {supports.has("min") && (
            <label className={labelClass}>
              Min value
              <input type="number" value={field.validation?.min ?? ""} onChange={(e) => onChange({ validation: updateValidation(field, { min: e.target.value === "" ? undefined : Number(e.target.value) }) })} className={`mt-1.5 ${inputClass}`} />
            </label>
          )}
          {supports.has("max") && (
            <label className={labelClass}>
              Max value
              <input type="number" value={field.validation?.max ?? ""} onChange={(e) => onChange({ validation: updateValidation(field, { max: e.target.value === "" ? undefined : Number(e.target.value) }) })} className={`mt-1.5 ${inputClass}`} />
            </label>
          )}
          {supports.has("pattern") && (
            <label className={`${labelClass} md:col-span-2`}>
              Pattern (regex)
              <input value={field.validation?.pattern ?? ""} onChange={(e) => onChange({ validation: updateValidation(field, { pattern: e.target.value || undefined }) })} className={`mt-1.5 ${inputClass} font-mono`} />
            </label>
          )}
          {isOptionType && (
            <label className={`${labelClass} md:col-span-2`}>
              Options (comma-separated)
              <input
                value={(field.validation?.options ?? []).join(", ")}
                onChange={(e) => onChange({ validation: updateValidation(field, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) }) })}
                placeholder="draft, active, archived"
                className={`mt-1.5 ${inputClass}`}
              />
            </label>
          )}

          {field.type === "slug" && (
            <label className={labelClass}>
              Generated from field
              <select value={field.generatedFrom ?? ""} onChange={(e) => onChange({ generatedFrom: e.target.value || undefined })} className={`mt-1.5 ${inputClass}`}>
                <option value="">None</option>
                {otherFieldKeys.map((key) => <option key={key} value={key}>{key}</option>)}
              </select>
            </label>
          )}

          {field.type === "relation" && (
            <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
              <label className={labelClass}>
                Target model
                <select
                  value={field.relation?.targetModelApiKey ?? ""}
                  onChange={(e) => onChange({ relation: { targetModelApiKey: e.target.value, cardinality: field.relation?.cardinality ?? "many_to_one", onDelete: field.relation?.onDelete ?? "block" } })}
                  className={`mt-1.5 ${inputClass}`}
                >
                  <option value="">Select a model…</option>
                  {relationTargets.map((target) => <option key={target.apiKey} value={target.apiKey}>{target.name} ({target.apiKey})</option>)}
                </select>
              </label>
              <label className={labelClass}>
                Cardinality
                <select
                  value={field.relation?.cardinality ?? "many_to_one"}
                  onChange={(e) => onChange({ relation: { targetModelApiKey: field.relation?.targetModelApiKey ?? "", cardinality: e.target.value as NonNullable<FieldDefinition["relation"]>["cardinality"], onDelete: field.relation?.onDelete ?? "block" } })}
                  className={`mt-1.5 ${inputClass}`}
                >
                  <option value="one_to_one">One to one</option>
                  <option value="one_to_many">One to many</option>
                  <option value="many_to_one">Many to one</option>
                  <option value="many_to_many">Many to many</option>
                </select>
              </label>
              <label className={labelClass}>
                On target deletion
                <select
                  value={field.relation?.onDelete ?? "block"}
                  onChange={(e) => onChange({ relation: { targetModelApiKey: field.relation?.targetModelApiKey ?? "", cardinality: field.relation?.cardinality ?? "many_to_one", onDelete: e.target.value as NonNullable<FieldDefinition["relation"]>["onDelete"] } })}
                  className={`mt-1.5 ${inputClass}`}
                >
                  <option value="block">Block deletion</option>
                  <option value="remove_reference">Remove reference</option>
                  <option value="archive_dependents">Archive dependents</option>
                </select>
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs font-medium text-fg-muted md:col-span-2">
            <input type="checkbox" checked={Boolean(field.providerSpecific)} onChange={(e) => onChange({ providerSpecific: e.target.checked })} className="accent-[#E6D3A3]" />
            Provider-specific (depends on a non-portable database feature)
          </label>
        </div>
      )}
    </div>
  );
}
