"use client";

import { useCallback, useEffect, useState } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { AlertTriangle, Bot, CheckCircle2, Network, RefreshCw, Route as RouteIcon, Save, SearchCheck, ShieldCheck } from "lucide-react";

type Policy = { site_base_url: string | null; site_name: string | null; title_suffix: string | null; robots_enabled: boolean; sitemap_enabled: boolean; require_canonical_route: boolean; require_social_card: boolean; require_schema_org: boolean; ai_crawler_policy: Record<string, unknown>; media_budget_json: Record<string, unknown>; settings_json: Record<string, unknown> };
type Audit = { status: "ready" | "attention"; summary: { blocking: number; warnings: number; info: number; routes: number; indexedRoutes: number }; findings: Array<{ code: string; severity: string; message: string; path?: string; locale?: string; recommendedAction?: string }>; toolingBoundary: string };
type RouteRow = { id: string; path: string; locale: string; title: string | null; is_canonical: boolean; status: string; indexing_policy: "inherit" | "index" | "noindex"; sitemap_included: boolean; sitemap_priority: number | null; sitemap_changefreq: string | null };
type SitemapData = { entries: Array<{ url: string; locale: string; alternates: Array<{ locale: string; url: string }> }> };

const defaults = { siteBaseUrl: "", siteName: "", titleSuffix: "", robotsEnabled: true, sitemapEnabled: true, requireCanonicalRoute: true, requireSocialCard: false, requireSchemaOrg: false, aiDefault: "allow", gptbot: "allow", googleExtended: "allow", claudeBot: "allow", maxImageBytes: 2097152, lcpWarningBytes: 786432, minLcpWidth: 1200 };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[12px] font-medium text-fg-secondary">{label}</span>{children}</label>;
}

export default function AssurancePage() {
  const [form, setForm] = useState(defaults);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [robots, setRobots] = useState("");
  const [sitemap, setSitemap] = useState<SitemapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [policyResponse, auditResponse, routesResponse, robotsResponse, sitemapResponse] = await Promise.all([
        fetch("/api/web-quality"), fetch("/api/web-quality/audit"), fetch("/api/routes"), fetch("/api/web-quality/robots"), fetch("/api/web-quality/sitemap"),
      ]);
      const [policyBody, auditBody, routesBody, robotsBody, sitemapBody] = await Promise.all([
        policyResponse.json(), auditResponse.json(), routesResponse.json(), robotsResponse.json(), sitemapResponse.json(),
      ]);
      if (!policyResponse.ok) throw new Error(policyBody.error);
      if (!auditResponse.ok) throw new Error(auditBody.error);
      if (!routesResponse.ok) throw new Error(routesBody.error);
      const policy: Policy = policyBody.data;
      const crawler = policy.ai_crawler_policy || {};
      const media = policy.media_budget_json || {};
      setForm({
        siteBaseUrl: policy.site_base_url || "", siteName: policy.site_name || "", titleSuffix: policy.title_suffix || "",
        robotsEnabled: policy.robots_enabled, sitemapEnabled: policy.sitemap_enabled, requireCanonicalRoute: policy.require_canonical_route,
        requireSocialCard: policy.require_social_card, requireSchemaOrg: policy.require_schema_org,
        aiDefault: String(crawler.default ?? "allow"), gptbot: String(crawler.GPTBot ?? "allow"), googleExtended: String(crawler["Google-Extended"] ?? "allow"), claudeBot: String(crawler.ClaudeBot ?? "allow"),
        maxImageBytes: Number(media.maxImageBytes ?? 2097152), lcpWarningBytes: Number(media.lcpWarningBytes ?? 786432), minLcpWidth: Number(media.minLcpWidth ?? 1200),
      });
      setAudit(auditBody.data);
      setRoutes(routesBody.data || []);
      setRobots(robotsBody.data?.text || "");
      setSitemap(sitemapBody.data || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load assurance data");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/web-quality", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
        siteBaseUrl: form.siteBaseUrl || null, siteName: form.siteName || null, titleSuffix: form.titleSuffix || null,
        robotsEnabled: form.robotsEnabled, sitemapEnabled: form.sitemapEnabled, requireCanonicalRoute: form.requireCanonicalRoute,
        requireSocialCard: form.requireSocialCard, requireSchemaOrg: form.requireSchemaOrg,
        aiCrawlerPolicy: { default: form.aiDefault, GPTBot: form.gptbot, "Google-Extended": form.googleExtended, ClaudeBot: form.claudeBot },
        mediaBudget: { maxImageBytes: form.maxImageBytes, lcpWarningBytes: form.lcpWarningBytes, minLcpWidth: form.minLcpWidth, preferredImageFormats: ["image/avif", "image/webp"] },
        settings: { warnNoindexOnCanonical: true, requireHreflangForRequiredLocales: true },
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setNotice("Web Quality policy saved.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save policy"); }
    finally { setBusy(false); }
  };

  const updateRoute = async (route: RouteRow, patch: Partial<RouteRow>) => {
    setBusy(true); setError("");
    try {
      const next = { ...route, ...patch };
      const response = await fetch(`/api/routes/${route.id}/discoverability`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ indexingPolicy: next.indexing_policy, sitemapIncluded: next.sitemap_included, sitemapPriority: next.sitemap_priority, sitemapChangefreq: next.sitemap_changefreq }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update route"); }
    finally { setBusy(false); }
  };

  const toggle = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.checked }));

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        <header className="ui-page-header">
          <div>
            <p className="ui-eyebrow flex items-center gap-1.5"><ShieldCheck size={12} />Assurance & discoverability</p>
            <h1 className="ui-page-title">Web Quality Control</h1>
            <p className="ui-page-description">Deterministic CMS checks for metadata, routes, localization, graph integrity, crawler policy and media risk. Browser runtime quality remains a Lighthouse/WebPageTest concern.</p>
          </div>
          <button disabled={loading || busy} onClick={() => void load()} className="ui-btn ui-btn-secondary"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button>
        </header>

        {error ? <div className="ui-alert ui-alert-danger mt-5">{error}</div> : null}
        {notice ? <div className="ui-alert ui-alert-success mt-5">{notice}</div> : null}

        <section className="ui-section grid gap-10 xl:grid-cols-[1.05fr_.95fr]">
          <div>
            <div className="flex items-end justify-between gap-4"><div><h2 className="ui-section-title">Discoverability contract</h2><p className="ui-section-description">Workspace-wide indexing, crawler and media policy.</p></div><button disabled={busy} onClick={() => void save()} className="ui-btn ui-btn-primary"><Save size={13} />Save policy</button></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Site base URL"><input value={form.siteBaseUrl} onChange={(event) => setForm((current) => ({ ...current, siteBaseUrl: event.target.value }))} placeholder="https://www.example.com" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
              <Field label="Site name"><input value={form.siteName} onChange={(event) => setForm((current) => ({ ...current, siteName: event.target.value }))} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
              <div className="sm:col-span-2"><Field label="Title suffix"><input value={form.titleSuffix} onChange={(event) => setForm((current) => ({ ...current, titleSuffix: event.target.value }))} placeholder="| Polynovea" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field></div>
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {([['robotsEnabled','Generate robots policy'],['sitemapEnabled','Generate sitemap'],['requireCanonicalRoute','Require canonical route'],['requireSocialCard','Require social card'],['requireSchemaOrg','Require Schema.org']] as Array<[keyof typeof form,string]>).map(([key,label]) => <label key={key} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[12px] text-fg-secondary"><input type="checkbox" checked={Boolean(form[key])} onChange={toggle(key)} className="accent-primary" />{label}</label>)}
            </div>
            <div className="mt-6 border-t border-subtle pt-5"><h3 className="flex items-center gap-2 text-[13px] font-semibold text-fg-primary"><Bot size={14} />AI crawler policy</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">{([['aiDefault','Default'],['gptbot','GPTBot'],['googleExtended','Google-Extended'],['claudeBot','ClaudeBot']] as Array<[keyof typeof form,string]>).map(([key,label]) => <Field key={key} label={label}><select value={String(form[key])} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm"><option value="allow">Allow</option><option value="disallow">Disallow</option></select></Field>)}</div></div>
            <div className="mt-6 border-t border-subtle pt-5"><h3 className="text-[13px] font-semibold text-fg-primary">Media / LCP guardrails</h3><div className="mt-4 grid gap-4 sm:grid-cols-3">{([['maxImageBytes','Max image bytes'],['lcpWarningBytes','LCP warning bytes'],['minLcpWidth','Min LCP width']] as Array<[keyof typeof form,string]>).map(([key,label]) => <Field key={key} label={label}><input type="number" value={Number(form[key])} onChange={(event) => setForm((current) => ({ ...current, [key]: Number(event.target.value) }))} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>)}</div></div>
          </div>

          <div className="xl:border-l xl:border-subtle xl:pl-8">
            <div className="flex items-center gap-2"><SearchCheck size={16} className="text-icon-secondary" /><h2 className="ui-section-title">Site assurance audit</h2></div>
            {audit ? <>
              <div className="mt-5 flex gap-8"><div><div className="text-2xl font-semibold text-danger">{audit.summary.blocking}</div><div className="mt-1 text-[11px] text-fg-muted">Blocking</div></div><div><div className="text-2xl font-semibold text-warning">{audit.summary.warnings}</div><div className="mt-1 text-[11px] text-fg-muted">Warnings</div></div><div><div className="text-2xl font-semibold text-success">{audit.summary.indexedRoutes}</div><div className="mt-1 text-[11px] text-fg-muted">Indexable</div></div></div>
              <div className="mt-5 max-h-[430px] overflow-auto border-y border-subtle">{audit.findings.length ? audit.findings.map((finding, index) => <div key={`${finding.code}-${index}`} className="ui-list-row items-start py-3.5"><AlertTriangle size={14} className={`mt-0.5 shrink-0 ${finding.severity === 'blocking' ? 'text-danger' : 'text-warning'}`} /><div><p className="text-[12px] text-fg-primary">{finding.message}</p>{finding.path ? <p className="mt-1 font-mono text-[10px] text-fg-muted">{finding.locale ? `${finding.locale} · ` : ''}{finding.path}</p> : null}{finding.recommendedAction ? <p className="mt-1 text-[11px] text-fg-muted">{finding.recommendedAction}</p> : null}</div></div>) : <div className="ui-alert ui-alert-success my-4"><CheckCircle2 size={14} className="mr-2 inline" />No site-wide deterministic issues detected.</div>}</div>
              <p className="mt-4 text-[11px] leading-5 text-fg-muted">{audit.toolingBoundary}</p>
            </> : <p className="mt-4 text-sm text-fg-muted">Loading audit…</p>}
          </div>
        </section>

        <section className="ui-section grid gap-10 lg:grid-cols-2">
          <div><h2 className="flex items-center gap-2 text-[13px] font-semibold text-fg-primary"><Bot size={14} className="text-review" />robots.txt preview</h2><pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-field p-4 text-[11px] leading-5 text-fg-secondary">{robots || "No robots output."}</pre></div>
          <div><h2 className="flex items-center gap-2 text-[13px] font-semibold text-fg-primary"><Network size={14} className="text-info" />Sitemap & hreflang</h2><p className="mt-2 text-[12px] text-fg-muted">{sitemap?.entries.length ?? 0} canonical published destination(s).</p><div className="mt-4 max-h-64 overflow-auto border-y border-subtle">{sitemap?.entries.slice(0,20).map((entry) => <div key={`${entry.locale}-${entry.url}`} className="ui-list-row"><div className="min-w-0"><p className="truncate font-mono text-[11px] text-fg-secondary">{entry.url}</p><p className="mt-1 text-[10px] text-fg-muted">{entry.locale} · {entry.alternates.length} alternate(s)</p></div></div>)}</div></div>
        </section>

        <section className="ui-section">
          <div className="mb-4"><p className="ui-eyebrow flex items-center gap-1.5"><RouteIcon size={12} />Route discoverability</p><h2 className="ui-section-title">Indexing & sitemap controls</h2></div>
          <div className="overflow-x-auto border-y border-subtle"><div className="min-w-[760px]">{routes.map((route) => <div key={route.id} className="grid grid-cols-[minmax(0,1fr)_100px_130px_120px_130px] items-center gap-3 border-t border-subtle px-2 py-3 first:border-t-0"><div className="min-w-0"><p className="truncate font-mono text-[12px] text-fg-secondary">{route.path}</p><p className="mt-1 text-[10px] text-fg-muted">{route.locale}{route.is_canonical ? ' · canonical' : ''}</p></div><select disabled={busy} value={route.indexing_policy || 'inherit'} onChange={(event) => void updateRoute(route,{ indexing_policy:event.target.value as RouteRow['indexing_policy'] })} className="rounded-lg px-2 py-2 text-xs"><option value="inherit">inherit</option><option value="index">index</option><option value="noindex">noindex</option></select><label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" checked={route.sitemap_included !== false} onChange={(event) => void updateRoute(route,{ sitemap_included:event.target.checked })} className="accent-primary" />sitemap</label><input disabled={busy} type="number" min="0" max="1" step="0.1" value={route.sitemap_priority ?? ""} placeholder="priority" onBlur={(event) => void updateRoute(route,{ sitemap_priority:event.target.value === "" ? null : Number(event.target.value) })} onChange={(event) => setRoutes((current) => current.map((item) => item.id === route.id ? { ...item, sitemap_priority:event.target.value === "" ? null : Number(event.target.value) } : item))} className="rounded-lg px-2 py-2 text-xs" /><select disabled={busy} value={route.sitemap_changefreq ?? ""} onChange={(event) => void updateRoute(route,{ sitemap_changefreq:event.target.value || null })} className="rounded-lg px-2 py-2 text-xs"><option value="">changefreq</option>{['always','hourly','daily','weekly','monthly','yearly','never'].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>)}</div></div>
        </section>
      </div>
    </AdminLayout>
  );
}
