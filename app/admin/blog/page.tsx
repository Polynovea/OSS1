"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import BlogTable from "@/components/admin/BlogTable";
import Toast, { showToast } from "@/components/admin/Toast";
import { usePolling } from "@/lib/admin/usePolling";
import { useAdminAccess } from "@/lib/admin/useAdminAccess";
import { hasModuleWriteAccess } from "@/lib/admin/access";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import type { BlogPost } from "@/lib/admin/types";
import { isModelVisualEligible } from "@/lib/experience/eligibility";
import {
  Plus,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

interface ContentModel {
  id: string;
  name: string;
  api_key: string;
  description: string | null;
  current_schema?: any;
}

export default function BlogAdminPage() {
  const router = useRouter();
  const { profile } = useAdminAccess();
  const [blogModel, setBlogModel] = useState<ContentModel | null>(null);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const canManage = hasModuleWriteAccess(profile, "cms.blog");

  const loadData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      // 1. Fetch models to identify the canonical blog_post model
      const modelsRes = await fetch("/api/models", { headers });
      const modelsJson = await modelsRes.json();
      if (!modelsRes.ok || !modelsJson.success) {
        throw new Error(modelsJson.error || "Could not load content models");
      }

      const foundBlogModel = (modelsJson.data as ContentModel[]).find(
        (m) => m.api_key === "blog_post" || m.name.toLowerCase().includes("blog")
      );

      if (!foundBlogModel) {
        setBlogModel(null);
        setPosts([]);
        return;
      }

      setBlogModel(foundBlogModel);

      // 2. Fetch generic entries for this blog model
      const entriesRes = await fetch(`/api/entries?modelId=${foundBlogModel.id}`, { headers });
      const entriesJson = await entriesRes.json();
      if (!entriesRes.ok || !entriesJson.success) {
        throw new Error(entriesJson.error || "Could not load blog entries");
      }

      const mappedPosts: BlogPost[] = (entriesJson.data || []).map((entry: any) => {
        const data = entry.data || {};
        const title =
          data.title || data.name || data.headline || `Blog Post (${entry.id.slice(0, 8)})`;
        const slug = data.slug || data.slug_url || "";
        const content =
          typeof data.body === "string"
            ? data.body
            : typeof data.content === "string"
            ? data.content
            : JSON.stringify(data.body || data.content || []);
        const excerpt = data.excerpt || "";
        const author = data.author || "Polynovea Team";
        const cover_image = data.cover_image || null;
        const published_at =
          data.published_at || (entry.status === "published" ? entry.updated_at : null);

        return {
          id: entry.id,
          title,
          slug,
          content,
          excerpt,
          author,
          status: entry.status,
          cover_image,
          published_at,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
        };
      });

      setPosts(mappedPosts);
    } catch (err) {
      if (!isSilent) {
        setError(err instanceof Error ? err.message : "Failed to load blog publications");
      }
    } finally {
      if (!isSilent) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time background sync
  usePolling(
    useCallback(() => {
      loadData(true);
    }, [loadData])
  );

  const handleCreate = () => {
    router.push("/admin/blog/new");
  };

  const handleEdit = (post: BlogPost) => {
    router.push(`/admin/blog/${post.id}`);
  };

  const handleToggleStatus = async (post: BlogPost) => {
    try {
      const headers = await getAuthHeaders();
      if (post.status === "draft") {
        const res = await fetch(`/api/entries/${post.id}/publish`, { method: "POST", headers });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Failed to publish post");
        showToast("Post published.", "success");
      } else if (post.status === "published") {
        const res = await fetch(`/api/entries/${post.id}/archive`, { method: "POST", headers });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Failed to archive post");
        showToast("Post moved to archive.", "success");
      } else if (post.status === "archived") {
        const res = await fetch(`/api/entries/${post.id}/unarchive`, { method: "POST", headers });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Failed to restore post");
        showToast("Post restored from archive.", "success");
      }
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to change status", "error");
    }
  };

  const handleToggleArchive = async (post: BlogPost) => {
    try {
      const headers = await getAuthHeaders();
      const endpoint =
        post.status === "archived"
          ? `/api/entries/${post.id}/unarchive`
          : `/api/entries/${post.id}/archive`;
      const res = await fetch(endpoint, { method: "POST", headers });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to update archive status");
      showToast(post.status === "archived" ? "Post restored from archive." : "Post archived.", "success");
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Archive action failed", "error");
    }
  };

  const handleDeletePost = async (post: BlogPost) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/entries/${post.id}/archive`, { method: "POST", headers });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to archive post");
      showToast("Post archived.", "success");
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete action failed", "error");
    }
  };

  const counts = {
    total: posts.length,
    published: posts.filter((p) => p.status === "published").length,
    in_review: posts.filter((p) => p.status === "in_review").length,
    draft: posts.filter((p) => p.status === "draft").length,
    archived: posts.filter((p) => p.status === "archived").length,
  };

  const isVisualEligible = blogModel?.current_schema
    ? isModelVisualEligible(blogModel.current_schema)
    : false;

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        {/* Page Header */}
        <div className="ui-page-header">
          <div>
            <h1 className="ui-page-title">
              BLOG
            </h1>
            <p className="ui-page-description">
              Content publishing hub powered by the canonical{" "}
              <code className="text-primary font-mono text-xs bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                blog_post
              </code>{" "}
              content engine.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setRefreshing(true);
                loadData();
              }}
              disabled={refreshing}
              className="ui-btn ui-btn-secondary"
              title="Refresh blog posts"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-primary" : ""}`} />
              <span>Refresh</span>
            </button>
            <button
              className="ui-btn ui-btn-primary"
              onClick={handleCreate}
              disabled={!canManage || !blogModel}
            >
              <Plus className="w-4 h-4 -mt-0.5" />
              New Post
            </button>
          </div>
        </div>

        {/* Metrics Overview Cards */}
        <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-y border-subtle py-5 sm:grid-cols-4">
          <div className="min-w-0 border-r border-subtle pr-4 last:border-r-0">
            <div className="text-[11px] font-semibold text-fg-muted uppercase tracking-wider">
              Total Posts
            </div>
            <div className="mt-2 text-2xl font-bold text-on-surface">{counts.total}</div>
          </div>
          <div className="min-w-0 border-r border-subtle pr-4 last:border-r-0">
            <div className="text-[11px] font-semibold text-success uppercase tracking-wider">
              Published
            </div>
            <div className="mt-2 text-2xl font-bold text-success">{counts.published}</div>
          </div>
          <div className="min-w-0 border-r border-subtle pr-4 last:border-r-0">
            <div className="text-[11px] font-semibold text-info uppercase tracking-wider">
              In Review
            </div>
            <div className="mt-2 text-2xl font-bold text-info">{counts.in_review}</div>
          </div>
          <div className="min-w-0 border-r border-subtle pr-4 last:border-r-0">
            <div className="text-[11px] font-semibold text-warning uppercase tracking-wider">
              Drafts
            </div>
            <div className="mt-2 text-2xl font-bold text-warning">{counts.draft}</div>
          </div>
        </div>

        {/* Main Content Area */}
        {loading ? (
          <div className="ui-empty border-y border-subtle">
            <div className="w-8 h-8 border-2 border-subtle border-t-primary rounded-full animate-spin" />
            <span className="font-body text-xs font-semibold tracking-wider uppercase">
              Loading blog publications...
            </span>
          </div>
        ) : error ? (
          <div className="ui-alert ui-alert-danger mt-5 text-center">
            <AlertCircle className="w-6 h-6 text-danger" />
            <p className="font-body text-sm text-center">{error}</p>
            <button
              className="ui-btn ui-btn-secondary mt-3"
              onClick={() => loadData()}
            >
              Retry
            </button>
          </div>
        ) : !blogModel ? (
          <div className="ui-empty border-y border-subtle space-y-4">
            <div className="w-12 h-12 rounded-full bg-warning-muted border border-warning flex items-center justify-center mx-auto text-warning">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-semibold text-fg-primary">Blog Model Not Found</h2>
            <p className="text-sm text-fg-secondary max-w-md mx-auto">
              The canonical <code className="text-primary">blog_post</code> content model has not yet
              been initialized in this workspace.
            </p>
            <Link
              href="/admin/models/new"
              className="ui-btn ui-btn-primary no-underline"
            >
              <Plus className="w-4 h-4" />
              Create Content Model
            </Link>
          </div>
        ) : (
          <BlogTable
            posts={posts}
            onRefresh={() => loadData(true)}
            onEdit={handleEdit}
            onDelete={handleDeletePost}
            onToggleArchive={handleToggleArchive}
            onToggleStatus={handleToggleStatus}
            canManage={canManage}
            isVisualEligible={isVisualEligible}
          />
        )}
      </div>

      <Toast />
    </AdminLayout>
  );
}
