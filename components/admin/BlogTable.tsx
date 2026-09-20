"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ChevronUp,
  ChevronDown,
  Edit,
  Trash2,
  Sparkles,
  Archive,
  ArchiveRestore,
  Search,
} from "lucide-react";
import type { BlogPost } from "@/lib/admin/types";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { showToast } from "./Toast";
import ConfirmDialog from "./ConfirmDialog";

interface BlogTableProps {
  posts: BlogPost[];
  onRefresh: () => void;
  onEdit: (post: BlogPost) => void;
  onDelete?: (post: BlogPost) => void;
  onToggleArchive?: (post: BlogPost) => void;
  onToggleStatus?: (post: BlogPost) => void;
  canManage?: boolean;
  isVisualEligible?: boolean;
}

export default function BlogTable({
  posts,
  onRefresh,
  onEdit,
  onDelete,
  onToggleArchive,
  onToggleStatus,
  canManage = true,
  isVisualEligible = false,
}: BlogTableProps) {
  const [sortKey, setSortKey] = useState<keyof BlogPost>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [deletePost, setDeletePost] = useState<BlogPost | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filteredAndSorted = useMemo(() => {
    let data = [...posts];
    if (filterStatus) data = data.filter((p) => p.status === filterStatus);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
      );
    }
    data.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv !== null) return sortDir === "asc" ? -1 : 1;
      if (bv === null && av !== null) return sortDir === "asc" ? 1 : -1;
      if (av === null && bv === null) return 0;
      if (av! < bv!) return sortDir === "asc" ? -1 : 1;
      if (av! > bv!) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return data;
  }, [posts, sortKey, sortDir, filterStatus, searchQuery]);

  const toggleSort = (key: keyof BlogPost) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const handleDelete = async () => {
    if (!deletePost) return;
    setDeleting(true);
    try {
      if (onDelete) {
        await onDelete(deletePost);
      } else {
        const res = await fetch(`/api/content/blog-posts/${deletePost.id}`, {
          method: "DELETE",
          headers: await getAuthHeaders(),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || "Delete failed");
        showToast("Post deleted.", "success");
        onRefresh();
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed", "error");
    } finally {
      setDeleting(false);
      setDeletePost(null);
    }
  };

  const toggleStatus = async (post: BlogPost) => {
    if (onToggleStatus) {
      onToggleStatus(post);
      return;
    }
    const newStatus = post.status === "draft" ? "published" : "draft";
    try {
      const body: Record<string, unknown> = { status: newStatus };
      if (newStatus === "published" && !post.published_at) {
        body.published_at = new Date().toISOString();
      }
      const res = await fetch(`/api/content/blog-posts/${post.id}`, {
        method: "PUT",
        headers: await getAuthHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Update failed");
      showToast(`Status changed to ${newStatus}.`, "success");
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Update failed", "error");
    }
  };

  const SortIcon = ({ col }: { col: keyof BlogPost }) => {
    if (sortKey !== col) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="w-3.5 h-3.5 text-primary inline ml-1" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-primary inline ml-1" />
    );
  };

  const renderStatusBadge = (post: BlogPost) => {
    let badgeClass = "bg-warning-muted border-warning text-warning hover:bg-warning-muted";
    let dotClass = "bg-warning-muted";
    let label = post.status.toUpperCase();

    switch (post.status) {
      case "published":
        badgeClass = "bg-success-muted border-success text-success hover:bg-success-muted";
        dotClass = "bg-success-muted";
        label = "PUBLISHED";
        break;
      case "in_review":
        badgeClass = "bg-info-muted border-info text-info hover:bg-info-muted";
        dotClass = "bg-info-muted";
        label = "IN REVIEW";
        break;
      case "approved":
        badgeClass = "bg-indigo-500/10 border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20";
        dotClass = "bg-indigo-400";
        label = "APPROVED";
        break;
      case "archived":
        badgeClass = "bg-zinc-850 border-default text-fg-secondary hover:bg-surface-2";
        dotClass = "bg-zinc-500";
        label = "ARCHIVED";
        break;
      default:
        badgeClass = "bg-warning-muted border-warning text-warning hover:bg-warning-muted";
        dotClass = "bg-warning-muted";
        label = "DRAFT";
    }

    return (
      <button
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold border cursor-pointer transition-all duration-150 select-none ${badgeClass} disabled:cursor-not-allowed disabled:opacity-50`}
        onClick={(e) => {
          e.stopPropagation();
          if (!canManage) return;
          toggleStatus(post);
        }}
        disabled={!canManage}
        title="Click to toggle status"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      {/* Controls: Search and Filter Pills */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-fg-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search blog posts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-surface-2 border border-subtle rounded-xl text-xs text-on-surface placeholder:text-fg-muted focus:outline-none focus:border-primary/55 focus:ring-1 focus:ring-primary/20 transition-all"
          />
        </div>

        {/* Status Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { label: "ALL", value: "" },
            { label: "PUBLISHED", value: "published" },
            { label: "DRAFT", value: "draft" },
            { label: "IN REVIEW", value: "in_review" },
            { label: "APPROVED", value: "approved" },
            { label: "ARCHIVED", value: "archived" },
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilterStatus(tab.value)}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-semibold tracking-wider uppercase transition-colors whitespace-nowrap cursor-pointer ${
                filterStatus === tab.value
                  ? "bg-primary text-background shadow-[0_0_12px_rgba(230,211,163,0.25)]"
                  : "bg-surface-2 border border-subtle text-fg-secondary hover:text-on-surface hover:border-default"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid Table Container */}
      <div className="bg-surface-1 border border-[rgba(255,255,255,0.08)] rounded-[14px] backdrop-blur-[24px] overflow-x-auto flex flex-col shadow-2xl">
        <div className="min-w-[800px]">
          {/* Table Header Row */}
          <div className="bg-surface-2 min-h-[52px] px-8 py-0 border-b border-[rgba(255,255,255,0.05)] grid grid-cols-12 gap-4 items-center font-body text-[11px] font-semibold leading-none text-fg-muted uppercase tracking-[0.12em] select-none">
            <div
              className="col-span-4 cursor-pointer hover:text-on-surface transition-colors flex items-center"
              onClick={() => toggleSort("title")}
            >
              TITLE <SortIcon col="title" />
            </div>
            <div
              className="col-span-2 cursor-pointer hover:text-on-surface transition-colors flex items-center"
              onClick={() => toggleSort("author")}
            >
              AUTHOR <SortIcon col="author" />
            </div>
            <div
              className="col-span-2 cursor-pointer hover:text-on-surface transition-colors flex items-center"
              onClick={() => toggleSort("status")}
            >
              STATUS <SortIcon col="status" />
            </div>
            <div
              className="col-span-2 cursor-pointer hover:text-on-surface transition-colors flex items-center"
              onClick={() => toggleSort("published_at")}
            >
              PUBLISHED <SortIcon col="published_at" />
            </div>
            <div className="col-span-2 text-right pr-2">ACTIONS</div>
          </div>

          {/* Table Body Rows */}
          <div className="flex flex-col divide-y divide-[rgba(255,255,255,0.03)]">
            {filteredAndSorted.map((post) => (
              <div
                key={post.id}
                onClick={() => {
                  if (canManage) onEdit(post);
                }}
                className="group px-8 py-4.5 grid grid-cols-12 gap-4 items-center hover:bg-surface-2 transition-colors duration-150 relative cursor-pointer"
              >
                {/* Hover Left Indicator Overlay */}
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

                <div className="col-span-4 pr-4">
                  <Link
                    href={`/admin/blog/${post.id}`}
                    className="font-body font-semibold text-[13.5px] text-on-surface truncate group-hover:text-primary transition-colors leading-snug block no-underline"
                  >
                    {post.title}
                  </Link>
                  <div className="text-[11px] text-fg-muted font-mono mt-0.5 truncate">
                    {post.slug ? `/${post.slug}` : post.id.slice(0, 8)}
                  </div>
                </div>
                <div className="col-span-2 font-body font-normal text-[13px] text-on-surface-variant truncate pr-4">
                  {post.author || "Polynovea Team"}
                </div>
                <div className="col-span-2">{renderStatusBadge(post)}</div>
                <div className="col-span-2 font-body font-normal text-[13px] text-on-surface-variant tabular-nums">
                  {post.published_at
                    ? new Date(post.published_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </div>
                <div
                  className={`col-span-2 flex justify-end items-center gap-1.5 transition-opacity duration-200 ${
                    canManage ? "opacity-90 group-hover:opacity-100" : "opacity-40"
                  }`}
                >
                  <Link
                    href={`/admin/blog/${post.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 rounded-lg text-fg-secondary hover:text-primary hover:bg-surface-2 transition-colors cursor-pointer"
                    title="Edit Blog Post"
                  >
                    <Edit className="w-4 h-4" />
                  </Link>
                  {isVisualEligible && (
                    <Link
                      href={`/admin/blog/${post.id}/experience`}
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg text-fg-secondary hover:text-review hover:bg-surface-2 transition-colors cursor-pointer"
                      title="Visual Experience Studio"
                    >
                      <Sparkles className="w-4 h-4" />
                    </Link>
                  )}
                  {onToggleArchive && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canManage) return;
                        onToggleArchive(post);
                      }}
                      disabled={!canManage}
                      className="p-1.5 rounded-lg text-fg-secondary hover:text-warning hover:bg-surface-2 transition-colors cursor-pointer disabled:cursor-not-allowed"
                      title={post.status === "archived" ? "Restore from archive" : "Archive Post"}
                    >
                      {post.status === "archived" ? (
                        <ArchiveRestore className="w-4 h-4 text-success" />
                      ) : (
                        <Archive className="w-4 h-4" />
                      )}
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canManage) return;
                      setDeletePost(post);
                    }}
                    disabled={!canManage}
                    className="p-1.5 rounded-lg text-fg-secondary hover:text-danger hover:bg-surface-2 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:hover:text-fg-muted"
                    title="Delete / Archive Post"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {filteredAndSorted.length === 0 && (
              <div className="flex min-h-[220px] flex-col items-center justify-center px-8 text-center font-body">
                <p className="text-fg-muted text-xs uppercase tracking-widest mb-1">
                  {searchQuery || filterStatus ? "No matching posts found" : "No posts yet"}
                </p>
                <p className="text-fg-muted text-xs">
                  {searchQuery || filterStatus
                    ? "Try adjusting your search query or filter"
                    : "Click \"+ New Post\" to create your first article"}
                </p>
              </div>
            )}
          </div>

          {/* Table Footer */}
          <div className="bg-surface-2 px-8 py-4 border-t border-[rgba(255,255,255,0.05)] flex justify-between items-center text-xs text-fg-muted font-body">
            <span>
              Showing {filteredAndSorted.length} of {posts.length} posts
            </span>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!deletePost}
        onClose={() => setDeletePost(null)}
        onConfirm={handleDelete}
        title="Archive Post"
        message={`Are you sure you want to archive "${deletePost?.title}"? It can be restored later.`}
        confirmText={deleting ? "Archiving..." : "Archive"}
      />
    </div>
  );
}
