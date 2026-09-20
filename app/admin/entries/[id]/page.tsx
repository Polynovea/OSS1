"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import EntryForm from "@/components/admin/EntryForm";
import CollaborationPanel from "@/components/admin/CollaborationPanel";
import {
  AlertTriangle,
  ArrowLeft,
  Clock3,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import {
  resolveModelCapability,
  type CanonicalSchema,
} from "@/lib/schema/fields/types";
import { isModelVisualEligible } from "@/lib/experience/eligibility";
import { getAuthHeaders } from "@/lib/admin/authCheck";

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

export default function EntryEditorPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [entry, setEntry] = useState<Entry>({
    id: "",
    content_model_id: "",
    status: "draft",
    current_draft_version_id: null,
  });
  const [versions, setVersions] = useState<Version[]>([]);
  const [schema, setSchema] = useState<CanonicalSchema | null>(null);
  const [modelName, setModelName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const entryRes = await fetch(`/api/entries/${id}`, { headers });
      const entryJson = await entryRes.json();
      if (!entryRes.ok) throw new Error(entryJson.error);
      const item = entryJson.data.entry as Entry;
      const [modelRes, versionRes] = await Promise.all([
        fetch(`/api/models/${item.content_model_id}`, { headers }),
        fetch(`/api/models/${item.content_model_id}/versions`, { headers }),
      ]);
      const [modelJson, modelVersions] = await Promise.all([
        modelRes.json(),
        versionRes.json(),
      ]);
      if (!modelRes.ok || !versionRes.ok)
        throw new Error(modelJson.error || modelVersions.error);
      setEntry(item);
      setVersions(entryJson.data.versions || []);
      setSchema(modelVersions.data?.[0]?.schema_json || null);
      setModelName(modelJson.data.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load entry");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const draft =
    versions.find(
      (version) => version.id === entry?.current_draft_version_id
    ) || versions[0];

  const save = async (
    data: Record<string, unknown>,
    changeSummary: string
  ) => {
    setConflict(false);
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/entries/${id}`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        data,
        changeSummary,
        expectedVersionNumber: draft?.version_number,
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        setConflict(true);
        await load();
        return;
      }
      setError(body.error || "Could not save draft");
      return;
    }
    await load();
  };

  const perform = async (path: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(path, {
        method: "POST",
        headers: body
          ? { ...headers, "content-type": "application/json" }
          : headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Action failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const capability = schema
    ? resolveModelCapability(schema)
    : "content_enabled";

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl">
        <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-subtle pb-5">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/entries"
              className="rounded-lg border border-subtle p-2 text-fg-muted hover:text-fg-primary transition-colors"
            >
              <ArrowLeft size={17} />
            </Link>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-action">
                Content library / {modelName}
              </p>
              <h1 className="mt-1 text-3xl font-extrabold text-fg-primary">
                ENTRY {id.slice(0, 8).toUpperCase()}
              </h1>
            </div>
          </div>
          {entry && (
            <div className="flex items-center gap-3">
              <span
                className={
                  entry.status === "published"
                    ? "text-xs font-bold uppercase tracking-wider text-success"
                    : "text-xs font-bold uppercase tracking-wider text-warning"
                }
              >
                {entry.status}
              </span>
              {isModelVisualEligible(schema) && (
                <Link
                  href={`/admin/entries/${id}/experience`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-action/30 ui-btn ui-btn-primary transition-colors no-underline"
                >
                  <Sparkles size={13} /> Visual Studio
                </Link>
              )}
              {capability === "publishable" && (
                <button
                  disabled={busy}
                  onClick={() => void perform(`/api/entries/${id}/publish`)}
                  className="inline-flex items-center gap-2 rounded-lg bg-success-muted text-success hover:bg-success-muted transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Send size={14} /> Publish draft
                </button>
              )}
            </div>
          )}
        </header>

        {error && (
          <div className="mb-5 rounded-xl border border-danger bg-danger-muted p-4 text-sm text-danger">
            {error}
          </div>
        )}

        {conflict && (
          <div className="mb-5 flex items-center gap-2 rounded-xl border border-warning bg-warning-muted p-4 text-sm text-amber-200">
            <AlertTriangle size={16} /> Someone else saved a newer version
            while you were editing — the form below now shows the latest
            version. Re-apply your changes and save again.
          </div>
        )}

        {schema && draft ? (
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-6">
              <EntryForm
                key={draft.id}
                schema={schema}
                initialData={draft.data_jsonb}
                onSubmit={save}
                submitLabel="Save new draft version"
                storageKey={`entry:${id}`}
              />
              <CollaborationPanel entryId={id} />
            </div>
            <aside className="rounded-2xl border border-subtle bg-surface-1 p-5 h-fit">
              <div className="flex items-center gap-2">
                <Clock3 size={14} className="text-action" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-fg-primary">
                  Version history
                </h2>
              </div>
              <div className="mt-4 space-y-4">
                {versions.map((version) => (
                  <div
                    key={version.id}
                    className="border-l border-default pl-3"
                  >
                    <p className="text-xs font-bold text-fg-secondary">
                      Version {version.version_number}{" "}
                      <span className="ml-1 text-fg-muted">
                        {version.state}
                      </span>
                    </p>
                    <p className="mt-1 text-[10px] text-fg-muted">
                      {version.change_summary || "No summary"}
                    </p>
                    {version.id !== entry.current_draft_version_id && (
                      <button
                        disabled={busy}
                        type="button"
                        onClick={() =>
                          void perform(`/api/entries/${id}/restore`, {
                            versionId: version.id,
                          })
                        }
                        className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-action hover:underline disabled:opacity-50 cursor-pointer"
                      >
                        <RotateCcw size={11} /> Restore as draft
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </aside>
          </div>
        ) : (
          <div className="flex min-h-40 items-center justify-center text-fg-muted">
            <RefreshCw className="animate-spin" />
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
