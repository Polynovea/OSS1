"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, Layout, FormInput, Sparkles } from "lucide-react";
import {
  defaultEntryData,
  resolveModelCapability,
  type CanonicalSchema,
  type FieldDefinition,
} from "@/lib/schema/fields/types";
import RichTextEditor from "@/components/admin/RichTextEditor";
import { emptyRichText, isRichTextDocument } from "@/lib/content/richText";
import AssetPicker from "@/components/admin/AssetPicker";
import RelationPicker from "@/components/admin/RelationPicker";
import WorkflowPanel from "@/components/admin/WorkflowPanel";
import PreviewButton from "@/components/admin/PreviewButton";
import PreflightPanel from "@/components/admin/PreflightPanel";
import ImpactPanel from "@/components/admin/ImpactPanel";
import LocalizationPanel from "@/components/admin/LocalizationPanel";
import ExperienceComposer from "@/components/admin/experience/ExperienceComposer";
import {
  emptyExperienceDocument,
  isExperienceDocument,
} from "@/lib/experience/blockRegistry";
import type { ExperienceDocument } from "@/lib/experience/types";

const AUTOSAVE_DEBOUNCE_MS = 800;

interface EntryFormProps {
  schema: CanonicalSchema;
  initialData?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>, summary: string) => Promise<void>;
  submitLabel: string;
  /** Unique per record (e.g. `entry:${entryId}` or `entry:new:${schema.apiKey}`) — scopes the unsaved-draft recovery slot. */
  storageKey: string;
}

function draftStorageKey(storageKey: string) {
  return `polynovea:draft:${storageKey}`;
}

export default function EntryForm({
  schema,
  initialData = {},
  onSubmit,
  submitLabel,
  storageKey,
}: EntryFormProps) {
  const [data, setData] = useState<Record<string, unknown>>(() => ({
    ...defaultEntryData(schema),
    ...initialData,
  }));
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"form" | "experience">("form");
  const [recoverable, setRecoverable] = useState<Record<string, unknown> | null>(
    null
  );
  const dirtyRef = useRef(false);
  const pathname = usePathname();
  const entryMatch = pathname.match(/^\/admin\/entries\/([^/]+)$/);
  const capability = resolveModelCapability(schema);
  const showWorkflow = capability === "publishable";

  // Check if model has an experience/blocks field or if it is content-enabled/publishable
  const experienceFieldKey =
    schema.fields.find(
      (f) =>
        f.type === "component" ||
        ["experience", "blocks", "sections", "content_blocks"].includes(f.key)
    )?.key || "experience";

  const rawExperience = data[experienceFieldKey];
  const experienceDoc: ExperienceDocument = isExperienceDocument(rawExperience)
    ? rawExperience
    : emptyExperienceDocument();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftStorageKey(storageKey));
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const base = { ...defaultEntryData(schema), ...initialData };
        if (JSON.stringify(parsed) !== JSON.stringify(base))
          setRecoverable(parsed);
      }
    } catch {
      /* localStorage unavailable or corrupt draft — ignore */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timeout = setTimeout(() => {
      try {
        window.localStorage.setItem(
          draftStorageKey(storageKey),
          JSON.stringify(data)
        );
      } catch {
        /* storage unavailable — autosave is best-effort */
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [data, storageKey]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const update = (key: string, value: unknown) => {
    dirtyRef.current = true;
    setData((current) => ({ ...current, [key]: value }));
  };

  const handleExperienceChange = (doc: ExperienceDocument) => {
    dirtyRef.current = true;
    setData((current) => ({ ...current, [experienceFieldKey]: doc }));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSubmit(data, summary);
      dirtyRef.current = false;
      try {
        window.localStorage.removeItem(draftStorageKey(storageKey));
      } catch {
        /* best-effort cleanup */
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
      {recoverable && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning bg-warning-muted px-4 py-3 text-xs text-amber-200">
          <span className="flex items-center gap-2">
            <AlertTriangle size={14} /> An unsaved draft from a previous session
            was found for this record.
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setData(recoverable);
                dirtyRef.current = true;
                setRecoverable(null);
              }}
              className="rounded-md bg-warning-muted text-warning cursor-pointer"
            >
              Restore it
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  window.localStorage.removeItem(draftStorageKey(storageKey));
                } catch {
                  /* best-effort */
                }
                setRecoverable(null);
              }}
              className="rounded-md border border-warning px-2.5 py-1 font-bold uppercase tracking-wider text-warning cursor-pointer"
            >
              Discard
            </button>
          </span>
        </div>
      )}

      {/* ── Studio Navigation Tabs ────────────────────────────────────────── */}
      {capability !== "data_only" && (
        <div className="flex items-center justify-between border-b border-subtle pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("form")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                activeTab === "form"
                  ? "ui-btn ui-btn-primary shadow-md"
                  : "text-fg-secondary hover:text-white hover:bg-surface-2"
              }`}
            >
              <FormInput size={14} />
              <span>Structured Form</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("experience")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                activeTab === "experience"
                  ? "ui-btn ui-btn-primary shadow-md"
                  : "text-fg-secondary hover:text-white hover:bg-surface-2"
              }`}
            >
              <Sparkles size={14} />
              <span>Visual Experience Studio</span>
              {experienceDoc.blocks.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-field text-current">
                  {experienceDoc.blocks.length}
                </span>
              )}
            </button>
          </div>

          <span className="text-[10px] font-mono text-fg-muted uppercase tracking-widest hidden sm:inline">
            Capability: {capability.replace("_", " ")}
          </span>
        </div>
      )}

      {/* ── Operation Panels ────────────────────────────────────────────── */}
      {entryMatch && showWorkflow && (
        <>
          <WorkflowPanel
            entryId={entryMatch[1]}
            onChanged={() => window.location.reload()}
          />
          <PreflightPanel entryId={entryMatch[1]} />
          <PreviewButton entryId={entryMatch[1]} />
        </>
      )}
      {entryMatch && <ImpactPanel entryId={entryMatch[1]} />}
      {entryMatch && capability !== "data_only" && (
        <LocalizationPanel entryId={entryMatch[1]} />
      )}

      {/* ── Tab Content: Visual Experience Studio ─────────────────────────── */}
      {activeTab === "experience" && capability !== "data_only" ? (
        <div className="space-y-4">
          <ExperienceComposer
            value={experienceDoc}
            onChange={handleExperienceChange}
          />
        </div>
      ) : (
        /* ── Tab Content: Standard Form View ─────────────────────────────── */
        <div className="space-y-5">
          {schema.fields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={data[field.key]}
              onChange={(value) => update(field.key, value)}
            />
          ))}
        </div>
      )}

      {/* ── Revision & Save Footer ────────────────────────────────────────── */}
      <div className="pt-4 border-t border-subtle space-y-4">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-fg-muted">
          Change summary
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            placeholder="Describe this revision (e.g., 'Added Hero block and updated pricing CTA')"
            className="mt-2 w-full resize-none rounded-lg border border-default bg-field px-3 py-2.5 text-sm normal-case tracking-normal text-fg-primary outline-none focus:border-action/50"
          />
        </label>
        <button
          disabled={saving}
          className="rounded-lg ui-btn ui-btn-primary hover:bg-action-hover transition-colors disabled:opacity-50 cursor-pointer"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const textArea = [
    "long_text",
    "markdown",
    "json",
    "component",
    "repeater",
  ].includes(field.type);
  const inputType =
    field.type === "number" || field.type === "integer"
      ? "number"
      : field.type === "date"
      ? "date"
      : field.type === "datetime"
      ? "datetime-local"
      : field.type === "email"
      ? "email"
      : field.type === "url"
      ? "url"
      : "text";
  const label = (
    <>
      <span className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">
        {field.label}
        {field.required && <span className="ml-1 text-action">*</span>}
        <span className="ml-2 font-mono normal-case text-fg-muted">
          {field.type}
        </span>
      </span>
      {typeof field.uiHints?.helpText === "string" &&
        field.uiHints.helpText.trim() && (
          <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-fg-muted">
            {field.uiHints.helpText}
          </span>
        )}
    </>
  );

  if (field.type === "boolean")
    return (
      <label className="flex items-center gap-3 rounded-xl border border-subtle bg-field p-4 cursor-pointer">
        {label}
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="ml-auto accent-[#E6D3A3]"
        />
      </label>
    );
  if (field.type === "media" || field.type === "file")
    return (
      <label className="block">
        {label}
        <div className="mt-2">
          <AssetPicker value={value} onChange={onChange} />
        </div>
      </label>
    );
  if (field.type === "rich_text")
    return (
      <label className="block">
        {label}
        <div className="mt-2">
          <RichTextEditor
            value={isRichTextDocument(value) ? value : emptyRichText()}
            onChange={onChange}
          />
        </div>
      </label>
    );
  if (field.type === "relation")
    return (
      <label className="block">
        {label}
        <RelationPicker field={field} value={value} onChange={onChange} />
      </label>
    );
  if (field.type === "select" || field.type === "multi_select")
    return (
      <label className="block">
        {label}
        <select
          required={field.required}
          multiple={field.type === "multi_select"}
          value={
            Array.isArray(value)
              ? value.map(String)
              : String(value ?? "")
          }
          onChange={(e) =>
            onChange(
              field.type === "multi_select"
                ? Array.from(e.target.selectedOptions).map(
                    (option) => option.value
                  )
                : e.target.value
            )
          }
          className="mt-2 w-full rounded-lg border border-default bg-field px-3 py-2.5 text-sm text-fg-primary outline-none focus:border-action/50"
        >
          <option value="">Select…</option>
          {field.validation?.options?.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  if (textArea)
    return (
      <label className="block">
        {label}
        <textarea
          required={field.required}
          value={
            typeof value === "string"
              ? value
              : value
              ? JSON.stringify(value, null, 2)
              : ""
          }
          onChange={(e) => {
            const next = e.target.value;
            onChange(
              ["json", "component", "repeater"].includes(field.type) && next
                ? safeJson(next)
                : next
            );
          }}
          rows={field.type === "markdown" ? 12 : 4}
          className="mt-2 w-full resize-y rounded-lg border border-default bg-field px-3 py-2.5 font-mono text-sm text-fg-primary outline-none focus:border-action/50"
        />
      </label>
    );
  return (
    <label className="block">
      {label}
      <input
        required={field.required}
        type={inputType}
        value={String(value ?? "")}
        onChange={(e) =>
          onChange(
            inputType === "number" ? Number(e.target.value) : e.target.value
          )
        }
        className="mt-2 w-full rounded-lg border border-default bg-field px-3 py-2.5 text-sm text-fg-primary outline-none focus:border-action/50"
      />
    </label>
  );
}

function safeJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
