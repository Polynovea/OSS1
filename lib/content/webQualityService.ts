import { createServiceRoleClient } from "@/lib/admin/serviceRole";

export interface WebQualityPolicy {
  workspace_id: string;
  site_base_url: string | null;
  site_name: string | null;
  title_suffix: string | null;
  robots_enabled: boolean;
  sitemap_enabled: boolean;
  require_canonical_route: boolean;
  require_social_card: boolean;
  require_schema_org: boolean;
  ai_crawler_policy: Record<string, unknown>;
  media_budget_json: Record<string, unknown>;
  settings_json: Record<string, unknown>;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type SiteAuditSeverity = "blocking" | "warning" | "info";
export interface SiteAuditFinding {
  code: string;
  severity: SiteAuditSeverity;
  message: string;
  routeId?: string;
  entryId?: string;
  locale?: string;
  path?: string;
  recommendedAction?: string;
}

export const DEFAULT_MEDIA_BUDGET = {
  maxImageBytes: 2_097_152,
  lcpWarningBytes: 786_432,
  minLcpWidth: 1200,
  preferredImageFormats: ["image/avif", "image/webp"],
};
export const DEFAULT_QUALITY_SETTINGS = {
  warnNoindexOnCanonical: true,
  requireHreflangForRequiredLocales: true,
};

function policyDefaults(workspaceId: string, siteName?: string | null): WebQualityPolicy {
  const now = new Date().toISOString();
  return {
    workspace_id: workspaceId,
    site_base_url: null,
    site_name: siteName ?? null,
    title_suffix: null,
    robots_enabled: true,
    sitemap_enabled: true,
    require_canonical_route: true,
    require_social_card: false,
    require_schema_org: false,
    ai_crawler_policy: { default: "allow" },
    media_budget_json: DEFAULT_MEDIA_BUDGET,
    settings_json: DEFAULT_QUALITY_SETTINGS,
    updated_by: null,
    created_at: now,
    updated_at: now,
  };
}

export async function getWebQualityPolicy(workspaceId: string): Promise<WebQualityPolicy> {
  const db = createServiceRoleClient();
  const [{ data }, { data: workspace }] = await Promise.all([
    db.from("web_quality_policies").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
  ]);
  const base = policyDefaults(workspaceId, workspace?.name ?? null);
  return data ? {
    ...base,
    ...data,
    ai_crawler_policy: { ...base.ai_crawler_policy, ...(data.ai_crawler_policy ?? {}) },
    media_budget_json: { ...base.media_budget_json, ...(data.media_budget_json ?? {}) },
    settings_json: { ...base.settings_json, ...(data.settings_json ?? {}) },
  } as WebQualityPolicy : base;
}

export async function saveWebQualityPolicy(params: {
  workspaceId: string;
  actorId: string;
  siteBaseUrl?: string | null;
  siteName?: string | null;
  titleSuffix?: string | null;
  robotsEnabled?: boolean;
  sitemapEnabled?: boolean;
  requireCanonicalRoute?: boolean;
  requireSocialCard?: boolean;
  requireSchemaOrg?: boolean;
  aiCrawlerPolicy?: Record<string, unknown>;
  mediaBudget?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}) {
  const current = await getWebQualityPolicy(params.workspaceId);
  const { data, error } = await createServiceRoleClient().rpc("cms_upsert_web_quality_policy", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_site_base_url: params.siteBaseUrl ?? current.site_base_url,
    p_site_name: params.siteName ?? current.site_name,
    p_title_suffix: params.titleSuffix ?? current.title_suffix,
    p_robots_enabled: params.robotsEnabled ?? current.robots_enabled,
    p_sitemap_enabled: params.sitemapEnabled ?? current.sitemap_enabled,
    p_require_canonical_route: params.requireCanonicalRoute ?? current.require_canonical_route,
    p_require_social_card: params.requireSocialCard ?? current.require_social_card,
    p_require_schema_org: params.requireSchemaOrg ?? current.require_schema_org,
    p_ai_crawler_policy: params.aiCrawlerPolicy ?? current.ai_crawler_policy,
    p_media_budget: { ...DEFAULT_MEDIA_BUDGET, ...(params.mediaBudget ?? current.media_budget_json) },
    p_settings: { ...DEFAULT_QUALITY_SETTINGS, ...(params.settings ?? current.settings_json) },
  });
  if (error || !data) throw new Error(error?.message || "Could not save Web Quality policy");
  return data as WebQualityPolicy;
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const xml = (value: string) => value.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);
const absoluteUrl = (base: string | null, path: string) => base ? `${base.replace(/\/$/, "")}${path === "/" ? "" : path}` : path;

export async function generateRobotsTxt(workspaceId: string): Promise<{ enabled: boolean; text: string; policy: WebQualityPolicy }> {
  const policy = await getWebQualityPolicy(workspaceId);
  if (!policy.robots_enabled) return { enabled: false, text: "# robots.txt generation disabled by workspace policy\n", policy };
  const crawlerPolicy = policy.ai_crawler_policy ?? {};
  const defaultMode = String(crawlerPolicy.default ?? "allow").toLowerCase();
  const lines = ["User-agent: *", defaultMode === "disallow" ? "Disallow: /" : "Allow: /"];
  const entries = Object.entries(crawlerPolicy).filter(([name]) => name !== "default");
  for (const [name, raw] of entries) {
    if (!name.trim()) continue;
    const mode = typeof raw === "string" ? raw : (raw && typeof raw === "object" ? String((raw as Record<string, unknown>).mode ?? "allow") : "allow");
    lines.push("", `User-agent: ${name}`, mode.toLowerCase() === "disallow" ? "Disallow: /" : "Allow: /");
  }
  if (policy.sitemap_enabled && policy.site_base_url) lines.push("", `Sitemap: ${policy.site_base_url.replace(/\/$/, "")}/sitemap.xml`);
  return { enabled: true, text: `${lines.join("\n")}\n`, policy };
}

interface SitemapRow {
  routeId: string;
  entryId: string | null;
  locale: string;
  path: string;
  url: string;
  lastModified: string;
  priority: number | null;
  changefreq: string | null;
  alternates: Array<{ locale: string; path: string; url: string }>;
}

export async function getSitemapEntries(workspaceId: string): Promise<{ enabled: boolean; entries: SitemapRow[]; policy: WebQualityPolicy }> {
  const db = createServiceRoleClient();
  const policy = await getWebQualityPolicy(workspaceId);
  if (!policy.sitemap_enabled) return { enabled: false, entries: [], policy };
  const { data: routes } = await db.from("content_routes")
    .select("id,entry_id,locale,path,updated_at,indexing_policy,sitemap_included,sitemap_priority,sitemap_changefreq")
    .eq("workspace_id", workspaceId).eq("status", "active").eq("is_canonical", true).eq("sitemap_included", true).neq("indexing_policy", "noindex")
    .order("path");
  const entryIds = [...new Set((routes ?? []).map((route) => route.entry_id).filter((id): id is string => Boolean(id)))];
  const { data: entries } = entryIds.length
    ? await db.from("content_entries").select("id,status,updated_at").eq("workspace_id", workspaceId).in("id", entryIds)
    : { data: [] as Array<{ id: string; status: string; updated_at: string }> };
  const entryById = new Map((entries ?? []).map((entry) => [entry.id, entry]));
  const canonicalByEntry = new Map<string, Array<{ locale: string; path: string }>>();
  for (const route of routes ?? []) if (route.entry_id) {
    const list = canonicalByEntry.get(route.entry_id) ?? [];
    list.push({ locale: route.locale, path: route.path });
    canonicalByEntry.set(route.entry_id, list);
  }
  const result: SitemapRow[] = [];
  for (const route of routes ?? []) {
    const entry = route.entry_id ? entryById.get(route.entry_id) : null;
    if (route.entry_id && (!entry || entry.status !== "published")) continue;
    const alternates = route.entry_id ? (canonicalByEntry.get(route.entry_id) ?? []).map((alt) => ({ ...alt, url: absoluteUrl(policy.site_base_url, alt.path) })) : [];
    result.push({ routeId: route.id, entryId: route.entry_id, locale: route.locale, path: route.path, url: absoluteUrl(policy.site_base_url, route.path), lastModified: entry?.updated_at ?? route.updated_at, priority: route.sitemap_priority == null ? null : Number(route.sitemap_priority), changefreq: route.sitemap_changefreq, alternates });
  }
  return { enabled: true, entries: result, policy };
}

export async function generateSitemapXml(workspaceId: string): Promise<{ enabled: boolean; xml: string; count: number }> {
  const data = await getSitemapEntries(workspaceId);
  if (!data.enabled) return { enabled: false, xml: "", count: 0 };
  const body = data.entries.map((entry) => {
    const alternates = entry.alternates.filter((alt) => alt.locale !== entry.locale).map((alt) => `    <xhtml:link rel="alternate" hreflang="${xml(alt.locale)}" href="${xml(alt.url)}" />`).join("\n");
    return ["  <url>", `    <loc>${xml(entry.url)}</loc>`, `    <lastmod>${xml(new Date(entry.lastModified).toISOString())}</lastmod>`, entry.changefreq ? `    <changefreq>${xml(entry.changefreq)}</changefreq>` : "", entry.priority != null ? `    <priority>${entry.priority.toFixed(1)}</priority>` : "", alternates, "  </url>"].filter(Boolean).join("\n");
  }).join("\n");
  return { enabled: true, count: data.entries.length, xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n` };
}

function pickString(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof data[key] === "string" && String(data[key]).trim()) return String(data[key]).trim();
  return null;
}

export async function runSiteDiscoverabilityAudit(workspaceId: string): Promise<{
  status: "ready" | "attention";
  summary: { blocking: number; warnings: number; info: number; routes: number; indexedRoutes: number };
  findings: SiteAuditFinding[];
  toolingBoundary: string;
}> {
  const db = createServiceRoleClient();
  const policy = await getWebQualityPolicy(workspaceId);
  const [routesRes, redirectsRes, entriesRes] = await Promise.all([
    db.from("content_routes").select("id,entry_id,locale,path,title,parent_route_id,is_canonical,status,indexing_policy,sitemap_included").eq("workspace_id", workspaceId).neq("status", "archived"),
    db.from("content_redirects").select("id,locale,source_path,target_path,is_active").eq("workspace_id", workspaceId).eq("is_active", true),
    db.from("content_entries").select("id,status,current_draft_version_id,published_version_id,content_model_id").eq("workspace_id", workspaceId),
  ]);
  const routes = routesRes.data ?? [];
  const redirects = redirectsRes.data ?? [];
  const entries = entriesRes.data ?? [];
  const findings: SiteAuditFinding[] = [];
  const activeRouteKeys = new Set(routes.filter((r) => r.status === "active").map((r) => `${r.locale}:${r.path}`));
  const canonicalEntryIds = new Set(routes.filter((r) => r.is_canonical && r.status === "active" && r.entry_id).map((r) => r.entry_id as string));

  for (const route of routes) {
    if (route.is_canonical && route.indexing_policy === "noindex") findings.push({ code: "seo.canonical_noindex", severity: "warning", message: "A canonical route is explicitly noindex.", routeId: route.id, entryId: route.entry_id ?? undefined, locale: route.locale, path: route.path, recommendedAction: "Confirm noindex is intentional or switch indexing policy to inherit/index." });
    if (route.indexing_policy === "noindex" && route.sitemap_included) findings.push({ code: "seo.noindex_in_sitemap", severity: "blocking", message: "A noindex route is still marked for sitemap inclusion.", routeId: route.id, locale: route.locale, path: route.path, recommendedAction: "Remove it from the sitemap or allow indexing." });
    if (route.parent_route_id) {
      const parent = routes.find((candidate) => candidate.id === route.parent_route_id);
      if (!parent) findings.push({ code: "navigation.breadcrumb_parent_missing", severity: "blocking", message: "Route parent is missing, so a safe breadcrumb chain cannot be built.", routeId: route.id, locale: route.locale, path: route.path });
      else if (!parent.title) findings.push({ code: "navigation.breadcrumb_parent_untitled", severity: "warning", message: "A breadcrumb parent has no managed title.", routeId: route.id, locale: route.locale, path: route.path });
    }
  }

  if (policy.require_canonical_route) {
    for (const entry of entries.filter((e) => e.status === "published")) if (!canonicalEntryIds.has(entry.id)) findings.push({ code: "destination.orphan_entry", severity: "blocking", message: "Published content has no active canonical route.", entryId: entry.id, recommendedAction: "Assign an active canonical route to this entry." });
  }

  for (const redirect of redirects) {
    if (activeRouteKeys.has(`${redirect.locale ?? "en"}:${redirect.source_path}`) || (!redirect.locale && routes.some((r) => r.path === redirect.source_path && r.status === "active"))) findings.push({ code: "redirect.source_collision", severity: "blocking", message: "An active redirect source collides with an active route.", locale: redirect.locale ?? undefined, path: redirect.source_path, recommendedAction: "Remove the redirect or move the active route." });
    if (!/^https?:\/\//i.test(redirect.target_path)) {
      const targetExists = routes.some((r) => r.path === redirect.target_path && r.status === "active" && (!redirect.locale || r.locale === redirect.locale));
      if (!targetExists && !redirects.some((r) => r.source_path === redirect.target_path)) findings.push({ code: "redirect.broken_target", severity: "blocking", message: "Redirect target does not resolve to an active route or redirect.", locale: redirect.locale ?? undefined, path: redirect.source_path, recommendedAction: "Point the redirect to a managed route." });
    }
  }

  const currentVersionIds = [...new Set(entries.map((e) => e.current_draft_version_id ?? e.published_version_id).filter((id): id is string => Boolean(id)))];
  const { data: versions } = currentVersionIds.length ? await db.from("content_entry_versions").select("id,entry_id,data_jsonb,locale").in("id", currentVersionIds) : { data: [] as Array<{ id: string; entry_id: string; data_jsonb: Record<string, unknown>; locale: string }> };
  const titleMap = new Map<string, string[]>();
  for (const version of versions ?? []) {
    const title = pickString(version.data_jsonb, ["seo_title", "meta_title", "title", "name"]);
    if (!title) continue;
    const normalized = title.toLocaleLowerCase();
    const list = titleMap.get(normalized) ?? [];
    list.push(version.entry_id);
    titleMap.set(normalized, list);
  }
  for (const [title, ids] of titleMap) if (ids.length > 1) findings.push({ code: "seo.duplicate_title", severity: "warning", message: `Duplicate discoverability title “${title}” is used by ${ids.length} entries.`, entryId: ids[0], recommendedAction: "Give each indexable destination a distinct search title." });

  const blocking = findings.filter((f) => f.severity === "blocking").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;
  return {
    status: blocking || warnings ? "attention" : "ready",
    summary: { blocking, warnings, info, routes: routes.length, indexedRoutes: routes.filter((r) => r.status === "active" && r.indexing_policy !== "noindex").length },
    findings,
    toolingBoundary: "These are deterministic CMS/content checks. Runtime accessibility, Core Web Vitals, render timing and network performance still require Lighthouse, WebPageTest or equivalent browser tooling.",
  };
}
