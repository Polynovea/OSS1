"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import BlogForm, { type BlogFormData } from "@/components/admin/BlogForm";
import Toast, { showToast } from "@/components/admin/Toast";
import WorkflowPanel from "@/components/admin/WorkflowPanel";
import PreflightPanel from "@/components/admin/PreflightPanel";
import PreviewButton from "@/components/admin/PreviewButton";
import ImpactPanel from "@/components/admin/ImpactPanel";
import LocalizationPanel from "@/components/admin/LocalizationPanel";
import CollaborationPanel from "@/components/admin/CollaborationPanel";
import {
  ArrowLeft,
  Sparkles,
  Archive,
  ArchiveRestore,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Clock3,
  RotateCcw,
} from "lucide-react";
import { useAdminAccess } from "@/lib/admin/useAdminAccess";
import { hasModuleWriteAccess } from "@/lib/admin/access";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { isModelVisualEligible } from "@/lib/experience/eligibility";
import type { BlogPost } from "@/lib/admin/types";

interface VersionItem {
  id: string;
  version_number: number;
  state: string;
  change_summary: string | null;
  created_at: string;
}

export default function EditBlogPostPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { profile } = useAdminAccess();

  const [post, setPost] = useState<BlogPost | null>(null);
  const [model, setModel] = useState<any>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [currentDraftVersionId, setCurrentDraftVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const canManage = hasModuleWriteAccess(profile, "cms.blog");

  const loadEntry = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);

      const headers = await getAuthHeaders();
      // 1. Fetch entry and versions
      const res = await fetch(`/api/entries/${id}`, { headers });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Could not load blog post");
      }

      const entry = json.data.entry;
      const vers: VersionItem[] = json.data.versions || [];
      setVersions(vers);
      setCurrentDraftVersionId(entry.current_draft_version_id || null);

      // Fetch model to inspect visual eligibility
      const modelRes = await fetch(`/api/models/${entry.content_model_id}`, { headers });
      const modelJson = await modelRes.json();
      if (modelRes.ok && modelJson.success) {
        setModel(modelJson.data);
      }

      // Use latest version data (draft or published)
      const latestVersion =
        vers.find((v: any) => v.id === entry.current_draft_version_id) ||
        vers.find((v: any) => v.id === entry.published_version_id) ||
        vers[0];

      const data = (latestVersion as any)?.data_jsonb || {};
      const title =
        (data.title as string) ||
        (data.name as string) ||
        (data.headline as string) ||
        `Blog Post (${entry.id.slice(0, 8)})`;
      const slug = (data.slug as string) || (data.slug_url as string) || "";
      const bodyContent =
        typeof data.body === "string"
          ? data.body
          : typeof data.content === "string"
          ? data.content
          : JSON.stringify(data.body || data.content || []);
      const excerpt = (data.excerpt as string) || "";
      const author = (data.author as string) || "Polynovea Team";
      const cover_image = (data.cover_image as string) || null;
      const published_at =
        (data.published_at as string) ||
        (entry.status === "published" ? entry.updated_at : null);

      setPost({
        id: entry.id,
        title,
        slug,
        content: bodyContent,
        excerpt,
        author,
        status: entry.status,
        cover_image,
        published_at,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load blog entry");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadEntry();
  }, [loadEntry]);

  const handleSavePost = async (formData: BlogFormData, isPublishing: boolean, changeSummary?: string) => {
    if (!id || !post) throw new Error("Post not loaded");
    setConflict(false);

    const currentDraft = versions.find((v) => v.id === currentDraftVersionId) || versions[0];

    const postData = {
      title: formData.title.trim(),
      slug: formData.slug.trim(),
      excerpt: formData.excerpt.trim(),
      body: formData.content, // ContentBlock[] JSON string
      author: formData.author.trim(),
      cover_image: formData.cover_image || null,
      published_at: isPublishing
        ? post.published_at || new Date().toISOString()
        : post.published_at || null,
    };

    const headers = await getAuthHeaders();
    // 1. Update draft in generic engine with OCC expectedVersionNumber
    const res = await fetch(`/api/entries/${id}`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        data: postData,
        changeSummary: changeSummary?.trim() || (isPublishing ? "Published blog post" : "Updated blog post"),
        expectedVersionNumber: currentDraft?.version_number,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      if (res.status === 409) {
        setConflict(true);
        await loadEntry();
        throw new Error("Conflict detected: A newer version was saved concurrently. Refreshing to latest.");
      }
      throw new Error(json.error || "Failed to update blog post");
    }

    // 2. If publishing, invoke publish endpoint
    if (isPublishing) {
      const pubRes = await fetch(`/api/entries/${id}/publish`, {
        method: "POST",
        headers,
      });
      const pubJson = await pubRes.json();
      if (!pubRes.ok || !pubJson.success) {
        throw new Error(pubJson.error || "Failed to publish blog post");
      }
    }

    await loadEntry();
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!id) return;
    setActionBusy(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/entries/${id}/restore`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to restore version");
      showToast("Version restored as draft.", "success");
      await loadEntry();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Restore failed", "error");
    } finally {
      setActionBusy(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!id || !post) return;
    setActionBusy(true);
    try {
      const headers = await getAuthHeaders();
      const endpoint =
        post.status === "archived"
          ? `/api/entries/${id}/unarchive`
          : `/api/entries/${id}/archive`;
      const res = await fetch(endpoint, { method: "POST", headers });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Action failed");
      showToast(
        post.status === "archived"
          ? "Post restored from archive."
          : "Post moved to archive.",
        "success"
      );
      await loadEntry();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Archive action failed", "error");
    } finally {
      setActionBusy(false);
    }
  };

  const isVisualEligible = model?.current_schema
    ? isModelVisualEligible(model.current_schema)
    : false;

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant pb-5">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/blog"
              className="p-2.5 rounded-xl border border-subtle bg-surface-2 text-fg-secondary hover:text-on-surface hover:border-default transition-all cursor-pointer"
              title="Back to Blog Management"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Content Publishing Hub / Edit
              </p>
              <h1 className="mt-1 font-headline font-extrabold text-2xl md:text-3xl text-on-surface tracking-tight truncate max-w-lg">
                {post ? post.title : "EDIT BLOG POST"}
              </h1>
            </div>
          </div>

          {post && (
            <div className="flex items-center gap-3">
              <span
                className={
                  post.status === "published"
                    ? "text-xs font-bold uppercase tracking-wider text-success"
                    : post.status === "archived"
                    ? "text-xs font-bold uppercase tracking-wider text-fg-muted"
                    : "text-xs font-bold uppercase tracking-wider text-warning"
                }
              >
                {post.status}
              </span>
              {isVisualEligible && (
                <Link
                  href={`/admin/blog/${id}/experience`}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-review-muted border border-review hover:bg-review-muted text-review font-body text-xs font-semibold uppercase tracking-wider transition-all no-underline"
                  title="Open Visual Experience Studio"
                >
                  <Sparkles className="w-4 h-4" />
                  Visual Studio
                </Link>
              )}
              <button
                onClick={handleToggleArchive}
                disabled={actionBusy || !canManage}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-subtle bg-surface-2 hover:bg-surface-3 text-fg-secondary font-body text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer disabled:opacity-50"
                title={post.status === "archived" ? "Restore post" : "Archive post"}
              >
                {actionBusy ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />
                ) : post.status === "archived" ? (
                  <>
                    <ArchiveRestore className="w-3.5 h-3.5 text-success" />
                    <span>Restore</span>
                  </>
                ) : (
                  <>
                    <Archive className="w-3.5 h-3.5" />
                    <span>Archive</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Conflict Warning */}
        {conflict && (
          <div className="flex items-center gap-2 rounded-xl border border-warning bg-warning-muted p-4 text-sm text-amber-200">
            <AlertTriangle size={16} /> Someone else saved a newer version while you were editing — the form below now shows the latest version. Re-apply your changes and save again.
          </div>
        )}

        {/* Content Body */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 bg-surface-1 border border-subtle rounded-2xl gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            <p className="font-body text-xs text-fg-muted uppercase tracking-wider">
              Loading blog publication...
            </p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-2xl bg-danger-muted border border-danger text-danger flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-danger shrink-0" />
            <p className="text-sm font-body">{error}</p>
          </div>
        ) : !post ? (
          <div className="p-8 text-center rounded-2xl bg-surface-1/30 border border-subtle text-fg-secondary">
            Post not found.
          </div>
        ) : (
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* Main Editorial Form & Collaboration */}
            <div className="space-y-6">
              <div className="bg-surface-1 border border-subtle rounded-2xl p-6 md:p-8 backdrop-blur-xl shadow-2xl">
                <BlogForm
                  post={post}
                  onSave={handleSavePost}
                  onSuccess={() => {
                    showToast("Post saved successfully.", "success");
                  }}
                  onCancel={() => router.push("/admin/blog")}
                />
              </div>
              <CollaborationPanel entryId={id} />
            </div>

            {/* Governance & Editorial Sidebar */}
            <aside className="space-y-6">
              <WorkflowPanel entryId={id} onChanged={loadEntry} />
              <PreflightPanel entryId={id} />
              <PreviewButton entryId={id} />
              <ImpactPanel entryId={id} />
              <LocalizationPanel entryId={id} />

              {/* Version History */}
              <section className="rounded-2xl border border-subtle bg-surface-1 p-5">
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
                        <span className="ml-1 text-fg-muted font-normal">
                          ({version.state})
                        </span>
                      </p>
                      <p className="mt-1 text-[10px] text-fg-muted">
                        {version.change_summary || "No change summary"}
                      </p>
                      {version.id !== currentDraftVersionId && (
                        <button
                          disabled={actionBusy || !canManage}
                          type="button"
                          onClick={() => void handleRestoreVersion(version.id)}
                          className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-action hover:underline disabled:opacity-50 cursor-pointer"
                        >
                          <RotateCcw size={11} /> Restore as draft
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>

      <Toast />
    </AdminLayout>
  );
}
