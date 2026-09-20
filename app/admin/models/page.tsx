"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import { ArrowUpRight, Boxes, Layers3, Plus, RefreshCw } from "lucide-react";
import type { ModelCapability } from "@/lib/schema/fields/types";

interface ContentModel {
  id: string;
  name: string;
  api_key: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  current_schema_version: number;
  settings_json: { capability?: ModelCapability } | null;
  updated_at: string;
}

const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  data_only: "Data only",
  content_enabled: "Content enabled",
  publishable: "Publishable",
};

function statusBadge(status: ContentModel["status"]) {
  if (status === "active") return "ui-badge ui-badge-success";
  if (status === "archived") return "ui-badge ui-badge-pending";
  return "ui-badge ui-badge-warning";
}

export default function ModelsPage() {
  const [models, setModels] = useState<ContentModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/models");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load content models");
      setModels(body.data || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load content models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        <header className="ui-page-header">
          <div>
            <p className="ui-eyebrow flex items-center gap-1.5"><Layers3 size={12} />Schema Studio</p>
            <h1 className="ui-page-title">Data Models</h1>
            <p className="ui-page-description">Define structured records without SQL. Every applied change creates an immutable schema version, while content and publishing capabilities remain explicit model-level choices.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className="ui-btn ui-btn-secondary"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button>
            <Link href="/admin/models/new" className="ui-btn ui-btn-primary no-underline"><Plus size={14} />New data model</Link>
          </div>
        </header>

        {error ? <div className="ui-alert ui-alert-danger mt-5">{error}</div> : null}

        <section className="ui-section">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div><h2 className="ui-section-title">Schema inventory</h2><p className="ui-section-description">Models are durable contracts. Open one to change fields, inspect version history or promote a schema to an environment.</p></div>
            <span className="text-[12px] text-fg-muted">{models.length} models</span>
          </div>

          {loading ? (
            <div className="flex min-h-52 items-center justify-center text-fg-muted"><RefreshCw className="animate-spin" size={20} /></div>
          ) : models.length === 0 ? (
            <div className="ui-empty rounded-xl bg-surface-1">
              <Boxes size={24} className="mx-auto text-icon-muted" />
              <p className="ui-empty-title mt-3">Your schema starts here</p>
              <p className="ui-empty-copy">Create Customers, Projects, Research Experiments or publishable content, then compose the fields your team needs.</p>
              <Link href="/admin/models/new" className="ui-btn ui-btn-primary mt-4 no-underline"><Plus size={14} />Create first model</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="ui-table min-w-[760px]">
                <thead><tr><th className="pr-5">Model</th><th className="px-5">Capability</th><th className="px-5">Status</th><th className="px-5">Schema</th><th className="px-5">Updated</th><th className="pl-5 text-right">Open</th></tr></thead>
                <tbody>
                  {models.map((model) => {
                    const capability = model.settings_json?.capability ?? "content_enabled";
                    return (
                      <tr key={model.id}>
                        <td className="pr-5">
                          <Link href={`/admin/models/${model.id}`} className="group block no-underline">
                            <div className="flex items-center gap-2"><Boxes size={14} className="text-icon-muted" /><span className="font-semibold text-fg-primary group-hover:text-link">{model.name}</span></div>
                            <code className="mt-1 block text-[11px] text-fg-muted">{model.api_key}</code>
                            {model.description ? <p className="mt-1 max-w-xl truncate text-[12px] text-fg-muted">{model.description}</p> : null}
                          </Link>
                        </td>
                        <td className="px-5"><span className="ui-badge ui-badge-review">{CAPABILITY_LABELS[capability]}</span></td>
                        <td className="px-5"><span className={statusBadge(model.status)}>{model.status}</span></td>
                        <td className="px-5 font-mono text-[12px] text-fg-secondary">v{model.current_schema_version}</td>
                        <td className="px-5 text-[12px] text-fg-muted">{new Date(model.updated_at).toLocaleDateString()}</td>
                        <td className="pl-5 text-right"><Link href={`/admin/models/${model.id}`} aria-label={`Open ${model.name}`} className="inline-flex rounded-lg p-2 text-icon-muted hover:bg-surface-2 hover:text-link"><ArrowUpRight size={14} /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
