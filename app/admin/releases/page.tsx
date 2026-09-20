"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import ReleasePreviewButton from "@/components/admin/ReleasePreviewButton";
import { ArrowRight, CalendarClock, Loader2, Plus, Rocket } from "lucide-react";

type Release = { id: string; name: string; description: string | null; status: string; created_at: string; scheduled_for: string | null; published_at: string | null; release_items: unknown[]; release_locale_targets?: Array<{ locale: string; required: boolean }> };

function statusBadge(status: string) {
  if (["published", "approved"].includes(status)) return "ui-badge ui-badge-success";
  if (["partially_failed"].includes(status)) return "ui-badge ui-badge-danger";
  if (["publishing", "scheduled"].includes(status)) return "ui-badge ui-badge-warning";
  if (["cancelled"].includes(status)) return "ui-badge ui-badge-pending";
  return "ui-badge ui-badge-review";
}

export default function ReleasesPage() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/releases");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load releases");
      setReleases(body.data || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load releases");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        <header className="ui-page-header">
          <div>
            <p className="ui-eyebrow">Publishing control plane</p>
            <h1 className="ui-page-title">Releases</h1>
            <p className="ui-page-description">Controlled bundles of approved, pinned entry versions with readiness, scheduling, locale coordination and rollback evidence.</p>
          </div>
          <Link href="/admin/releases/new" className="ui-btn ui-btn-primary no-underline"><Plus size={14} />New release</Link>
        </header>

        {error ? <div className="ui-alert ui-alert-danger mt-5">{error}</div> : null}

        <section className="ui-section">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div><h2 className="ui-section-title">Release queue</h2><p className="ui-section-description">A release is a governed version bundle, not simply a publish button.</p></div>
            <span className="text-[12px] text-fg-muted">{releases.length} total</span>
          </div>

          {loading ? (
            <div className="flex min-h-52 items-center justify-center text-fg-muted"><Loader2 className="animate-spin" /></div>
          ) : releases.length === 0 ? (
            <div className="ui-empty rounded-xl bg-surface-1"><Rocket size={24} className="mx-auto text-icon-muted" /><p className="ui-empty-title mt-3">No release is in flight</p><p className="ui-empty-copy">Create a release from approved entry versions when content is ready to move together.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="ui-table min-w-[820px]">
                <thead><tr><th className="pr-5">Release</th><th className="px-5">Bundle</th><th className="px-5">Schedule</th><th className="px-5">State</th><th className="px-5">Preview</th><th className="pl-5 text-right">Open</th></tr></thead>
                <tbody>
                  {releases.map((release) => (
                    <tr key={release.id}>
                      <td className="pr-5"><Link href={`/admin/releases/${release.id}`} className="font-semibold text-fg-primary no-underline hover:text-link">{release.name}</Link>{release.description ? <p className="mt-1 max-w-xl truncate text-[12px] text-fg-muted">{release.description}</p> : null}</td>
                      <td className="px-5 text-[12px] text-fg-secondary">{release.release_items.length} item{release.release_items.length === 1 ? "" : "s"}<div className="mt-1 text-[11px] text-fg-muted">{release.release_locale_targets?.length || 0} locale target{release.release_locale_targets?.length === 1 ? "" : "s"}</div></td>
                      <td className="px-5 text-[12px] text-fg-muted">{release.scheduled_for ? <span className="inline-flex items-center gap-1.5"><CalendarClock size={12} />{new Date(release.scheduled_for).toLocaleString()}</span> : "—"}</td>
                      <td className="px-5"><span className={statusBadge(release.status)}>{release.status.replaceAll("_", " ")}</span></td>
                      <td className="px-5"><ReleasePreviewButton releaseId={release.id} /></td>
                      <td className="pl-5 text-right"><Link href={`/admin/releases/${release.id}`} aria-label={`Open ${release.name}`} className="inline-flex rounded-lg p-2 text-icon-muted hover:bg-surface-2 hover:text-link"><ArrowRight size={14} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
