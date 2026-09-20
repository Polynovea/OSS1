"use client";

import { useState, useEffect } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import {
  CornerUpRight,
  Plus,
  Upload,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Edit2,
  RefreshCw,
  Search,
  ArrowRight,
  Check,
  X,
} from "lucide-react";

interface Redirect {
  id: string;
  source_path: string;
  target_path: string;
  status_code: number;
  is_active: boolean;
  locale: string | null;
  description: string | null;
  created_at: string;
}

export default function RedirectsPage() {
  const [redirects, setRedirects] = useState<Redirect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Create/Edit Modal
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [statusCode, setStatusCode] = useState<number>(301);
  const [locale, setLocale] = useState("");
  const [description, setDescription] = useState("");

  // Bulk Import Modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importCsv, setImportCsv] = useState("");
  const [importReport, setImportReport] = useState<any>(null);

  useEffect(() => {
    loadRedirects();
  }, []);

  async function loadRedirects() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/redirects");
      const json = await res.json();
      if (json.success) {
        setRedirects(json.data || []);
      } else {
        setError(json.error || "Could not load redirects");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveRedirect(e: React.FormEvent) {
    e.preventDefault();
    try {
      const url = editingId ? `/api/redirects/${editingId}` : "/api/redirects";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath,
          targetPath,
          statusCode,
          locale: locale || null,
          description,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setSuccess(`Redirect ${editingId ? "updated" : "created"} successfully.`);
        setShowModal(false);
        setEditingId(null);
        setSourcePath("");
        setTargetPath("");
        setDescription("");
        loadRedirects();
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleToggleActive(redirect: Redirect) {
    try {
      const res = await fetch(`/api/redirects/${redirect.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !redirect.is_active }),
      });
      const json = await res.json();
      if (json.success) {
        loadRedirects();
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this redirect?")) return;
    try {
      const res = await fetch(`/api/redirects/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        setSuccess("Redirect deleted.");
        loadRedirects();
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleBulkImport(dryRun = true) {
    try {
      const lines = importCsv.trim().split("\n");
      const items = lines.map((l) => {
        const parts = l.split(",");
        return {
          sourcePath: parts[0]?.trim() || "",
          targetPath: parts[1]?.trim() || "",
          statusCode: Number(parts[2]?.trim()) || 301,
        };
      }).filter((it) => it.sourcePath && it.targetPath);

      const res = await fetch("/api/redirects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, dryRun }),
      });

      const json = await res.json();
      if (json.success) {
        setImportReport(json.data);
        if (!dryRun) {
          setSuccess(`Successfully imported ${json.data.validCount} redirects.`);
          setShowImportModal(false);
          setImportCsv("");
          setImportReport(null);
          loadRedirects();
        }
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  const filtered = redirects.filter((r) =>
    r.source_path.toLowerCase().includes(search.toLowerCase()) ||
    r.target_path.toLowerCase().includes(search.toLowerCase()) ||
    (r.description && r.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        {/* Header */}
        <div className="ui-page-header">
          <div>
            <p className="ui-eyebrow">Structure / Redirects</p>
            <h1 className="ui-page-title flex items-center gap-2">
              <CornerUpRight className="h-5 w-5 text-primary" />
              Redirect Manager
            </h1>
            <p className="ui-page-description">
              Govern 301 permanent and temporary URL redirects with circular loop detection and bulk import.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImportModal(true)}
              className="ui-btn ui-btn-secondary"
            >
              <Upload className="w-4 h-4 text-primary" />
              Bulk Import
            </button>
            <button
              onClick={() => {
                setEditingId(null);
                setSourcePath("");
                setTargetPath("");
                setStatusCode(301);
                setDescription("");
                setShowModal(true);
              }}
              className="ui-btn ui-btn-primary"
            >
              <Plus className="w-4 h-4" />
              Add Redirect
            </button>
          </div>
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

        {/* Search */}
        <div className="mt-6 flex items-center gap-3 border-y border-subtle px-1 py-3">
          <Search className="w-4 h-4 text-fg-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search redirects by source or target path..."
            className="w-full border-0 bg-transparent text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none"
          />
        </div>

        {/* Table */}
        <div className="mt-5 overflow-hidden border-y border-subtle">
          <div className="overflow-x-auto">
            <table className="ui-table w-full text-left">
              <thead className="border-b border-subtle text-[10px] text-fg-muted uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4 font-semibold">Source Path</th>
                  <th className="py-3 px-4 font-semibold">Target Path</th>
                  <th className="py-3 px-4 font-semibold">Code</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Description</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="ui-empty">
                      No redirect rules found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id} className="transition-colors hover:bg-surface-2">
                      <td className="py-3.5 px-4 font-mono font-medium text-fg-primary text-xs">
                        {r.source_path}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-primary text-xs flex items-center gap-1.5">
                        <ArrowRight className="w-3 h-3 shrink-0 text-fg-muted" />
                        <span className="truncate max-w-xs">{r.target_path}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="ui-badge border-default bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-fg-secondary">
                          {r.status_code}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => handleToggleActive(r)}
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${
                            r.is_active
                              ? "bg-success-muted text-success border-success"
                              : "bg-surface-2 text-fg-muted border-subtle"
                          }`}
                        >
                          {r.is_active ? "Active" : "Disabled"}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-fg-muted truncate max-w-[200px]">
                        {r.description || "—"}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setEditingId(r.id);
                              setSourcePath(r.source_path);
                              setTargetPath(r.target_path);
                              setStatusCode(r.status_code);
                              setLocale(r.locale || "");
                              setDescription(r.description || "");
                              setShowModal(true);
                            }}
                            className="p-1.5 text-fg-muted hover:text-fg-primary hover:bg-surface-2 rounded"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(r.id)}
                            className="p-1.5 text-danger hover:text-danger hover:bg-danger-muted rounded"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-fg-primary">
                {editingId ? "Edit Redirect" : "Add New Redirect"}
              </h3>
              <form onSubmit={handleSaveRedirect} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Source Path</label>
                  <input
                    type="text"
                    required
                    value={sourcePath}
                    onChange={(e) => setSourcePath(e.target.value)}
                    placeholder="/old-page"
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Target Path or External URL</label>
                  <input
                    type="text"
                    required
                    value={targetPath}
                    onChange={(e) => setTargetPath(e.target.value)}
                    placeholder="/new-page or https://..."
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Status Code</label>
                    <select
                      value={statusCode}
                      onChange={(e) => setStatusCode(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                    >
                      <option value={301}>301 (Permanent)</option>
                      <option value={308}>308 (Permanent Preserve)</option>
                      <option value={302}>302 (Temporary)</option>
                      <option value={307}>307 (Temporary Preserve)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Locale (Optional)</label>
                    <input
                      type="text"
                      value={locale}
                      onChange={(e) => setLocale(e.target.value)}
                      placeholder="e.g. en"
                      className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Description</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Reason for redirect..."
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="ui-btn ui-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ui-btn ui-btn-primary"
                  >
                    Save Redirect
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Bulk Import Modal */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-lg w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-fg-primary flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary" />
                Bulk CSV Import
              </h3>
              <p className="text-xs text-fg-muted">
                Paste CSV lines formatted as: <code className="font-mono text-primary">/source,/target,301</code> (one per line).
              </p>
              <textarea
                value={importCsv}
                onChange={(e) => setImportCsv(e.target.value)}
                rows={6}
                placeholder={"/legacy-about,/about,301\n/old-store,/shop,301\n/promo-2025,/campaigns/spring,302"}
                className="w-full rounded-lg p-3 text-xs font-mono"
              />

              {/* Dry-Run Results Report */}
              {importReport && (
                <div className="rounded-lg border border-subtle bg-surface-2 p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="text-success">Valid: {importReport.validCount}</span>
                    <span className="text-danger">Errors: {importReport.errorCount}</span>
                  </div>
                  {importReport.errors.length > 0 && (
                    <div className="space-y-1 text-danger max-h-28 overflow-y-auto">
                      {importReport.errors.map((err: any, idx: number) => (
                        <div key={idx}>
                          Row {err.row} ({err.sourcePath}): {err.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowImportModal(false);
                    setImportReport(null);
                  }}
                  className="ui-btn ui-btn-secondary"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkImport(true)}
                  className="ui-btn ui-btn-secondary"
                >
                  Dry-Run Validate
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkImport(false)}
                  disabled={!importReport || importReport.validCount === 0}
                  className="ui-btn ui-btn-primary disabled:opacity-50"
                >
                  Commit Import
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
