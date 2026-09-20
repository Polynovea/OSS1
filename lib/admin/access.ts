import type { AdminRole, AdminUser } from "@/lib/admin/types";

export type AdminSurface = "cms" | "content";

export type AdminModule =
  | "cms.overview"
  | "cms.blog"
  | "cms.metrics"
  | "cms.models"
  | "cms.entries"
  | "cms.experience"
  | "cms.media"
  | "cms.releases"
  | "cms.workflows"
  | "cms.localization"
  | "cms.calendar"
  | "cms.my-work"
  | "cms.assurance"
  | "cms.operations"
  | "cms.intelligence"
  | "cms.operational-intelligence"
  | "cms.developer"
  | "cms.environments"
  | "cms.connections"
  | "cms.infrastructure"
  | "cms.access"
  | "cms.taxonomy"
  | "cms.routes"
  | "cms.redirects"
  | "cms.navigation"
  | "content.overview"
  | "content.library"
  | "content.ads"
  | "content.analysis"
  | "content.platforms";

export interface AccessModuleDefinition {
  key: AdminModule;
  label: string;
  description: string;
  surface: AdminSurface;
}

const PATH_RULES: { prefix: string; module?: AdminModule; surface?: AdminSurface; exact?: boolean }[] = [
  { prefix: "/admin/access", module: "cms.access" },
  { prefix: "/admin/cms", module: "cms.overview", exact: true },
  { prefix: "/admin/blog", module: "cms.blog" },
  { prefix: "/admin/metrics", module: "cms.metrics" },
  { prefix: "/admin/models", module: "cms.models" },
  { prefix: "/admin/entries", module: "cms.entries" },
  { prefix: "/admin/experience", module: "cms.experience" },
  { prefix: "/admin/media", module: "cms.media" },
  { prefix: "/admin/releases", module: "cms.releases" },
  { prefix: "/admin/workflows", module: "cms.workflows" },
  { prefix: "/admin/localization", module: "cms.localization" },
  { prefix: "/admin/calendar", module: "cms.calendar" },
  { prefix: "/admin/my-work", module: "cms.my-work" },
  { prefix: "/admin/assurance", module: "cms.assurance" },
  { prefix: "/admin/operations", module: "cms.operations" },
  { prefix: "/admin/intelligence", module: "cms.intelligence" },
  { prefix: "/admin/operational-intelligence", module: "cms.operational-intelligence" },
  { prefix: "/admin/developer", module: "cms.developer" },
  { prefix: "/admin/environments", module: "cms.environments" },
  { prefix: "/admin/connections", module: "cms.connections" },
  { prefix: "/admin/infrastructure", module: "cms.infrastructure" },
  { prefix: "/admin/taxonomy", module: "cms.taxonomy" },
  { prefix: "/admin/routes", module: "cms.routes" },
  { prefix: "/admin/redirects", module: "cms.redirects" },
  { prefix: "/admin/navigation", module: "cms.navigation" },
  { prefix: "/admin/content/content", module: "content.library" },
  { prefix: "/admin/content/ads", module: "content.ads" },
  { prefix: "/admin/content/analysis", module: "content.analysis" },
  { prefix: "/admin/content/platforms", module: "content.platforms" },
  { prefix: "/admin/content", module: "content.overview", exact: true },
  { prefix: "/admin", surface: "cms", exact: true },
];

export const ACCESS_MODULES: AccessModuleDefinition[] = [
  { key: "cms.overview", label: "CMS Overview", description: "Command center landing screen.", surface: "cms" },
  { key: "cms.blog", label: "Blog", description: "Publish and edit blog content.", surface: "cms" },
  { key: "cms.metrics", label: "Metrics", description: "Edit live metrics shown on site.", surface: "cms" },
  { key: "cms.models", label: "Content Models", description: "Design and version structured content schemas.", surface: "cms" },
  { key: "cms.entries", label: "Content Library", description: "Create, edit, and publish structured content entries.", surface: "cms" },
  { key: "cms.experience", label: "Experience Studio", description: "Visually compose digital experiences and landing pages.", surface: "cms" },
  { key: "cms.media", label: "Media Library", description: "Upload and manage governed content assets.", surface: "cms" },
  { key: "cms.releases", label: "Releases", description: "Bundle approved content versions for controlled publication.", surface: "cms" },
  { key: "cms.workflows", label: "Workflows", description: "Configure deterministic editorial review and approval stages.", surface: "cms" },
  { key: "cms.localization", label: "Localization", description: "Manage locales, fallback policy, and translation readiness.", surface: "cms" },
  { key: "cms.calendar", label: "Editorial Calendar", description: "Review release, review, campaign, and publication dates.", surface: "cms" },
  { key: "cms.my-work", label: "My Work", description: "Review personal assignments and editorial notifications.", surface: "cms" },
  { key: "cms.assurance", label: "Assurance & Web Quality", description: "Govern discoverability, crawler policy, sitemap/indexing, and publish-readiness assurance.", surface: "cms" },
  { key: "cms.operations", label: "Delivery Operations", description: "Inspect durable delivery jobs, attempts, destination health, dead letters, and webhook delivery state.", surface: "cms" },
  { key: "cms.intelligence", label: "Search, Analytics & Health", description: "Search governed content, inspect analytics freshness, and operate content-health remediation.", surface: "cms" },
  { key: "cms.operational-intelligence", label: "Operational Intelligence", description: "Inspect deterministic environment state, drift, change plans, simulation, proof and autonomy policy.", surface: "cms" },
  { key: "cms.developer", label: "Developer Platform", description: "Manage scoped API access, OpenAPI, SDK/CLI and schema delivery automation.", surface: "cms" },
  { key: "cms.environments", label: "Environments", description: "Manage Local, Development, Staging, Production and custom runtime environments.", surface: "cms" },
  { key: "cms.connections", label: "Connections", description: "Configure, verify and operate typed external service connections without exposing credentials.", surface: "cms" },
  { key: "cms.infrastructure", label: "Setup & Infrastructure", description: "Provision, diagnose, back up, restore and upgrade governed CMS environments.", surface: "cms" },
  { key: "cms.taxonomy", label: "Taxonomy", description: "Manage categories, tags, topics, and term hierarchies.", surface: "cms" },
  { key: "cms.routes", label: "Site Tree & Routes", description: "Manage canonical URLs, path hierarchies, and site tree.", surface: "cms" },
  { key: "cms.redirects", label: "Redirects", description: "Manage permanent and temporary URL redirects.", surface: "cms" },
  { key: "cms.navigation", label: "Navigation Menus", description: "Build and version multi-level site navigation.", surface: "cms" },
  { key: "cms.access", label: "Access", description: "Manage admin user permissions.", surface: "cms" },
  { key: "content.overview", label: "Content Overview", description: "Marketing performance snapshot.", surface: "content" },
  { key: "content.library", label: "Content Library", description: "Log and track social content.", surface: "content" },
  { key: "content.ads", label: "Ads Dashboard", description: "Manage paid campaigns and performance.", surface: "content" },
  { key: "content.analysis", label: "Analysis Charts", description: "Inspect reporting charts.", surface: "content" },
  { key: "content.platforms", label: "Platforms", description: "Manage the platform list used across Content Library and Ads Dashboard.", surface: "content" },
];

export const SURFACE_LABELS: Record<AdminSurface, string> = {
  cms: "CMS",
  content: "Content",
};

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export function normalizeAdminUser(value: Partial<AdminUser> & { username: string; email: string; role: AdminRole }): AdminUser {
  const readModules = normalizeStringArray(value.module_access);
  const writeModules = normalizeStringArray(value.module_write_access);
  return {
    id: String(value.id ?? ""),
    auth_user_id: value.auth_user_id ?? null,
    username: value.username,
    email: value.email.toLowerCase(),
    display_name: value.display_name ?? null,
    role: value.role,
    is_active: value.is_active ?? true,
    surface_access: normalizeStringArray(value.surface_access),
    module_access: readModules,
    module_write_access: writeModules.length ? writeModules : readModules,
    created_by: value.created_by ?? null,
    created_at: value.created_at ?? new Date().toISOString(),
    updated_at: value.updated_at ?? new Date().toISOString(),
  };
}

export function isMasterUser(user: AdminUser | null | undefined): boolean {
  return Boolean(user && user.role === "master");
}

export function hasSurfaceAccess(user: AdminUser | null | undefined, surface: AdminSurface): boolean {
  if (!user || !user.is_active) return false;
  if (isMasterUser(user)) return true;
  return user.surface_access.includes(surface);
}

export function hasModuleAccess(user: AdminUser | null | undefined, module: AdminModule): boolean {
  if (!user || !user.is_active) return false;
  if (isMasterUser(user)) return true;
  const [surface] = module.split(".") as [AdminSurface, string];
  if (!hasSurfaceAccess(user, surface)) return false;
  return user.module_access.includes("*")
    || user.module_access.includes(`${surface}.*`)
    || user.module_access.includes(module);
}

export function hasModuleWriteAccess(user: AdminUser | null | undefined, module: AdminModule): boolean {
  if (!user || !user.is_active) return false;
  if (isMasterUser(user)) return true;
  const [surface] = module.split(".") as [AdminSurface, string];
  if (!hasSurfaceAccess(user, surface)) return false;
  return user.module_write_access.includes("*")
    || user.module_write_access.includes(`${surface}.*`)
    || user.module_write_access.includes(module);
}

export function getRequiredModuleForPath(pathname: string): AdminModule | null {
  const match = PATH_RULES.find((rule) => rule.exact ? pathname === rule.prefix : pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`));
  return match?.module ?? null;
}

export function getRequiredSurfaceForPath(pathname: string): AdminSurface | null {
  const explicit = PATH_RULES.find((rule) => rule.exact ? pathname === rule.prefix : pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`));
  if (explicit?.surface) return explicit.surface;
  const module = explicit?.module;
  if (!module) return null;
  return module.startsWith("content.") ? "content" : "cms";
}

export function canAccessPath(user: AdminUser | null | undefined, pathname: string): boolean {
  if (!user || !user.is_active) return false;
  if (pathname === "/admin/profile" || pathname.startsWith("/admin/profile/")) {
    return true;
  }
  if (pathname === "/admin") {
    return hasSurfaceAccess(user, "cms") || hasSurfaceAccess(user, "content");
  }
  const requiredModule = getRequiredModuleForPath(pathname);
  if (requiredModule) return hasModuleAccess(user, requiredModule);
  const requiredSurface = getRequiredSurfaceForPath(pathname);
  return requiredSurface ? hasSurfaceAccess(user, requiredSurface) : false;
}
