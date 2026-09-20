"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminLayout from "@/components/admin/AdminLayout";
import {
  Sparkles,
  Plus,
  ArrowRight,
  RefreshCw,
  LayoutTemplate,
  Monitor,
  Layers,
  Eye,
  Lock,
} from "lucide-react";
import type { ContentModelRow } from "@/lib/schema/modelService";
import { LANDING_PAGE_MODEL_SCHEMA, getDefaultStarterExperience } from "@/lib/experience/constants";
import { isModelVisualEligible, getComponentFieldKey } from "@/lib/experience/eligibility";
import { getAuthHeaders } from "@/lib/admin/authCheck";

type VisualEntryItem = {
  id: string;
  title: string;
  slug: string;
  status: string;
  modelName: string;
  modelApiKey: string;
  updatedAt: string;
  versionNumber: number;
  blockCount: number;
};

export default function ExperienceStudioHubPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<VisualEntryItem[]>([]);
  const [visualModels, setVisualModels] = useState<ContentModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      const [modelsRes, entriesRes] = await Promise.all([
        fetch("/api/models", { headers }),
        fetch("/api/entries", { headers }),
      ]);

      const [modelsJson, entriesJson] = await Promise.all([
        modelsRes.json(),
        entriesRes.json(),
      ]);

      const allModels: ContentModelRow[] = modelsJson.data || [];
      const allEntries: any[] = entriesJson.data || [];

      // Canonical Filter: all active models whose CURRENT CANONICAL SCHEMA satisfies isModelVisualEligible
      const allowedModels = allModels.filter(
        (m) => m.status === "active" && isModelVisualEligible(m.current_schema)
      );
      setVisualModels(allowedModels);

      const allowedModelIds = new Set(allowedModels.map((m) => m.id));
      const modelMap = new Map(allModels.map((m) => [m.id, m]));

      // Filter entries: only include entries belonging to allowed visual models
      const visualEntries = allEntries.filter((e) => allowedModelIds.has(e.content_model_id));

      const visualItems: VisualEntryItem[] = visualEntries.map((e) => {
        const m = modelMap.get(e.content_model_id);
        const compKey = getComponentFieldKey(m?.current_schema) || "experience";
        const data = e.data_jsonb || {};
        const title =
          (data.title as string) ||
          (data.name as string) ||
          `Page ${e.id.slice(0, 8)}`;
        const slug = (data.slug as string) || "";
        const rawExperience = data[compKey] || data.experience || data.blocks;
        const blocks = rawExperience?.blocks || [];

        return {
          id: e.id,
          title,
          slug,
          status: e.status,
          modelName: m?.name || "Model",
          modelApiKey: m?.api_key || "model",
          updatedAt: e.updated_at,
          versionNumber: e.version_number || 1,
          blockCount: Array.isArray(blocks) ? blocks.length : 0,
        };
      });

      setEntries(visualItems);
    } catch (err) {
      console.error("Could not load experience hub data", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateNewPage = async () => {
    setCreating(true);
    try {
      const headers = await getAuthHeaders();

      // 1. Look for the canonical Landing Page model among visual-eligible models
      let landingModel = visualModels.find((m) => m.api_key === "landing_page");

      // 2. If no canonical landing page model exists yet, auto-provision it using the canonical template
      if (!landingModel) {
        const modelRes = await fetch("/api/models", {
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            description: "Publishable modular pages composed with developer-approved blocks in Visual Experience Studio.",
            icon: "Sparkles",
            schema: LANDING_PAGE_MODEL_SCHEMA,
          }),
        });
        const modelJson = await modelRes.json();
        if (!modelRes.ok) {
          throw new Error(modelJson.error || "Could not provision Landing Page model");
        }
        landingModel = modelJson.data.model;
      }

      if (!landingModel) {
        throw new Error("Landing Page model is unavailable");
      }

      // 3. Create the new entry with starter experience blocks
      const timestamp = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const entryRes = await fetch("/api/entries", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          modelId: landingModel.id,
          data: {
            title: `New Experience Page (${timestamp})`,
            slug: `page-${Date.now().toString().slice(-6)}`,
            seo_description: "Governed digital experience page composed in Visual Studio.",
            experience: getDefaultStarterExperience(),
          },
          changeSummary: "Initial draft composed in Visual Experience Studio",
        }),
      });

      const entryJson = await entryRes.json();
      if (!entryRes.ok) {
        throw new Error(entryJson.error || "Could not create page draft");
      }

      const newEntryId = entryJson.data.entry.id;
      router.push(`/admin/entries/${newEntryId}/experience`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AdminLayout>
      <div className="flex flex-col gap-8 max-w-7xl mx-auto">
        {/* Hub Header */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-subtle pb-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-action">
              <Sparkles size={13} /> Visual Experience Studio
            </div>
            <h1 className="font-headline text-4xl font-extrabold tracking-tight text-fg-primary">
              EXPERIENCE STUDIO
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
              Visually compose, design, and govern digital experiences. Every change generates an immutable CMS draft version.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreateNewPage()}
              className="inline-flex items-center gap-2 rounded-xl ui-btn ui-btn-primary hover:bg-action-hover transition-colors disabled:opacity-50 cursor-pointer shadow-lg"
            >
              {creating ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              <span>Create Visual Page</span>
            </button>
          </div>
        </header>

        {/* Loading State */}
        {loading ? (
          <div className="flex min-h-60 items-center justify-center text-fg-muted">
            <RefreshCw className="animate-spin text-action" size={24} />
          </div>
        ) : entries.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center p-16 text-center rounded-3xl border border-dashed border-subtle bg-surface-1">
            <div className="w-16 h-16 rounded-2xl bg-action/10 border border-action/20 flex items-center justify-center text-action mb-5">
              <Sparkles size={32} />
            </div>
            <h3 className="text-xl font-bold text-fg-primary">No Visual Pages Composed Yet</h3>
            <p className="text-xs text-fg-secondary max-w-md mt-2 leading-relaxed">
              Create your first visual page composed from developer-approved components like Hero, Feature Grids, Testimonials, and CTAs.
            </p>
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreateNewPage()}
              className="mt-6 px-6 py-3 rounded-xl ui-btn ui-btn-primary font-bold text-xs uppercase tracking-wider hover:bg-action-hover transition-colors cursor-pointer"
            >
              Compose First Page
            </button>
          </div>
        ) : (
          /* Visual Pages Grid */
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {entries.map((item) => (
              <div
                key={item.id}
                className="group flex flex-col justify-between rounded-2xl border border-subtle bg-surface-1 p-6 hover:border-action/40 transition-all shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-action bg-action/10 border border-action/20 px-2.5 py-0.5 rounded-full">
                      {item.modelName}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        item.status === "published"
                          ? "bg-success-muted text-success border border-success"
                          : "bg-warning-muted text-warning border border-warning"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-fg-primary group-hover:text-action transition-colors">
                    {item.title}
                  </h3>

                  {item.slug && (
                    <p className="mt-1 font-mono text-xs text-fg-muted truncate">
                      /{item.slug}
                    </p>
                  )}

                  <div className="mt-4 flex items-center gap-3 text-xs text-fg-secondary border-t border-subtle pt-3">
                    <span className="flex items-center gap-1 text-fg-muted">
                      <Layers size={13} className="text-action" />
                      <span>{item.blockCount} blocks</span>
                    </span>
                    <span className="text-fg-muted">·</span>
                    <span className="font-mono text-[11px] text-fg-muted">
                      v{item.versionNumber}
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2 border-t border-subtle pt-4">
                  <Link
                    href={`/admin/entries/${item.id}/experience`}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl ui-btn ui-btn-primary hover:bg-action-hover transition-colors no-underline"
                  >
                    <Sparkles size={13} />
                    <span>Open Studio</span>
                  </Link>

                  <Link
                    href={`/admin/entries/${item.id}`}
                    className="inline-flex items-center justify-center p-2 rounded-xl border border-subtle bg-surface-2 text-fg-secondary hover:text-fg-primary hover:bg-surface-2 transition-colors"
                    title="Edit in Data Studio"
                  >
                    <Eye size={14} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
