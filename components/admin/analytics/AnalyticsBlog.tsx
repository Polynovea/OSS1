"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Ga4Range } from "@/lib/admin/ga4";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { fmtSeconds, fmtNum } from "./format";

interface BlogRow {
  path: string; slug: string; pageViews: number; avgEngagementTime: number; users: number;
  title: string; status: "draft" | "published" | null;
}

export default function AnalyticsBlog({ range }: { range: Ga4Range }) {
  const [posts, setPosts] = useState<BlogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAuthHeaders()
      .then((headers) => fetch(`/api/admin/analytics?section=blog&range=${range}`, { headers }))
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || "Failed to load blog analytics");
        setPosts(json.data.posts);
      })
      .catch((err) => { if (!cancelled) setError(err.message || "Failed to load blog analytics"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <div className="border border-subtle bg-surface-1/50 backdrop-blur-md rounded-xl overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[2.5fr_1fr_1fr_0.8fr_0.8fr] gap-4 px-5 py-3 border-b border-subtle bg-surface-1/50 text-[10px] font-bold text-fg-muted tracking-wider uppercase">
          <div>Post</div>
          <div className="text-right">Views</div>
          <div className="text-right">Avg. Engagement</div>
          <div className="text-right">Users</div>
          <div className="text-right">Status</div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-fg-muted"><Loader2 size={20} className="animate-spin mx-auto" /></div>
        ) : error ? (
          <div className="p-10 text-center text-danger text-sm">{error}</div>
        ) : posts.length === 0 ? (
          <div className="p-10 text-center text-fg-muted text-sm">No blog traffic for this period.</div>
        ) : posts.map((p) => (
          <div key={p.path} className="grid grid-cols-[2.5fr_1fr_1fr_0.8fr_0.8fr] gap-4 px-5 py-3.5 items-center border-b border-subtle last:border-0 hover:bg-surface-2 transition-colors">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold text-fg-primary truncate">{p.title}</span>
              <span className="text-xs text-fg-muted truncate">{p.path}</span>
            </div>
            <div className="text-sm font-bold text-fg-primary text-right">{fmtNum(p.pageViews)}</div>
            <div className="text-sm text-fg-secondary text-right">{fmtSeconds(p.avgEngagementTime)}</div>
            <div className="text-sm text-fg-secondary text-right">{fmtNum(p.users)}</div>
            <div className="text-right">
              {p.status ? (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                  p.status === "published" ? "bg-success-muted text-success border border-success" : "bg-warning-muted text-warning border border-warning"
                }`}>
                  {p.status}
                </span>
              ) : (
                <span className="text-[9px] text-fg-muted uppercase">unknown</span>
              )}
            </div>
          </div>
        ))}

        {!loading && !error && (
          <div className="px-5 py-2.5 border-t border-subtle text-[10px] text-fg-muted uppercase font-semibold tracking-wider bg-field">
            Showing {posts.length} post{posts.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
