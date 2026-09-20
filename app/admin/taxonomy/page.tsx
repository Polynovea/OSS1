"use client";

import { useState, useEffect } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import {
  Tags,
  Plus,
  ChevronRight,
  ChevronDown,
  FolderTree,
  GitMerge,
  Globe,
  Trash2,
  Edit2,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Search,
} from "lucide-react";

interface Taxonomy {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  hierarchical: boolean;
  model_restrictions: string[] | null;
}

interface Term {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_term_id: string | null;
  is_deprecated: boolean;
  deprecated_by_term_id: string | null;
  order_index: number;
  localizations?: { locale: string; label: string; description: string | null }[];
  aliases?: { alias: string; locale: string | null }[];
  children?: Term[];
}

export default function TaxonomyPage() {
  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([]);
  const [selectedTaxonomy, setSelectedTaxonomy] = useState<Taxonomy | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modals
  const [showCreateTaxModal, setShowCreateTaxModal] = useState(false);
  const [taxName, setTaxName] = useState("");
  const [taxSlug, setTaxSlug] = useState("");
  const [taxDesc, setTaxDesc] = useState("");
  const [taxHierarchical, setTaxHierarchical] = useState(false);

  const [showCreateTermModal, setShowCreateTermModal] = useState(false);
  const [termParentId, setTermParentId] = useState<string | null>(null);
  const [termName, setTermName] = useState("");
  const [termSlug, setTermSlug] = useState("");
  const [termDesc, setTermDesc] = useState("");

  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceTerm, setMergeSourceTerm] = useState<Term | null>(null);
  const [mergeTargetTermId, setMergeTargetTermId] = useState<string>("");

  useEffect(() => {
    loadTaxonomies();
  }, []);

  useEffect(() => {
    if (selectedTaxonomy) {
      loadTerms(selectedTaxonomy.id);
    } else {
      setTerms([]);
    }
  }, [selectedTaxonomy]);

  async function loadTaxonomies() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/taxonomies");
      const json = await res.json();
      if (json.success) {
        setTaxonomies(json.data || []);
        if (json.data?.length > 0 && !selectedTaxonomy) {
          setSelectedTaxonomy(json.data[0]);
        }
      } else {
        setError(json.error || "Could not load taxonomies");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTerms(taxId: string) {
    try {
      const res = await fetch(`/api/taxonomies/${taxId}/terms`);
      const json = await res.json();
      if (json.success) {
        setTerms(json.data || []);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleCreateTaxonomy(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/taxonomies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: taxName,
          slug: taxSlug || taxName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          description: taxDesc,
          hierarchical: taxHierarchical,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSuccess(`Taxonomy "${json.data.name}" created.`);
        setShowCreateTaxModal(false);
        setTaxName("");
        setTaxSlug("");
        setTaxDesc("");
        loadTaxonomies();
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleCreateTerm(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTaxonomy) return;
    try {
      const res = await fetch(`/api/taxonomies/${selectedTaxonomy.id}/terms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: termName,
          slug: termSlug || termName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          description: termDesc,
          parentTermId: termParentId,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSuccess(`Term "${json.data.name}" created.`);
        setShowCreateTermModal(false);
        setTermName("");
        setTermSlug("");
        setTermDesc("");
        setTermParentId(null);
        loadTerms(selectedTaxonomy.id);
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleMergeTerms(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTaxonomy || !mergeSourceTerm || !mergeTargetTermId) return;
    try {
      const res = await fetch(`/api/taxonomies/${selectedTaxonomy.id}/terms/${mergeSourceTerm.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTermId: mergeTargetTermId }),
      });
      const json = await res.json();
      if (json.success) {
        setSuccess(`Term "${mergeSourceTerm.name}" merged successfully.`);
        setShowMergeModal(false);
        setMergeSourceTerm(null);
        setMergeTargetTermId("");
        loadTerms(selectedTaxonomy.id);
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  function renderTermNode(term: Term, depth = 0) {
    return (
      <div key={term.id} className="border-b border-subtle last:border-0">
        <div
          className="flex items-center justify-between gap-4 px-3 py-2.5 transition-colors hover:bg-surface-2"
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {depth > 0 && <span className="text-fg-muted text-xs">└─</span>}
            <span className={`text-sm font-medium ${term.is_deprecated ? "line-through text-fg-muted" : "text-fg-primary"}`}>
              {term.name}
            </span>
            <span className="font-mono text-[10px] text-fg-muted bg-surface-2 px-1.5 py-0.5 rounded border border-subtle">
              {term.slug}
            </span>
            {term.is_deprecated && (
              <span className="text-[10px] bg-warning-muted text-warning border border-warning px-1.5 py-0.2 rounded uppercase font-semibold">
                Deprecated
              </span>
            )}
            {term.aliases && term.aliases.length > 0 && (
              <span className="text-xs text-fg-muted">
                ({term.aliases.map((a) => a.alias).join(", ")})
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {selectedTaxonomy?.hierarchical && !term.is_deprecated && (
              <button
                onClick={() => {
                  setTermParentId(term.id);
                  setShowCreateTermModal(true);
                }}
                className="px-2 py-1 text-xs bg-surface-2 text-fg-muted hover:text-fg-primary border border-subtle rounded flex items-center gap-1"
                title="Add Child Term"
              >
                <Plus className="w-3 h-3" /> Child
              </button>
            )}
            {!term.is_deprecated && (
              <button
                onClick={() => {
                  setMergeSourceTerm(term);
                  setShowMergeModal(true);
                }}
                className="px-2 py-1 text-xs bg-warning-muted text-warning hover:bg-warning-muted border border-warning rounded flex items-center gap-1"
                title="Merge Term"
              >
                <GitMerge className="w-3 h-3" /> Merge
              </button>
            )}
          </div>
        </div>
        {term.children && term.children.map((child) => renderTermNode(child, depth + 1))}
      </div>
    );
  }

  // Flatten terms for merge target selector
  function flattenTerms(items: Term[]): Term[] {
    const list: Term[] = [];
    for (const it of items) {
      list.push(it);
      if (it.children) list.push(...flattenTerms(it.children));
    }
    return list;
  }

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        {/* Header */}
        <div className="ui-page-header">
          <div>
            <p className="ui-eyebrow">Structure / Taxonomy</p>
            <h1 className="ui-page-title flex items-center gap-2">
              <Tags className="h-5 w-5 text-primary" />
              Taxonomy Studio
            </h1>
            <p className="ui-page-description">
              Govern hierarchical categories, tags, localized labels, and atomic term merges.
            </p>
          </div>
          <button
            onClick={() => setShowCreateTaxModal(true)}
            className="ui-btn ui-btn-primary"
          >
            <Plus className="w-4 h-4" />
            New Taxonomy
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="ui-alert ui-alert-danger mt-5 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="ui-alert ui-alert-success mt-5 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {success}
          </div>
        )}

        {/* Main Grid */}
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Left: Taxonomies List */}
          <div className="border-y border-subtle py-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">Taxonomies</h2>
              <span className="font-mono text-[10px] text-fg-muted">{taxonomies.length} total</span>
            </div>
            {taxonomies.length === 0 ? (
              <div className="ui-empty">
                No taxonomies configured.
              </div>
            ) : (
              <div className="space-y-1.5">
                {taxonomies.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTaxonomy(t)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      selectedTaxonomy?.id === t.id
                        ? "bg-surface-2 border-primary/40 text-fg-primary"
                        : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg-primary"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{t.name}</span>
                      {t.hierarchical && (
                        <span className="ui-badge border-primary/30 bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] text-primary">
                          Tree
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-fg-muted mt-1 font-mono">{t.slug}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Terms Tree */}
          <div className="md:col-span-2 border-y border-subtle py-4 space-y-4">
            {selectedTaxonomy ? (
              <>
                <div className="flex items-center justify-between border-b border-subtle pb-3">
                  <div>
                    <h2 className="text-base font-semibold text-fg-primary">{selectedTaxonomy.name} Terms</h2>
                    <p className="text-xs text-fg-muted">
                      {selectedTaxonomy.description || "Manage terms and nested hierarchy"}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setTermParentId(null);
                      setShowCreateTermModal(true);
                    }}
                    className="ui-btn ui-btn-secondary min-h-0 px-2.5 py-1.5 text-[11px]"
                  >
                    <Plus className="w-3.5 h-3.5 text-primary" />
                    Add Term
                  </button>
                </div>

                {terms.length === 0 ? (
                  <div className="ui-empty">
                    No terms created in this taxonomy yet. Click "Add Term" to get started.
                  </div>
                ) : (
                  <div className="overflow-hidden border-y border-subtle">
                    {terms.map((term) => renderTermNode(term))}
                  </div>
                )}
              </>
            ) : (
              <div className="ui-empty">
                Select a taxonomy on the left to view its terms.
              </div>
            )}
          </div>
        </div>

        {/* Create Taxonomy Modal */}
        {showCreateTaxModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-fg-primary">Create New Taxonomy</h3>
              <form onSubmit={handleCreateTaxonomy} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-fg-muted uppercase">Name</label>
                  <input
                    type="text"
                    required
                    value={taxName}
                    onChange={(e) => {
                      setTaxName(e.target.value);
                      if (!taxSlug) setTaxSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
                    }}
                    placeholder="e.g. Categories"
                    className="w-full mt-1 bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary focus:outline-none focus:border-primary/60"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-fg-muted uppercase">Slug</label>
                  <input
                    type="text"
                    required
                    value={taxSlug}
                    onChange={(e) => setTaxSlug(e.target.value)}
                    placeholder="e.g. categories"
                    className="w-full mt-1 bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary font-mono focus:outline-none focus:border-primary/60"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-fg-muted uppercase">Description</label>
                  <textarea
                    value={taxDesc}
                    onChange={(e) => setTaxDesc(e.target.value)}
                    rows={2}
                    placeholder="Optional taxonomy purpose..."
                    className="w-full mt-1 bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary focus:outline-none focus:border-primary/60"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="hierarchical-check"
                    checked={taxHierarchical}
                    onChange={(e) => setTaxHierarchical(e.target.checked)}
                    className="rounded border-subtle"
                  />
                  <label htmlFor="hierarchical-check" className="text-sm text-fg-primary">
                    Hierarchical (supports nested parent/child terms)
                  </label>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateTaxModal(false)}
                    className="px-4 py-2 border border-subtle rounded-lg text-sm text-fg-muted hover:text-fg-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ui-btn ui-btn-primary"
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Create Term Modal */}
        {showCreateTermModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-fg-primary">
                {termParentId ? "Add Child Term" : "Add Term"}
              </h3>
              <form onSubmit={handleCreateTerm} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-fg-muted uppercase">Term Name</label>
                  <input
                    type="text"
                    required
                    value={termName}
                    onChange={(e) => {
                      setTermName(e.target.value);
                      if (!termSlug) setTermSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
                    }}
                    placeholder="e.g. Technology"
                    className="w-full mt-1 bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary focus:outline-none focus:border-primary/60"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-fg-muted uppercase">Slug</label>
                  <input
                    type="text"
                    required
                    value={termSlug}
                    onChange={(e) => setTermSlug(e.target.value)}
                    placeholder="e.g. technology"
                    className="w-full mt-1 bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary font-mono focus:outline-none focus:border-primary/60"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-fg-muted uppercase">Description</label>
                  <textarea
                    value={termDesc}
                    onChange={(e) => setTermDesc(e.target.value)}
                    rows={2}
                    placeholder="Optional term description..."
                    className="w-full mt-1 bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary focus:outline-none focus:border-primary/60"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateTermModal(false)}
                    className="px-4 py-2 border border-subtle rounded-lg text-sm text-fg-muted hover:text-fg-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ui-btn ui-btn-primary"
                  >
                    Save Term
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Merge Term Modal */}
        {showMergeModal && mergeSourceTerm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-fg-primary flex items-center gap-2">
                <GitMerge className="w-5 h-5 text-warning" />
                Merge Term: {mergeSourceTerm.name}
              </h3>
              <p className="text-xs text-fg-muted">
                Merging will deprecate <strong>{mergeSourceTerm.name}</strong>, transfer its aliases, and re-point active drafts to the selected destination term. Historical versions remain preserved.
              </p>
              <form onSubmit={handleMergeTerms} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-fg-muted uppercase">Target Term</label>
                  <select
                    required
                    value={mergeTargetTermId}
                    onChange={(e) => setMergeTargetTermId(e.target.value)}
                    className="w-full mt-1 bg-surface-2 border border-subtle rounded-lg px-3 py-2 text-sm text-fg-primary focus:outline-none focus:border-primary/60"
                  >
                    <option value="">Select destination term...</option>
                    {flattenTerms(terms)
                      .filter((t) => t.id !== mergeSourceTerm.id && !t.is_deprecated)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.slug})
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowMergeModal(false)}
                    className="px-4 py-2 border border-subtle rounded-lg text-sm text-fg-muted hover:text-fg-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-warning-muted text-surface-canvas font-medium rounded-lg text-sm hover:brightness-110"
                  >
                    Confirm Merge
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
