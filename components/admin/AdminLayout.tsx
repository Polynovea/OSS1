"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart2,
  Bell,
  Boxes,
  CalendarDays,
  ChevronDown,
  Code2,
  Compass,
  CornerUpRight,
  Diamond,
  FileText,
  GitFork,
  GitPullRequest,
  Image,
  Languages,
  LayoutGrid,
  LibraryBig,
  ListChecks,
  LogOut,
  Menu,
  Plug,
  Rocket,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Tags,
  Wrench,
  X,
} from "lucide-react";
import { logout } from "@/lib/admin/authCheck";
import { hasModuleAccess } from "@/lib/admin/access";
import { useAdminAccess } from "@/lib/admin/useAdminAccess";
import { getSupabaseBrowserIdentityProvider } from "@/lib/auth/supabaseProvider";
import ThemeToggle from "@/components/admin/ThemeToggle";

const navItems = [
  { href: "/admin/cms", label: "Command Center", icon: LayoutGrid, module: "cms.overview" as const, group: "workspace" },
  { href: "/admin/experience", label: "Experience Studio", icon: Sparkles, module: "cms.experience" as const, group: "create" },
  { href: "/admin/blog", label: "Blog", icon: FileText, module: "cms.blog" as const, group: "create" },
  { href: "/admin/entries", label: "Data Studio", icon: LibraryBig, module: "cms.entries" as const, group: "create" },
  { href: "/admin/media", label: "Media", icon: Image, module: "cms.media" as const, group: "create" },
  { href: "/admin/models", label: "Data Models", icon: Boxes, module: "cms.models" as const, group: "structure" },
  { href: "/admin/taxonomy", label: "Taxonomy", icon: Tags, module: "cms.taxonomy" as const, group: "structure" },
  { href: "/admin/routes", label: "Site Tree & Routes", icon: GitFork, module: "cms.routes" as const, group: "structure" },
  { href: "/admin/redirects", label: "Redirects", icon: CornerUpRight, module: "cms.redirects" as const, group: "structure" },
  { href: "/admin/navigation", label: "Navigation", icon: Compass, module: "cms.navigation" as const, group: "structure" },
  { href: "/admin/localization", label: "Localization", icon: Languages, module: "cms.localization" as const, group: "structure" },
  { href: "/admin/releases", label: "Releases", icon: Rocket, module: "cms.releases" as const, group: "operate" },
  { href: "/admin/workflows", label: "Workflows", icon: GitPullRequest, module: "cms.workflows" as const, group: "operate" },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays, module: "cms.calendar" as const, group: "operate" },
  { href: "/admin/my-work", label: "My Work", icon: ListChecks, module: "cms.my-work" as const, group: "operate" },
  { href: "/admin/metrics", label: "Metrics", icon: BarChart2, module: "cms.metrics" as const, group: "observe" },
  { href: "/admin/assurance", label: "Assurance", icon: ShieldCheck, module: "cms.assurance" as const, group: "observe" },
  { href: "/admin/operations", label: "Delivery Ops", icon: Bell, module: "cms.operations" as const, group: "observe" },
  { href: "/admin/intelligence", label: "Content Intelligence", icon: Search, module: "cms.intelligence" as const, group: "observe" },
  { href: "/admin/operational-intelligence", label: "Operational Intelligence", icon: Diamond, module: "cms.operational-intelligence" as const, group: "observe" },
  { href: "/admin/developer", label: "Developer", icon: Code2, module: "cms.developer" as const, group: "platform" },
  { href: "/admin/environments", label: "Environments", icon: Server, module: "cms.environments" as const, group: "platform" },
  { href: "/admin/connections", label: "Connections", icon: Plug, module: "cms.connections" as const, group: "platform" },
  { href: "/admin/infrastructure", label: "Setup & Infrastructure", icon: Wrench, module: "cms.infrastructure" as const, group: "platform" },
  { href: "/admin/access", label: "Access", icon: Shield, module: "cms.access" as const, group: "platform" },
];

const navGroups = [
  { key: "workspace", label: "Workspace" },
  { key: "create", label: "Create" },
  { key: "structure", label: "Structure" },
  { key: "operate", label: "Operate" },
  { key: "observe", label: "Observe" },
  { key: "platform", label: "Platform" },
] as const;

type EditorialNotification = {
  id: string;
  entry_id: string | null;
  release_id: string | null;
  kind: string;
  payload_json?: Record<string, unknown>;
  created_at: string;
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<EditorialNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const notificationRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const { profile } = useAdminAccess();

  useLayoutEffect(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const isCmsApi = url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
      const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
      if (!isCmsApi || headers.has("authorization")) return nativeFetch(input, init);
      const { session } = await getSupabaseBrowserIdentityProvider().getSession();
      if (!session?.access_token) return nativeFetch(input, init);
      headers.set("Authorization", `Bearer ${session.access_token}`);
      return nativeFetch(input, { ...init, headers });
    };
    return () => { window.fetch = nativeFetch; };
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    setNotificationError("");
    try {
      const response = await fetch("/api/collaboration/queue", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Could not load notifications");
      setNotifications(body.data?.notifications ?? []);
    } catch (cause) {
      setNotificationError(cause instanceof Error ? cause.message : "Could not load notifications");
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  const markNotificationsRead = useCallback(async (ids?: string[]) => {
    try {
      const response = await fetch("/api/collaboration/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ids ? { notificationIds: ids } : { all: true }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Could not update notifications");
      setNotifications((current) => ids ? current.filter((item) => !ids.includes(item.id)) : []);
    } catch (cause) {
      setNotificationError(cause instanceof Error ? cause.message : "Could not update notifications");
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (notificationRef.current && !notificationRef.current.contains(target)) setNotificationOpen(false);
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotificationOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const visibleNavItems = navItems.filter((item) => hasModuleAccess(profile, item.module));
  const groupedNav = navGroups
    .map((group) => ({ ...group, items: visibleNavItems.filter((item) => item.group === group.key) }))
    .filter((group) => group.items.length > 0);
  const activeItem = visibleNavItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const pageLabel = pathname === "/admin/profile" || pathname.startsWith("/admin/profile/")
    ? "Profile & Settings"
    : activeItem?.label || "Admin";

  const handleLogout = () => {
    logout();
    window.location.href = "/admin";
  };

  const profileInitial = (profile?.display_name || profile?.username || "R").slice(0, 1).toUpperCase();

  const NavTree = ({ mobile = false }: { mobile?: boolean }) => (
    <nav className="flex-1 px-3 pb-5">
      {groupedNav.map((group) => (
        <div key={group.key} className="mt-5 first:mt-2">
          <div className="px-3 pb-1.5 text-[11px] font-medium text-fg-muted">{group.label}</div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={mobile ? () => setMobileOpen(false) : undefined}
                  className={`group flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium no-underline transition-colors ${
                    active
                      ? "bg-surface-2 text-fg-primary"
                      : "text-fg-muted hover:bg-surface-2 hover:text-fg-secondary"
                  }`}
                >
                  <Icon size={15} strokeWidth={active ? 1.9 : 1.45} className={active ? "text-action" : "text-icon-muted group-hover:text-icon-secondary"} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="admin-shell relative min-h-screen bg-canvas font-sans text-fg-primary">
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_75%_0%,color-mix(in_srgb,var(--brand-aubergine)_28%,transparent),transparent_36%)] opacity-60" />

      <div className="relative z-10 grid min-h-screen grid-cols-1 md:grid-cols-[238px_1fr]">
        <aside className="sticky top-0 hidden h-screen flex-col overflow-y-auto border-r border-subtle bg-sidebar md:flex">
          <div className="px-5 pb-3 pt-5">
            <Link href="/admin/cms" className="flex items-center gap-2.5 no-underline">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-action">
                <Diamond size={14} strokeWidth={1.55} />
              </div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-headline text-[13px] font-bold tracking-[0.04em] text-fg-primary">POLYNOVEA</span>
                  <span className="text-[9px] font-medium text-fg-muted">CMS</span>
                </div>
                <p className="mt-0.5 text-[10px] text-fg-muted">Content operations platform</p>
              </div>
            </Link>
          </div>

          <NavTree />

          <div className="mt-auto border-t border-subtle p-3">
            <Link href="/admin/profile" className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-fg-muted no-underline transition hover:bg-surface-2 hover:text-fg-primary">
              <Settings size={15} strokeWidth={1.45} />
              <span>Profile & Settings</span>
            </Link>
            <button onClick={handleLogout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-fg-muted transition hover:bg-danger-muted hover:text-danger">
              <LogOut size={15} strokeWidth={1.45} />
              <span>Log out</span>
            </button>
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-subtle bg-canvas/90 px-4 backdrop-blur-xl md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button className="rounded-lg p-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Open navigation">
                <Menu size={19} />
              </button>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-fg-primary">{pageLabel}</div>
                <div className="hidden text-[10px] text-fg-muted sm:block">Polynovea CMS workspace</div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <ThemeToggle />
              <div ref={notificationRef} className="relative">
                <button
                  className="relative rounded-lg p-2 text-icon-muted transition hover:bg-surface-2 hover:text-icon-secondary"
                  aria-label={notifications.length ? `Notifications, ${notifications.length} unread` : "Notifications"}
                  aria-expanded={notificationOpen}
                  onClick={() => {
                    const next = !notificationOpen;
                    setNotificationOpen(next);
                    setProfileOpen(false);
                    if (next) void loadNotifications();
                  }}
                >
                  <Bell size={16} strokeWidth={1.4} />
                  {notifications.length > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-review" />}
                </button>
                {notificationOpen && (
                  <div className="absolute right-0 top-11 z-50 w-[min(390px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-default bg-elevated shadow-2xl">
                    <div className="flex items-center justify-between border-b border-subtle px-4 py-3">
                      <div>
                        <p className="text-[13px] font-semibold text-fg-primary">Notifications</p>
                        <p className="mt-0.5 text-[10px] text-fg-muted">{notifications.length ? `${notifications.length} unread` : "You're all caught up"}</p>
                      </div>
                      {notifications.length > 0 && (
                        <button onClick={() => void markNotificationsRead()} className="text-[10px] font-medium text-action hover:text-link-hover">Mark all read</button>
                      )}
                    </div>
                    <div className="max-h-[420px] overflow-y-auto">
                      {notificationsLoading && !notifications.length ? (
                        <div className="px-4 py-8 text-center text-xs text-fg-muted">Loading notifications...</div>
                      ) : notificationError && !notifications.length ? (
                        <div className="px-4 py-5 text-xs text-danger">{notificationError}</div>
                      ) : notifications.length ? notifications.slice(0, 20).map((item) => {
                        const href = item.release_id ? `/admin/releases/${item.release_id}` : item.entry_id ? `/admin/entries/${item.entry_id}` : "/admin/my-work";
                        return (
                          <Link
                            key={item.id}
                            href={href}
                            onClick={() => { void markNotificationsRead([item.id]); setNotificationOpen(false); }}
                            className="block border-b border-subtle px-4 py-3 no-underline last:border-b-0 hover:bg-surface-2"
                          >
                            <div className="flex items-start gap-3">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-review" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[12px] font-medium capitalize text-fg-secondary">{item.kind.replaceAll("_", " ")}</p>
                                <p className="mt-1 text-[10px] text-fg-muted">{new Date(item.created_at).toLocaleString()}</p>
                              </div>
                            </div>
                          </Link>
                        );
                      }) : (
                        <div className="px-4 py-8 text-center text-xs text-fg-muted">No unread notifications.</div>
                      )}
                    </div>
                    <Link href="/admin/my-work" onClick={() => setNotificationOpen(false)} className="block border-t border-subtle px-4 py-3 text-center text-[11px] font-medium text-action no-underline hover:bg-surface-2">Open My Work</Link>
                  </div>
                )}
              </div>

              <div ref={profileRef} className="relative ml-1">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen((value) => !value);
                    setNotificationOpen(false);
                  }}
                  className="flex items-center gap-1 rounded-lg p-0.5 pr-1 text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary"
                  aria-label="Open profile menu"
                  aria-expanded={profileOpen}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-secondary">
                    {profileInitial}
                  </span>
                  <ChevronDown size={12} className={`hidden transition-transform sm:block ${profileOpen ? "rotate-180" : ""}`} />
                </button>

                {profileOpen && (
                  <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl border border-default bg-elevated shadow-2xl">
                    <div className="border-b border-subtle px-4 py-3">
                      <p className="truncate text-[13px] font-semibold text-fg-primary">{profile?.display_name || profile?.username || "Account"}</p>
                      <p className="mt-0.5 truncate text-[10px] text-fg-muted">{profile?.email || "CMS account"}</p>
                      <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-primary">{profile?.role || "member"}</p>
                    </div>
                    <div className="p-1.5">
                      <Link
                        href="/admin/profile"
                        onClick={() => setProfileOpen(false)}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[12px] font-medium text-fg-secondary no-underline transition hover:bg-surface-2 hover:text-fg-primary"
                      >
                        <Settings size={14} />
                        Profile & Settings
                      </Link>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[12px] font-medium text-fg-secondary transition hover:bg-danger-muted hover:text-danger"
                      >
                        <LogOut size={14} />
                        Log out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[1540px] px-5 py-7 md:px-10 md:py-9">{children}</div>
          </main>
        </div>
      </div>

      {mobileOpen && (
        <>
          <button aria-label="Close navigation" className="fixed inset-0 z-[100] bg-field5 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-[101] flex w-[270px] flex-col overflow-y-auto border-r border-subtle bg-sidebar md:hidden">
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <Link href="/admin/cms" className="flex items-center gap-2.5 no-underline" onClick={() => setMobileOpen(false)}>
                <Diamond size={14} className="text-action" />
                <span className="font-headline text-[13px] font-bold text-fg-primary">POLYNOVEA CMS</span>
              </Link>
              <button className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg-primary" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X size={18} />
              </button>
            </div>
            <NavTree mobile />
            <div className="mt-auto border-t border-subtle p-3">
              <Link href="/admin/profile" onClick={() => setMobileOpen(false)} className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-fg-muted no-underline hover:bg-surface-2 hover:text-fg-primary">
                <Settings size={15} /><span>Profile & Settings</span>
              </Link>
              <button onClick={handleLogout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] text-fg-muted hover:bg-danger-muted hover:text-danger">
                <LogOut size={15} /><span>Log out</span>
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
