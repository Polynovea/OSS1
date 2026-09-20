"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  Check,
  AlertTriangle,
  Loader2,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import ExperienceComposer from "./ExperienceComposer";
import type { ExperienceDocument } from "@/lib/experience/types";
import PreviewButton from "@/components/admin/PreviewButton";

export interface ConflictState {
  serverVersionNumber: number;
  serverDoc?: ExperienceDocument;
  latestServerData?: Record<string, unknown>;
  message: string;
}

interface CrashRecoveryPayload {
  baseVersionNumber: number;
  savedAt: string;
  doc: ExperienceDocument;
}

interface StudioShellProps {
  entryId: string;
  modelName: string;
  modelApiKey: string;
  status: string;
  currentVersionNumber: number;
  initialDocument: ExperienceDocument;
  onSave: (doc: ExperienceDocument, summary: string, overrideExpectedVersion?: number) => Promise<boolean>;
  backHref: string;
  publishable?: boolean;
  conflictState?: ConflictState | null;
  onClearConflict?: () => void;
}

export default function StudioShell({
  entryId,
  modelName,
  modelApiKey,
  status,
  currentVersionNumber,
  initialDocument,
  onSave,
  backHref,
  publishable = false,
  conflictState,
  onClearConflict,
}: StudioShellProps) {
  const [doc, setDoc] = useState<ExperienceDocument>(initialDocument);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [hasCrashDraft, setHasCrashDraft] = useState(false);
  const [crashDoc, setCrashDoc] = useState<ExperienceDocument | null>(null);
  const [crashBaseVersion, setCrashBaseVersion] = useState<number | null>(null);

  const storageKey = `polynovea:crash_recovery:entry:${entryId}`;

  // Check crash recovery buffer on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed: CrashRecoveryPayload = JSON.parse(stored);
        const recoveryDoc = parsed.doc || (parsed as unknown as ExperienceDocument);
        const baseVersion = parsed.baseVersionNumber ?? currentVersionNumber;

        if (recoveryDoc?.blocks?.length && JSON.stringify(recoveryDoc) !== JSON.stringify(initialDocument)) {
          setCrashDoc(recoveryDoc);
          setCrashBaseVersion(baseVersion);
          setHasCrashDraft(true);
        }
      }
    } catch {}
  }, [entryId, storageKey, initialDocument, currentVersionNumber]);

  useEffect(() => {
    setDoc(initialDocument);
    setIsDirty(false);
  }, [initialDocument]);

  const handleDocChange = (nextDoc: ExperienceDocument) => {
    setDoc(nextDoc);
    setIsDirty(true);
    try {
      const payload: CrashRecoveryPayload = {
        baseVersionNumber: currentVersionNumber,
        savedAt: new Date().toISOString(),
        doc: nextDoc,
      };
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {}
  };

  const handleRestoreCrashDraft = () => {
    if (crashDoc) {
      setDoc(crashDoc);
      setIsDirty(true);
      setHasCrashDraft(false);
    }
  };

  const handleDiscardCrashDraft = () => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
    setHasCrashDraft(false);
    setCrashDoc(null);
    setCrashBaseVersion(null);
  };

  const handleSave = async (overrideExpectedVersion?: number) => {
    setSaving(true);
    try {
      const targetVersion = overrideExpectedVersion ?? currentVersionNumber;
      const ok = await onSave(
        doc,
        `Visual studio revision v${targetVersion + 1}`,
        targetVersion
      );
      if (ok) {
        setIsDirty(false);
        setSavedNotice(true);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {}
        if (onClearConflict) onClearConflict();
        setTimeout(() => setSavedNotice(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardServerVersion = () => {
    if (conflictState?.serverDoc) {
      setDoc(conflictState.serverDoc);
      setIsDirty(false);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      if (onClearConflict) onClearConflict();
    }
  };

  // Prevent accidental navigation when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Client-side link protection
  const handleBackClick = (e: React.MouseEvent) => {
    if (isDirty) {
      const confirmed = window.confirm(
        "You have unsaved visual changes in Studio. Are you sure you want to leave without saving?"
      );
      if (!confirmed) {
        e.preventDefault();
      }
    }
  };

  // Keyboard shortcut: Ctrl/Cmd + S to save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && !saving) {
          void handleSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [doc, isDirty, saving, currentVersionNumber]);

  return (
    <div className="fixed inset-0 z-50 bg-canvas flex flex-col text-fg-primary font-sans selection:bg-[#3D3520] selection:text-action overflow-hidden">
      {/* ── Studio Top Header Bar ────────────────────────────────────────── */}
      <header className="h-14 border-b border-subtle bg-surface-1 px-4 flex items-center justify-between gap-4 shrink-0 z-20">
        {/* Left: Back + Identity & Version */}
        <div className="flex items-center gap-3">
          <Link
            href={backHref}
            onClick={handleBackClick}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-subtle bg-surface-2 text-xs font-semibold text-fg-secondary hover:text-white hover:bg-surface-2 transition-colors no-underline"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back to Entry</span>
          </Link>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-fg-muted hidden md:inline">
              Content Library /
            </span>
            <span className="font-bold text-white">{modelName}</span>
            <span className="font-mono text-[10px] text-fg-muted bg-surface-2 px-1.5 py-0.5 rounded">
              {entryId.slice(0, 8)}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-action/10 text-action border border-action/20 px-2 py-0.5 rounded-full">
              v{currentVersionNumber}
            </span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                status === "published"
                  ? "bg-success-muted text-success border border-success"
                  : "bg-warning-muted text-warning border border-warning"
              }`}
            >
              {status}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2.5">
          {isDirty && (
            <span className="text-[11px] font-medium text-warning bg-warning-muted px-2 py-1 rounded-md hidden lg:inline-flex items-center gap-1">
              ● Unsaved changes
            </span>
          )}

          <div className="shrink-0">
            <PreviewButton entryId={entryId} />
          </div>

          <button
            type="button"
            disabled={saving || !isDirty}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-1.5 rounded-lg ui-btn ui-btn-primary hover:bg-action-hover transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed shadow-md"
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : savedNotice ? (
              <Check size={13} />
            ) : (
              <Save size={13} />
            )}
            <span>
              {saving
                ? "Saving…"
                : savedNotice
                ? "Saved Version!"
                : "Save Draft"}
            </span>
          </button>
        </div>
      </header>

      {/* ── Non-Destructive Conflict Alert Banner ──────────────────────────── */}
      {conflictState && (
        <div className="bg-warning-muted border-b border-warning px-4 py-2.5 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-3 shrink-0 z-20">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-warning shrink-0" />
            <span>
              <strong>Concurrency Notice:</strong> Version{" "}
              <strong>v{conflictState.serverVersionNumber}</strong> was saved while you were editing. Your local visual changes are preserved and will merge cleanly with updated server fields.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave(conflictState.serverVersionNumber)}
              className="px-3 py-1 rounded-lg bg-warning-muted text-warning font-bold uppercase tracking-wider text-[10px] hover:bg-warning-muted transition-colors cursor-pointer"
            >
              Save My Version (v{conflictState.serverVersionNumber + 1})
            </button>
            {conflictState.serverDoc && (
              <button
                type="button"
                onClick={handleDiscardServerVersion}
                className="px-2.5 py-1 rounded-lg border border-default bg-surface-2 text-white font-semibold text-[10px] hover:bg-surface-2 transition-colors cursor-pointer"
              >
                Discard & Load Server v{conflictState.serverVersionNumber}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Crash Recovery Banner ─────────────────────────────────────────── */}
      {hasCrashDraft && !conflictState && (
        <div className="bg-info-muted border-b border-info px-4 py-2 text-xs text-blue-200 flex items-center justify-between gap-3 shrink-0 z-20">
          <div className="flex items-center gap-2">
            <RotateCcw size={14} className="text-info shrink-0" />
            <span>
              Unsaved draft recovered from a previous session{crashBaseVersion ? ` (base v${crashBaseVersion})` : ""}.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRestoreCrashDraft}
              className="px-2.5 py-1 rounded bg-info-muted text-info font-bold text-[10px] uppercase tracking-wider hover:bg-info-muted transition-colors cursor-pointer"
            >
              Restore Draft
            </button>
            <button
              type="button"
              onClick={handleDiscardCrashDraft}
              className="px-2 py-1 rounded border border-subtle text-fg-secondary hover:text-white text-[10px] cursor-pointer"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* ── Studio Canvas Workspace ─────────────────────────────────────── */}
      <main className="flex-1 w-full overflow-hidden flex flex-col">
        <ExperienceComposer
          value={doc}
          onChange={handleDocChange}
        />
      </main>
    </div>
  );
}
