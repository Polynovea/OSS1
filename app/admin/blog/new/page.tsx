"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import BlogForm, { type BlogFormData } from "@/components/admin/BlogForm";
import Toast, { showToast } from "@/components/admin/Toast";
import { ArrowLeft, BookOpen, AlertCircle, RefreshCw } from "lucide-react";
import { useAdminAccess } from "@/lib/admin/useAdminAccess";
import { hasModuleWriteAccess } from "@/lib/admin/access";
import { getAuthHeaders } from "@/lib/admin/authCheck";

interface ContentModel {
  id: string;
  name: string;
  api_key: string;
}

export default function NewBlogPostPage() {
  const router = useRouter();
  const { profile } = useAdminAccess();
  const [blogModel, setBlogModel] = useState<ContentModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canManage = hasModuleWriteAccess(profile, "cms.blog");

  useEffect(() => {
    async function loadModel() {
      try {
        setLoading(true);
        const headers = await getAuthHeaders();
        const res = await fetch("/api/models", { headers });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "Failed to load models");
        const found = (json.data as ContentModel[]).find(
          (m) => m.api_key === "blog_post" || m.name.toLowerCase().includes("blog")
        );
        if (!found) throw new Error("Canonical blog_post model not found in this workspace");
        setBlogModel(found);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load blog model");
      } finally {
        setLoading(false);
      }
    }
    loadModel();
  }, []);

  const handleSavePost = async (formData: BlogFormData, isPublishing: boolean, changeSummary?: string) => {
    if (!blogModel) throw new Error("Blog model not initialized");

    const postData = {
      title: formData.title.trim(),
      slug: formData.slug.trim(),
      excerpt: formData.excerpt.trim(),
      body: formData.content, // legacy ContentBlock[] JSON string
      author: formData.author.trim(),
      cover_image: formData.cover_image || null,
      published_at: isPublishing ? new Date().toISOString() : null,
    };

    const headers = await getAuthHeaders();
    const res = await fetch("/api/entries", {
      method: "POST",
      headers,
      body: JSON.stringify({
        modelId: blogModel.id,
        data: postData,
        changeSummary: changeSummary?.trim() || (isPublishing ? "Published blog post" : "Initial draft"),
      }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || "Failed to create blog post");
    }

    const newEntryId = json.data?.entry?.id || json.data?.id;
    if (isPublishing && newEntryId) {
      const pubRes = await fetch(`/api/entries/${newEntryId}/publish`, {
        method: "POST",
        headers,
      });
      const pubJson = await pubRes.json();
      if (!pubRes.ok || !pubJson.success) {
        throw new Error(pubJson.error || "Failed to publish blog post");
      }
    }
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-outline-variant pb-5">
          <Link
            href="/admin/blog"
            className="p-2.5 rounded-xl border border-subtle bg-surface-2 text-fg-secondary hover:text-on-surface hover:border-default transition-all cursor-pointer"
            title="Back to Blog Management"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Content Publishing Hub / New
            </p>
            <h1 className="mt-1 font-headline font-extrabold text-2xl md:text-3xl text-on-surface tracking-tight">
              NEW BLOG POST
            </h1>
          </div>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 bg-surface-1 border border-subtle rounded-2xl gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            <p className="font-body text-xs text-fg-muted uppercase tracking-wider">
              Initializing blog composer...
            </p>
          </div>
        ) : error ? (
          <div className="p-6 rounded-2xl bg-danger-muted border border-danger text-danger flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-danger shrink-0" />
            <p className="text-sm font-body">{error}</p>
          </div>
        ) : !canManage ? (
          <div className="p-8 text-center rounded-2xl bg-surface-1/30 border border-subtle text-fg-secondary">
            You do not have write permissions for blog publications.
          </div>
        ) : (
          <div className="bg-surface-1 border border-subtle rounded-2xl p-6 md:p-8 backdrop-blur-xl shadow-2xl">
            <BlogForm
              post={null}
              onSave={handleSavePost}
              onSuccess={() => {
                showToast("Post created successfully.", "success");
                router.push("/admin/blog");
              }}
              onCancel={() => router.push("/admin/blog")}
            />
          </div>
        )}
      </div>

      <Toast />
    </AdminLayout>
  );
}
