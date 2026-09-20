"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePolling } from "@/lib/admin/usePolling";
import AdminLayout from "@/components/admin/AdminLayout";
import MetricsTable from "@/components/admin/MetricsTable";
import MetricsForm from "@/components/admin/MetricsForm";
import Toast from "@/components/admin/Toast";
import AnalyticsOverview from "@/components/admin/analytics/AnalyticsOverview";
import AnalyticsPages from "@/components/admin/analytics/AnalyticsPages";
import AnalyticsBlog from "@/components/admin/analytics/AnalyticsBlog";
import RangeSelector from "@/components/admin/analytics/RangeSelector";
import { hasModuleWriteAccess } from "@/lib/admin/access";
import { useAdminAccess } from "@/lib/admin/useAdminAccess";
import type { LiveMetric } from "@/lib/admin/types";
import type { Ga4Range } from "@/lib/admin/ga4";

const TABS = [
  { key: "manage", label: "Manage" },
  { key: "overview", label: "Overview" },
  { key: "pages", label: "Pages" },
  { key: "blog", label: "Blog" },
] as const;
type TabKey = typeof TABS[number]["key"];

export default function MetricsPage() {
  const { profile } = useAdminAccess();
  const [tab, setTab] = useState<TabKey>("manage");
  const [range, setRange] = useState<Ga4Range>("28d");

  const [metrics, setMetrics] = useState<LiveMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const initialLoadStarted = useRef(false);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/content/live-metrics");
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const json = await res.json();
      setMetrics(json.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const silentRefresh = useCallback(async () => {
    try {
      const res = await fetch("/api/content/live-metrics");
      if (!res.ok) throw new Error("Could not refresh metrics");
      const json = await res.json();
      if (json.data) setMetrics(json.data);
    } catch (error) { throw error; }
  }, []);

  useEffect(() => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    void fetchMetrics();
  }, [fetchMetrics]);
  usePolling(silentRefresh);

  const handleSuccess = () => {
    setEditing(false);
    fetchMetrics();
  };

  const canManage = hasModuleWriteAccess(profile, "cms.metrics");

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        <div className="ui-page-header">
          <div>
            <h1 className="ui-page-title">
              METRICS
            </h1>
            <p className="ui-page-description">Manual indicators, plus live GA4 analytics for the site and blog.</p>
          </div>
          {tab === "manage" && (
            <button
              className="ui-btn ui-btn-primary"
              onClick={() => canManage && setEditing(!editing)}
              disabled={!canManage}
            >
              {editing ? "Cancel" : "Edit Metrics"}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-subtle pb-4">
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`ui-btn min-h-0 px-3 py-2 text-[10px] uppercase tracking-wider border ${
                  tab === t.key
                    ? "border-primary/30 bg-surface-2 text-primary"
                    : "border-transparent bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg-secondary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab !== "manage" && <RangeSelector value={range} onChange={setRange} />}
        </div>

        {tab === "manage" && (
          loading ? (
            <div className="ui-empty">
              <div className="w-7 h-7 border-2 border-subtle border-t-primary rounded-full animate-spin" />
              <span className="font-body text-xs font-semibold tracking-wider uppercase">Loading metrics...</span>
            </div>
          ) : error ? (
            <div className="ui-alert ui-alert-danger mt-5 text-center">
              <p className="font-body text-sm">{error}</p>
              <button
                className="ui-btn ui-btn-secondary mt-3"
                onClick={fetchMetrics}
              >
                Retry
              </button>
            </div>
          ) : editing && canManage ? (
            <MetricsForm metrics={metrics} onSuccess={handleSuccess} />
          ) : (
            <MetricsTable metrics={metrics} />
          )
        )}

        {tab === "overview" && <AnalyticsOverview range={range} />}
        {tab === "pages" && <AnalyticsPages range={range} />}
        {tab === "blog" && <AnalyticsBlog range={range} />}
      </div>
      <Toast />
    </AdminLayout>
  );
}
