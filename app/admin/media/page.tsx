"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import {
  ImagePlus,
  Loader2,
  Upload,
  FolderTree,
  Plus,
  RefreshCw,
  Eye,
  FileText,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Layers,
  Folder,
} from "lucide-react";

interface Asset {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  checksum: string;
  alt_text: string | null;
  folder: string;
  preview_url: string;
  created_at: string;
}

interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  assetCount?: number;
}

interface AssetUsage {
  entryId: string;
  versionId: string;
  title: string;
  fieldKey: string;
  status: string;
  isPublished: boolean;
}

export default function MediaPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Inspector & Replace Modal
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [assetUsage, setAssetUsage] = useState<AssetUsage[]>([]);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceReason, setReplaceReason] = useState("");
  const [replacing, setReplacing] = useState(false);

  // Create Collection Modal
  const [showCreateColModal, setShowCreateColModal] = useState(false);
  const [colName, setColName] = useState("");
  const [colSlug, setColSlug] = useState("");
  const [colDesc, setColDesc] = useState("");

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/api/assets";
      if (selectedCollectionId) {
        url = `/api/media/collections/${selectedCollectionId}`;
      }
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      if (selectedCollectionId) {
        setAssets(body.data?.assets || []);
      } else {
        setAssets(body.data || []);
      }
    } catch (err: any) {
      setError(err.message || "Could not load assets");
    } finally {
      setLoading(false);
    }
  }, [selectedCollectionId]);

  const loadCollections = useCallback(async () => {
    try {
      const res = await fetch("/api/media/collections");
      const body = await res.json();
      if (body.success) {
        setCollections(body.data || []);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadAssets();
    void loadCollections();
  }, [loadAssets, loadCollections]);

  async function handleInspectAsset(asset: Asset) {
    setSelectedAsset(asset);
    setLoadingUsage(true);
    try {
      const res = await fetch(`/api/assets/${asset.id}/usage`);
      const body = await res.json();
      if (body.success) {
        setAssetUsage(body.data || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingUsage(false);
    }
  }

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("folder", "library");
      form.set("altText", file.name.replace(/\.[^.]+$/, ""));
      const res = await fetch("/api/assets", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setSuccess(`Asset "${file.name}" uploaded successfully.`);
      await loadAssets();
      await loadCollections();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleReplaceAsset = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedAsset) return;
    setReplacing(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("reason", replaceReason || "Media operations replacement");
      const res = await fetch(`/api/assets/${selectedAsset.id}/replace`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      setSuccess(`Asset replaced with "${file.name}". Previous version recorded in replacement history.`);
      setShowReplaceModal(false);
      setSelectedAsset(null);
      await loadAssets();
    } catch (err: any) {
      setError(err.message || "Replacement failed");
    } finally {
      setReplacing(false);
    }
  };

  async function handleCreateCollection(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/media/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: colName,
          slug: colSlug || colName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          description: colDesc,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSuccess(`Collection "${json.data.name}" created.`);
        setShowCreateColModal(false);
        setColName("");
        setColSlug("");
        setColDesc("");
        loadCollections();
      } else {
        setError(json.error);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        {/* Header */}
        <header className="ui-page-header">
          <div>
            <p className="ui-eyebrow">Create / Media</p>
            <h1 className="ui-page-title flex items-center gap-2">
              <FolderTree className="h-5 w-5 text-primary" />
              Media Operations
            </h1>
            <p className="ui-page-description">
              Govern media collections, metadata dimensions, recoverable asset replacements, and where-used graphs.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCreateColModal(true)}
              className="ui-btn ui-btn-secondary"
            >
              <Plus className="w-4 h-4 text-primary" />
              New Collection
            </button>
            <label className="ui-btn ui-btn-primary cursor-pointer">
              <input type="file" className="hidden" onChange={upload} accept="image/*,video/*,.pdf" />
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? "Uploading…" : "Upload Asset"}
            </label>
          </div>
        </header>

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
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-4">
          {/* Left: Collections Sidebar */}
          <div className="border-y border-subtle py-4 space-y-3">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">Collections</h2>
            <div className="space-y-1">
              <button
                onClick={() => setSelectedCollectionId(null)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between border transition-all ${
                  selectedCollectionId === null
                    ? "bg-surface-2 border-primary/40 text-fg-primary font-medium"
                    : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg-primary"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" /> All Assets
                </span>
              </button>
              {collections.map((col) => (
                <button
                  key={col.id}
                  onClick={() => setSelectedCollectionId(col.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between border transition-all ${
                    selectedCollectionId === col.id
                      ? "bg-surface-2 border-primary/40 text-fg-primary font-medium"
                      : "border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg-primary"
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Folder className="w-4 h-4 text-primary shrink-0" />
                    <span className="truncate">{col.name}</span>
                  </span>
                  {col.assetCount !== undefined && (
                    <span className="font-mono text-[10px] text-fg-muted">{col.assetCount}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Right: Asset Grid */}
          <div className="md:col-span-3">
            {loading ? (
              <div className="flex min-h-64 items-center justify-center text-fg-muted">
                <Loader2 className="animate-spin w-8 h-8" />
              </div>
            ) : assets.length === 0 ? (
              <div className="ui-empty border-y border-subtle">
                <ImagePlus className="mx-auto text-primary" size={32} />
                <h2 className="ui-empty-title mt-4">A home for every asset</h2>
                <p className="ui-empty-copy">
                  Upload images, videos, or PDFs to organize them into collections and govern their usage.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                {assets.map((asset) => (
                  <article
                    key={asset.id}
                    onClick={() => handleInspectAsset(asset)}
                    className="ui-card group cursor-pointer overflow-hidden transition-colors hover:border-primary/40"
                  >
                    <div className="h-36 w-full bg-surface-2 flex items-center justify-center overflow-hidden">
                      {asset.mime_type.startsWith("image/") ? (
                        <img
                          src={asset.preview_url}
                          alt={asset.alt_text || asset.filename}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <FileText className="w-10 h-10 text-fg-muted" />
                      )}
                    </div>
                    <div className="p-3">
                      <p className="truncate text-sm font-semibold text-fg-primary">{asset.filename}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                        {(asset.size_bytes / 1024).toFixed(0)} KB · {asset.mime_type.split("/")[1]}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Asset Inspector Modal */}
        {selectedAsset && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-xl w-full p-6 space-y-4">
              <div className="flex items-start justify-between border-b border-subtle pb-3">
                <div>
                  <h3 className="max-w-md truncate text-lg font-bold text-fg-primary">{selectedAsset.filename}</h3>
                  <p className="font-mono text-[10px] text-fg-muted mt-0.5">ID: {selectedAsset.id}</p>
                </div>
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="text-fg-muted hover:text-fg-primary text-sm"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="h-44 bg-surface-2 rounded-lg flex items-center justify-center overflow-hidden border border-subtle">
                  {selectedAsset.mime_type.startsWith("image/") ? (
                    <img src={selectedAsset.preview_url} alt="" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <FileText className="w-12 h-12 text-fg-muted" />
                  )}
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <span className="text-fg-muted font-semibold uppercase">MIME Type:</span>{" "}
                    <span className="font-mono text-fg-primary">{selectedAsset.mime_type}</span>
                  </div>
                  <div>
                    <span className="text-fg-muted font-semibold uppercase">File Size:</span>{" "}
                    <span className="font-mono text-fg-primary">{(selectedAsset.size_bytes / 1024).toFixed(1)} KB</span>
                  </div>
                  <div>
                    <span className="text-fg-muted font-semibold uppercase">Checksum:</span>{" "}
                    <span className="font-mono text-fg-primary">{selectedAsset.checksum.slice(0, 16)}...</span>
                  </div>
                  <div>
                    <span className="text-fg-muted font-semibold uppercase">Storage Folder:</span>{" "}
                    <span className="font-mono text-fg-primary">{selectedAsset.folder}</span>
                  </div>
                </div>
              </div>

              {/* Where-Used Section */}
              <div className="border-t border-subtle pt-3 space-y-2">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">
                  Where Used Impact Graph ({assetUsage.length} references)
                </h4>
                {loadingUsage ? (
                  <div className="text-xs text-fg-muted py-2">Loading references...</div>
                ) : assetUsage.length === 0 ? (
                  <p className="text-xs text-fg-muted italic">No content entries currently reference this asset.</p>
                ) : (
                  <div className="max-h-28 overflow-y-auto space-y-1.5 text-xs bg-surface-2 p-2 rounded-lg border border-subtle">
                    {assetUsage.map((u, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="font-medium text-fg-primary">{u.title}</span>
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                          u.isPublished ? "bg-success-muted text-success" : "bg-surface-2 text-fg-muted"
                        }`}>
                          {u.status} ({u.fieldKey})
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-subtle">
                <label className="cursor-pointer px-3.5 py-2 bg-warning-muted hover:bg-warning-muted text-warning border border-warning rounded-lg text-xs font-semibold flex items-center gap-1.5">
                  <input type="file" className="hidden" onChange={handleReplaceAsset} accept="image/*,video/*,.pdf" />
                  <RefreshCw className="w-3.5 h-3.5" />
                  {replacing ? "Replacing..." : "Replace File (Preserve ID)"}
                </label>
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="ui-btn ui-btn-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create Collection Modal */}
        {showCreateColModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="ui-card-elevated max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-fg-primary">Create Media Collection</h3>
              <form onSubmit={handleCreateCollection} className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Collection Name</label>
                  <input
                    type="text"
                    required
                    value={colName}
                    onChange={(e) => {
                      setColName(e.target.value);
                      if (!colSlug) setColSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
                    }}
                    placeholder="e.g. Hero Banners"
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Slug</label>
                  <input
                    type="text"
                    required
                    value={colSlug}
                    onChange={(e) => setColSlug(e.target.value)}
                    placeholder="e.g. hero-banners"
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Description</label>
                  <textarea
                    value={colDesc}
                    onChange={(e) => setColDesc(e.target.value)}
                    rows={2}
                    placeholder="Optional description..."
                    className="mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateColModal(false)}
                    className="ui-btn ui-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="ui-btn ui-btn-primary"
                  >
                    Create Collection
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
