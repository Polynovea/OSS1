"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { CanonicalSchema } from "@/lib/schema/fields/types";
import {
  isExperienceDocument,
  emptyExperienceDocument,
  createDefaultBlock,
} from "@/lib/experience/blockRegistry";
import type { ExperienceDocument } from "@/lib/experience/types";
import StudioShell, { type ConflictState } from "@/components/admin/experience/StudioShell";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import {
  isModelVisualEligible,
  getComponentFieldKey,
} from "@/lib/experience/eligibility";
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Lock,
} from "lucide-react";

type Entry = {
  id: string;
  content_model_id: string;
  status: string;
  current_draft_version_id: string | null;
};

type Version = {
  id: string;
  version_number: number;
  data_jsonb: Record<string, unknown>;
  state: string;
  change_summary: string | null;
};

export default function EntryExperienceStudioPage() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const backHref = pathname?.startsWith("/admin/blog") ? `/admin/blog/${id}` : `/admin/entries/${id}`;

  const [entry, setEntry] = useState<Entry | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [schema, setSchema] = useState<CanonicalSchema | null>(null);
  const [modelName, setModelName] = useState("");
  const [modelApiKey, setModelApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [conflictState, setConflictState] = useState<ConflictState | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      const entryRes = await fetch(`/api/entries/${id}`, { headers });
      const entryJson = await entryRes.json();
      if (!entryRes.ok) throw new Error(entryJson.error || "Failed to load entry");

      const item = entryJson.data.entry as Entry;
      const [modelRes, versionRes] = await Promise.all([
        fetch(`/api/models/${item.content_model_id}`, { headers }),
        fetch(`/api/models/${item.content_model_id}/versions`, { headers }),
      ]);
      const [modelJson, modelVersions] = await Promise.all([
        modelRes.json(),
        versionRes.json(),
      ]);

      if (!modelRes.ok || !versionRes.ok) {
        throw new Error(modelJson.error || modelVersions.error);
      }

      setEntry(item);
      setVersions(entryJson.data.versions || []);
      setSchema(modelVersions.data?.[0]?.schema_json || null);
      setModelName(modelJson.data.name);
      setModelApiKey(modelJson.data.api_key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load entry");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-canvas flex flex-col items-center justify-center text-fg-muted gap-3">
        <Loader2 className="animate-spin text-action" size={28} />
        <span className="text-xs uppercase tracking-widest font-semibold">
          Loading Visual Studio…
        </span>
      </div>
    );
  }

  if (error || !entry || !schema) {
    return (
      <div className="fixed inset-0 bg-canvas flex items-center justify-center p-6 text-fg-primary">
        <div className="max-w-md w-full rounded-2xl border border-danger bg-danger-muted p-6 text-center">
          <AlertTriangle className="mx-auto text-danger mb-3" size={32} />
          <h2 className="text-lg font-bold text-fg-primary mb-2">
            Could not open Visual Studio
          </h2>
          <p className="text-xs text-danger mb-6">{error || "Entry not found"}</p>
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-2 text-xs font-bold text-fg-primary hover:bg-surface-2 transition-colors"
          >
            <ArrowLeft size={14} /> Back to Entry
          </Link>
        </div>
      </div>
    );
  }

  // Strict Canonical Visual Studio Eligibility Gate
  const isEligible = isModelVisualEligible(schema);
  const componentFieldKey = getComponentFieldKey(schema);

  if (!isEligible || !componentFieldKey) {
    return (
      <div className="fixed inset-0 bg-canvas flex items-center justify-center p-6 text-fg-primary">
        <div className="max-w-lg w-full rounded-2xl border border-subtle bg-surface-1 p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-warning-muted border border-warning text-warning flex items-center justify-center mx-auto mb-4">
            <Lock size={24} />
          </div>
          <h2 className="text-xl font-bold text-fg-primary mb-2">
            Visual Experience Studio Ineligible
          </h2>
          <p className="text-xs text-fg-secondary mb-6 leading-relaxed">
            Content model <span className="font-bold text-fg-primary">{modelName}</span> does not declare an explicit <span className="font-mono text-action">component</span> field in its canonical schema. Visual Experience Studio is only available for models with governed component composition fields.
          </p>
          <Link
            href={modelApiKey === "blog_post" ? `/admin/blog/${id}` : `/admin/entries/${id}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl ui-btn ui-btn-primary font-bold text-xs uppercase tracking-wider hover:bg-action-hover transition-colors"
          >
            <ArrowLeft size={14} /> {modelApiKey === "blog_post" ? "Return to Blog" : "Return to Data Studio"}
          </Link>
        </div>
      </div>
    );
  }

  const draft =
    versions.find((v) => v.id === entry.current_draft_version_id) ||
    versions[0] || {
      id: "new",
      version_number: 1,
      data_jsonb: {},
      state: "draft",
      change_summary: null,
    };

  // Resolve experience document from the canonical component field
  const data = draft.data_jsonb || {};
  const rawExperience = data[componentFieldKey];
  let initialExperienceDoc: ExperienceDocument = emptyExperienceDocument();

  if (isExperienceDocument(rawExperience)) {
    initialExperienceDoc = rawExperience;
  } else {
    // If empty or new, provide starter landing page composition
    initialExperienceDoc = {
      version: 1,
      blocks: [
        createDefaultBlock("hero", "standard"),
        createDefaultBlock("features", "3_col"),
        createDefaultBlock("cta", "gold"),
      ],
    };
  }

  const handleSave = async (
    doc: ExperienceDocument,
    changeSummary: string,
    overrideExpectedVersion?: number
  ): Promise<boolean> => {
    try {
      const authHeaders = await getAuthHeaders();
      let baseData = data;

      // If resolving a conflict with an explicit expected version, use the latest server data base
      if (overrideExpectedVersion !== undefined && overrideExpectedVersion > draft.version_number) {
        if (conflictState?.latestServerData) {
          baseData = conflictState.latestServerData;
        } else {
          try {
            const freshRes = await fetch(`/api/entries/${id}`, { headers: authHeaders });
            const freshJson = await freshRes.json();
            if (freshRes.ok && freshJson.data?.versions?.[0]?.data_jsonb) {
              baseData = freshJson.data.versions[0].data_jsonb;
            }
          } catch {}
        }
      }

      // Merge local ExperienceDocument into baseData preserving all latest server fields
      const payloadData: Record<string, unknown> = {
        ...baseData,
        [componentFieldKey]: doc,
      };

      const targetExpectedVersion =
        overrideExpectedVersion ?? draft.version_number;

      const res = await fetch(`/api/entries/${id}`, {
        method: "PUT",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          data: payloadData,
          changeSummary,
          expectedVersionNumber: targetExpectedVersion,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          // Non-destructive conflict handling: capture latest server fields so non-experience changes survive
          let latestServerVersion = body.data?.currentVersion || body.currentVersion;
          let latestServerData: Record<string, unknown> = latestServerVersion?.data_jsonb || {};
          let serverVersionNumber: number = latestServerVersion?.version_number || targetExpectedVersion + 1;

          if (!latestServerVersion) {
            try {
              const freshRes = await fetch(`/api/entries/${id}`, { headers: authHeaders });
              const freshJson = await freshRes.json();
              if (freshRes.ok && freshJson.data?.versions?.[0]) {
                latestServerVersion = freshJson.data.versions[0];
                latestServerData = latestServerVersion.data_jsonb || {};
                serverVersionNumber = latestServerVersion.version_number;
              }
            } catch {}
          }

          const serverDoc = latestServerData[componentFieldKey];

          setConflictState({
            serverVersionNumber,
            serverDoc: isExperienceDocument(serverDoc) ? serverDoc : undefined,
            latestServerData,
            message: body.error || "Concurrent edit conflict detected",
          });
          return false;
        }
        throw new Error(body.error || "Could not save draft version");
      }

      setConflictState(null);
      await load();
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
      return false;
    }
  };

  return (
    <StudioShell
      entryId={entry.id}
      modelName={modelName}
      modelApiKey={modelApiKey}
      status={entry.status}
      currentVersionNumber={draft.version_number}
      initialDocument={initialExperienceDoc}
      onSave={handleSave}
      backHref={backHref}
      publishable={schema.capability === "publishable"}
      conflictState={conflictState}
      onClearConflict={() => setConflictState(null)}
    />
  );
}
