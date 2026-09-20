"use client";

import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import type { BlogPost } from "@/lib/admin/types";
import { showToast } from "./Toast";
import { Save, AlertTriangle } from "lucide-react";
import MediaUpload from "./MediaUpload";
import BlockEditor from "./BlockEditor";
import BlogImport, { type BlogDraft } from "./BlogImport";
import { slugify } from "@/lib/admin/slugify";

const blogSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters").max(200),
  slug: z.string().min(1, "Slug is required").regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be URL-safe (lowercase, hyphens only)"),
  content: z.string().refine((val) => {
    try {
      const blocks = JSON.parse(val);
      return Array.isArray(blocks) && blocks.some((b) => b.body?.trim().length > 0);
    } catch {
      return typeof val === "string" && val.trim().length > 0;
    }
  }, "At least one block must have body text"),
  excerpt: z.string().min(20, "Excerpt must be at least 20 characters").max(500),
  author: z.string().min(2, "Author must be at least 2 characters").max(100),
  cover_image: z.string().nullable().optional(),
});

export type BlogFormData = z.infer<typeof blogSchema>;

interface BlogFormProps {
  post?: BlogPost | null;
  onSave: (data: BlogFormData, isPublishing: boolean, changeSummary?: string) => Promise<void>;
  onSuccess: () => void;
  onCancel: () => void;
}

const emptyForm: BlogFormData = {
  title: "",
  slug: "",
  content: "",
  excerpt: "",
  author: "",
  cover_image: null,
};

const AUTOSAVE_DEBOUNCE_MS = 800;

export default function BlogForm({ post, onSave, onSuccess, onCancel }: BlogFormProps) {
  const [form, setForm] = useState<BlogFormData>(emptyForm);
  const [changeSummary, setChangeSummary] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof BlogFormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [recoverable, setRecoverable] = useState<{ form: BlogFormData; changeSummary: string } | null>(null);
  const dirtyRef = useRef(false);

  const storageKey = post ? `polynovea:draft:blog:${post.id}` : "polynovea:draft:blog:new";

  useEffect(() => {
    if (post) {
      setForm({
        title: post.title,
        slug: post.slug,
        content: post.content,
        excerpt: post.excerpt,
        author: post.author,
        cover_image: post.cover_image ?? null,
      });
    } else {
      setForm(emptyForm);
    }
    setChangeSummary("");
    setErrors({});
  }, [post]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.form && JSON.stringify(parsed.form) !== JSON.stringify(form)) {
          setRecoverable(parsed);
        }
      }
    } catch {
      // localStorage unavailable or invalid JSON
    }
  }, [storageKey]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timeout = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ form, changeSummary }));
      } catch {
        // Storage full or unavailable
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [form, changeSummary, storageKey]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const updateField = <K extends keyof BlogFormData>(field: K, value: BlogFormData[K]) => {
    dirtyRef.current = true;
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "title" && !post && !prev.slug) {
        next.slug = slugify(value as string);
      }
      return next;
    });
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent, isPublishing = false) => {
    e.preventDefault();
    const result = blogSchema.safeParse(form);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof BlogFormData, string>> = {};
      result.error.errors.forEach((err) => {
        const key = err.path[0] as keyof BlogFormData;
        fieldErrors[key] = err.message;
      });
      setErrors(fieldErrors);
      showToast("Please fix the form errors.", "error");
      return;
    }

    setSubmitting(true);
    try {
      await onSave(result.data, isPublishing, changeSummary);
      dirtyRef.current = false;
      try { window.localStorage.removeItem(storageKey); } catch {}
      showToast(isPublishing ? "Post published." : post ? "Post saved." : "Draft saved.", "success");
      onSuccess();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Request failed", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublish = (e: React.MouseEvent) => {
    e.preventDefault();
    void handleSubmit(e as unknown as React.FormEvent, true);
  };

  const handleImport = (draft: BlogDraft) => {
    setForm((prev) => ({
      ...prev,
      title: draft.title,
      slug: draft.slug,
      excerpt: draft.excerpt,
      content: draft.content,
    }));
    setErrors({});
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6 w-full text-on-surface">
      {recoverable && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning bg-warning-muted px-4 py-3 text-xs text-amber-200">
          <span className="flex items-center gap-2">
            <AlertTriangle size={14} /> An unsaved draft from a previous session was found for this post.
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setForm(recoverable.form);
                if (recoverable.changeSummary) setChangeSummary(recoverable.changeSummary);
                dirtyRef.current = true;
                setRecoverable(null);
              }}
              className="rounded-md bg-warning-muted text-warning cursor-pointer"
            >
              Restore it
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  window.localStorage.removeItem(storageKey);
                } catch {}
                setRecoverable(null);
              }}
              className="rounded-md border border-warning px-2.5 py-1 font-bold uppercase tracking-wider text-warning cursor-pointer"
            >
              Discard
            </button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Import from file */}
        <BlogImport onImport={handleImport} />

        {/* Title */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-1">
            Title
          </label>
          <input
            value={form.title}
            onChange={(e) => updateField("title", e.target.value)}
            placeholder="Post title"
            className="w-full bg-surface border border-outline rounded-md px-3 py-2 text-on-surface font-body text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors outline-none placeholder:text-fg-muted"
          />
          {errors.title && <span className="text-danger text-[11px] mt-1 pl-1 font-body">{errors.title}</span>}
        </div>

        {/* Slug */}
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-1">
            Slug
          </label>
          <input
            value={form.slug}
            onChange={(e) => updateField("slug", e.target.value)}
            placeholder="url-friendly-slug"
            className="w-full bg-surface border border-outline rounded-md px-3 py-2 text-on-surface font-body text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors outline-none placeholder:text-fg-muted"
          />
          {errors.slug && <span className="text-danger text-[11px] mt-1 pl-1 font-body">{errors.slug}</span>}
        </div>

        {/* Author */}
        <div className="flex flex-col gap-1.5">
          <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-1">
            Author
          </label>
          <input
            value={form.author}
            onChange={(e) => updateField("author", e.target.value)}
            placeholder="Author name"
            className="w-full bg-surface border border-outline rounded-md px-3 py-2 text-on-surface font-body text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors outline-none placeholder:text-fg-muted"
          />
          {errors.author && <span className="text-danger text-[11px] mt-1 pl-1 font-body">{errors.author}</span>}
        </div>

        {/* Cover Image */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <MediaUpload
            label="Cover Image"
            value={form.cover_image ?? null}
            onChange={(url) => updateField("cover_image", url)}
            folder="blog"
            accept="image"
          />
        </div>

        {/* Excerpt */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-1">
            Excerpt
          </label>
          <textarea
            rows={3}
            value={form.excerpt}
            onChange={(e) => updateField("excerpt", e.target.value)}
            placeholder="Short summary for listings..."
            className="w-full bg-surface border border-outline rounded-md px-3 py-2 text-on-surface font-body text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors outline-none resize-none placeholder:text-fg-muted"
          />
          {errors.excerpt && <span className="text-danger text-[11px] mt-1 pl-1 font-body">{errors.excerpt}</span>}
        </div>

        {/* Content Blocks */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <BlockEditor
            value={form.content}
            onChange={(json) => updateField("content", json)}
            folder="blog"
          />
          {errors.content && <span className="text-danger text-[11px] mt-1 pl-1 font-body">{errors.content}</span>}
        </div>

        {/* Change summary */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-1">
            Change summary
          </label>
          <input
            value={changeSummary}
            onChange={(e) => {
              dirtyRef.current = true;
              setChangeSummary(e.target.value);
            }}
            placeholder="Describe this revision (e.g. 'Updated introduction and SEO tags')"
            className="w-full bg-surface border border-outline rounded-md px-3 py-2 text-on-surface font-body text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors outline-none placeholder:text-fg-muted"
          />
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant/30 mt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-md font-body text-xs font-semibold text-on-surface-variant hover:bg-surface-variant transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-2 rounded-md border border-outline bg-transparent hover:bg-surface-variant text-on-surface-variant font-body text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-4 h-4" />
          <span>{submitting ? "Saving..." : "SAVE DRAFT"}</span>
        </button>
        {post?.status !== "published" && (
          <button
            type="button"
            onClick={handlePublish}
            disabled={submitting}
            className="px-6 py-2 rounded-md bg-primary hover:bg-action text-on-primary font-body text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer shadow-[0_0_15px_rgba(230,211,163,0.15)] flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            <span>{submitting ? "Publishing..." : "PUBLISH"}</span>
          </button>
        )}
      </div>
    </form>
  );
}
