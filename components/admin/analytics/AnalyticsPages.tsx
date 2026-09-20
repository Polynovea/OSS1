"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Ga4Range } from "@/lib/admin/ga4";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { fmtSeconds, fmtNum } from "./format";

interface PageRow { path: string; title: string; pageViews: number; avgEngagementTime: number; users: number; }

export default function AnalyticsPages({ range }: { range: Ga4Range }) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAuthHeaders()
      .then((headers) => fetch(`/api/admin/analytics?section=pages&range=${range}`, { headers }))
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || "Failed to load pages");
        setPages(json.data.pages);
      })
      .catch((err) => { if (!cancelled) setError(err.message || "Failed to load pages"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  return (
    <div className="border border-subtle bg-surface-1/50 backdrop-blur-md rounded-xl overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[2.5fr_1fr_1fr_0.8fr] gap-4 px-5 py-3 border-b border-subtle bg-surface-1/50 text-[10px] font-bold text-fg-muted tracking-wider uppercase">
          <div>Page</div>
          <div className="text-right">Views</div>
          <div className="text-right">Avg. Engagement</div>
          <div className="text-right">Users</div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-fg-muted"><Loader2 size={20} className="animate-spin mx-auto" /></div>
        ) : error ? (
          <div className="p-10 text-center text-danger text-sm">{error}</div>
        ) : pages.length === 0 ? (
          <div className="p-10 text-center text-fg-muted text-sm">No page data for this period.</div>
        ) : pages.map((p) => (
          <div key={p.path} className="grid grid-cols-[2.5fr_1fr_1fr_0.8fr] gap-4 px-5 py-3.5 items-center border-b border-subtle last:border-0 hover:bg-surface-2 transition-colors">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold text-fg-primary truncate">{p.title || p.path}</span>
              <span className="text-xs text-fg-muted truncate">{p.path}</span>
            </div>
            <div className="text-sm font-bold text-fg-primary text-right">{fmtNum(p.pageViews)}</div>
            <div className="text-sm text-fg-secondary text-right">{fmtSeconds(p.avgEngagementTime)}</div>
            <div className="text-sm text-fg-secondary text-right">{fmtNum(p.users)}</div>
          </div>
        ))}

        {!loading && !error && (
          <div className="px-5 py-2.5 border-t border-subtle text-[10px] text-fg-muted uppercase font-semibold tracking-wider bg-field">
            Showing {pages.length} page{pages.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
