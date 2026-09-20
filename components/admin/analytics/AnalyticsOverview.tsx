"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import { Loader2 } from "lucide-react";
import type { Ga4Range } from "@/lib/admin/ga4";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { fmtSeconds, fmtPct, fmtNum, fmtGa4Date } from "./format";

interface Totals {
  activeUsers: number; newUsers: number; sessions: number; pageViews: number;
  engagementRate: number; avgSessionDuration: number; bounceRate: number;
}
interface TrendPoint { date: string; activeUsers: number; sessions: number; pageViews: number; }
interface SourceRow { channel: string; sessions: number; users: number; }
interface DeviceRow { device: string; users: number; sessions: number; }

const DEVICE_COLORS: Record<string, string> = {
  desktop: "var(--chart-1)", mobile: "var(--chart-3)", tablet: "var(--chart-2)",
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-subtle pr-5 last:border-r-0">
      <span className="text-[11px] font-medium text-fg-muted">{label}</span>
      <span className="mt-2 block font-headline text-2xl font-semibold tracking-tight text-fg-primary md:text-3xl">{value}</span>
    </div>
  );
}

export default function AnalyticsOverview({ range }: { range: Ga4Range }) {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAuthHeaders()
      .then((headers) => fetch(`/api/admin/analytics?section=overview&range=${range}`, { headers }))
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error || "Failed to load analytics");
        setTotals(json.data.totals);
        setTrend(json.data.trend);
        setSources(json.data.sources);
        setDevices(json.data.devices);
      })
      .catch((err) => { if (!cancelled) setError(err.message || "Failed to load analytics"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-fg-muted">
        <Loader2 size={22} className="animate-spin" />
        <span className="text-xs font-semibold tracking-wider uppercase">Loading GA4 data...</span>
      </div>
    );
  }

  if (error || !totals) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-danger">
        <p className="text-sm">{error || "No data"}</p>
      </div>
    );
  }

  const deviceTotal = devices.reduce((s, d) => s + d.sessions, 0) || 1;

  return (
    <div className="flex flex-col gap-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-6 border-y border-subtle py-6 md:grid-cols-4">
        <StatCard label="Active Users" value={fmtNum(totals.activeUsers)} />
        <StatCard label="New Users" value={fmtNum(totals.newUsers)} />
        <StatCard label="Sessions" value={fmtNum(totals.sessions)} />
        <StatCard label="Page Views" value={fmtNum(totals.pageViews)} />
        <StatCard label="Engagement Rate" value={fmtPct(totals.engagementRate)} />
        <StatCard label="Avg. Engagement Time" value={fmtSeconds(totals.avgSessionDuration)} />
        <StatCard label="Bounce Rate" value={fmtPct(totals.bounceRate)} />
      </div>

      {/* Trend chart */}
      <section className="border-t border-subtle pt-5">
        <h3 className="mb-4 text-[13px] font-semibold text-fg-primary">Traffic Trend</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={trend}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
            <XAxis dataKey="date" tickFormatter={fmtGa4Date} tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
            <Tooltip
              labelFormatter={(label) => fmtGa4Date(String(label))}
              contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderRadius: 8, color: "var(--text-primary)", fontSize: 12 }}
            />
            <Line type="monotone" dataKey="activeUsers" name="Users" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="sessions" name="Sessions" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="pageViews" name="Page Views" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <div className="grid grid-cols-1 gap-8 border-t border-subtle pt-6 md:grid-cols-2">
        {/* Traffic sources */}
        <section className="border-t border-subtle pt-5">
          <h3 className="mb-4 text-[13px] font-semibold text-fg-primary">Traffic Sources</h3>
          <div className="flex flex-col gap-2.5">
            {sources.length === 0 ? (
              <p className="text-xs text-fg-muted text-center py-6">No data for this period.</p>
            ) : sources.map((s) => {
              const maxSessions = Math.max(...sources.map((x) => x.sessions), 1);
              return (
                <div key={s.channel} className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-fg-secondary font-medium">{s.channel}</span>
                    <span className="text-fg-muted">{fmtNum(s.sessions)} sessions</span>
                  </div>
                  <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
                    <div className="h-full bg-action rounded-full" style={{ width: `${(s.sessions / maxSessions) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Device breakdown */}
        <section className="border-t border-subtle pt-5">
          <h3 className="mb-4 text-[13px] font-semibold text-fg-primary">Devices</h3>
          {devices.length === 0 ? (
            <p className="text-xs text-fg-muted text-center py-6">No data for this period.</p>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={160}>
                <PieChart>
                  <Pie data={devices} dataKey="sessions" nameKey="device" innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {devices.map((d) => (
                      <Cell key={d.device} fill={DEVICE_COLORS[d.device] || "var(--chart-8)"} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderRadius: 8, color: "var(--text-primary)", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2 flex-1">
                {devices.map((d) => (
                  <div key={d.device} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DEVICE_COLORS[d.device] || "var(--chart-8)" }} />
                    <span className="text-fg-secondary capitalize flex-1">{d.device}</span>
                    <span className="text-fg-muted">{Math.round((d.sessions / deviceTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
