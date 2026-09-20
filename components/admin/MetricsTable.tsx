"use client";

import type { LiveMetric } from "@/lib/admin/types";

interface MetricsTableProps {
  metrics: LiveMetric[];
}

export default function MetricsTable({ metrics }: MetricsTableProps) {
  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="bg-surface-1 border border-[rgba(255,255,255,0.08)] rounded-[14px] backdrop-blur-[24px] overflow-x-auto flex flex-col shadow-2xl">
        <div className="min-w-[640px] w-full flex flex-col">
          <div className="bg-surface-2 min-h-[52px] px-8 py-0 border-b border-[rgba(255,255,255,0.05)] grid grid-cols-12 gap-4 items-center font-body text-[11px] font-semibold leading-none text-fg-muted uppercase tracking-[0.12em] select-none">
            <div className="col-span-4">LABEL</div>
            <div className="col-span-2">VALUE</div>
            <div className="col-span-2">PERIOD</div>
            <div className="col-span-2">TREND</div>
            <div className="col-span-2 text-right">DIRECTION</div>
          </div>

          <div className="flex flex-col divide-y divide-[rgba(255,255,255,0.03)]">
            {metrics.map((metric) => (
              <div
                key={metric.id}
                className="group px-8 py-5 grid grid-cols-12 gap-4 items-center hover:bg-surface-2 transition-colors duration-150 relative"
              >
                <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>

                <div className="col-span-4 font-body font-semibold text-sm text-on-surface truncate pr-4">
                  {metric.label}
                </div>
                <div className="col-span-2 font-mono font-bold text-sm text-primary">
                  {metric.value}
                </div>
                <div className="col-span-2 font-body font-normal text-sm text-on-surface-variant">
                  {metric.period}
                </div>
                <div
                  className={`col-span-2 font-body font-semibold text-sm ${
                    metric.trendDirection === "up" ? "text-success" : "text-danger"
                  }`}
                >
                  {metric.trend}
                </div>
                <div className="col-span-2 flex justify-end">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                      metric.trendDirection === "up"
                        ? "bg-success-muted border border-success text-success"
                        : "bg-danger-muted border border-danger text-danger"
                    }`}
                  >
                    {metric.trendDirection === "up" ? "UP" : "DOWN"}
                  </span>
                </div>
              </div>
            ))}

            {metrics.length === 0 && (
              <div className="flex min-h-[220px] flex-col items-center justify-center px-8 text-center font-body">
                <p className="text-fg-muted text-xs uppercase tracking-widest mb-1">No metrics yet</p>
                <p className="text-fg-muted text-xs">Click &ldquo;Edit Metrics&rdquo; to enter your live numbers</p>
              </div>
            )}
          </div>

          <div className="bg-surface-2 px-8 py-4 border-t border-[rgba(255,255,255,0.05)] flex justify-between items-center text-xs text-fg-muted font-body">
            <span>Showing {metrics.length} metrics</span>
          </div>
        </div>
      </div>
    </div>
  );
}
