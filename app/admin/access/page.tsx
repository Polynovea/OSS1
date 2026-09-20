"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, KeyRound, Loader2, Shield, Trash2, UserCog, UserPlus } from "lucide-react";
import AdminLayout from "@/components/admin/AdminLayout";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import Modal from "@/components/admin/Modal";
import Toast, { showToast } from "@/components/admin/Toast";
import { ACCESS_MODULES, SURFACE_LABELS, type AdminModule, type AdminSurface } from "@/lib/admin/access";
import { getAccessToken } from "@/lib/admin/authCheck";
import { useAdminAccess } from "@/lib/admin/useAdminAccess";
import type { AdminActivityLog, AdminRole, AdminUser } from "@/lib/admin/types";
import { Check } from "lucide-react";

type UserFormState = {
  username: string;
  email: string;
  display_name: string;
  password: string;
  role: AdminRole;
  is_active: boolean;
  surface_access: AdminSurface[];
  module_access: AdminModule[];
  module_write_access: AdminModule[];
};

const ROLE_OPTIONS: { value: AdminRole; label: string; description: string }[] = [
  { value: "master", label: "Master", description: "Full control over CMS, Content, and access." },
  { value: "admin", label: "Admin", description: "Broad operational control with assigned modules." },
  { value: "editor", label: "Editor", description: "Can edit assigned modules and review audit trails." },
  { value: "viewer", label: "Viewer", description: "Read-only visibility for assigned modules." },
];

const ROLE_COLORS: Record<AdminRole, string> = {
  master: "border-primary/30 bg-primary/10 text-primary",
  admin: "border-info bg-info-muted text-info",
  editor: "border-review bg-review-muted text-review",
  viewer: "border-default bg-surface-2/50 text-fg-secondary",
};

const SURFACES: AdminSurface[] = ["cms", "content"];

function emptyForm(): UserFormState {
  return {
    username: "",
    email: "",
    display_name: "",
    password: "",
    role: "viewer",
    is_active: true,
    surface_access: ["cms"],
    module_access: ["cms.overview"],
    module_write_access: [],
  };
}

function toFormState(user: AdminUser): UserFormState {
  return {
    username: user.username,
    email: user.email,
    display_name: user.display_name || "",
    password: "",
    role: user.role,
    is_active: user.is_active,
    surface_access: user.surface_access as AdminSurface[],
    module_access: user.module_access as AdminModule[],
    module_write_access: user.module_write_access as AdminModule[],
  };
}

function authHeaders(token?: string | null) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function resolveAccessToken(fallback?: string | null) {
  const liveToken = await getAccessToken();
  return liveToken || fallback || null;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function summarizeActivity(log: AdminActivityLog) {
  const label = log.target_label || log.target_type;
  switch (log.action) {
    case "member.create":
      return `Created ${label}`;
    case "member.update":
      return `Updated ${label}`;
    case "member.update_with_password_reset":
      return `Updated ${label} and reset password`;
    case "member.delete":
      return `Deleted ${label}`;
    default:
      return `${log.action.split("_").join(" ")} • ${label}`;
  }
}

function PermissionEditor({
  form,
  setForm,
  disableIdentity,
}: {
  form: UserFormState;
  setForm: React.Dispatch<React.SetStateAction<UserFormState>>;
  disableIdentity?: boolean;
}) {
  const fieldLabel = "text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-muted mb-1.5";
  const inputBase = "w-full rounded-lg border border-default bg-field px-3 py-2.5 text-sm text-fg-primary outline-none transition-colors focus:border-action placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-40";
  const canWrite = form.role !== "viewer";

  const toggleSurface = (surface: AdminSurface) => {
    setForm((current) => {
      const enabling = !current.surface_access.includes(surface);
      let surface_access = enabling
        ? [...current.surface_access, surface]
        : current.surface_access.filter((item) => item !== surface);

      if (!surface_access.length) {
        surface_access = [surface];
      }

      let module_access = current.module_access.filter((module) => {
        const [moduleSurface] = module.split(".") as [AdminSurface, string];
        return surface_access.includes(moduleSurface);
      });

      let module_write_access = current.module_write_access.filter((module) => {
        const [moduleSurface] = module.split(".") as [AdminSurface, string];
        return surface_access.includes(moduleSurface);
      });

      if (enabling) {
        const overviewModule = `${surface}.overview` as AdminModule;
        if (!module_access.includes(overviewModule)) {
          module_access = [...module_access, overviewModule];
        }
      }

      if (!canWrite) {
        module_write_access = [];
      }

      return { ...current, surface_access, module_access, module_write_access };
    });
  };

  const toggleReadModule = (module: AdminModule) => {
    setForm((current) => {
      const hasRead = current.module_access.includes(module);
      const module_access = hasRead
        ? current.module_access.filter((item) => item !== module)
        : [...current.module_access, module];
      const module_write_access = hasRead
        ? current.module_write_access.filter((item) => item !== module)
        : current.module_write_access;
      return { ...current, module_access, module_write_access };
    });
  };

  const toggleWriteModule = (module: AdminModule) => {
    if (!canWrite) return;
    setForm((current) => {
      const hasRead = current.module_access.includes(module);
      const hasWrite = current.module_write_access.includes(module);
      return {
        ...current,
        module_access: hasRead ? current.module_access : [...current.module_access, module],
        module_write_access: hasWrite
          ? current.module_write_access.filter((item) => item !== module)
          : [...current.module_write_access, module],
      };
    });
  };

  const handleRoleChange = (role: AdminRole) => {
    setForm((current) => ({
      ...current,
      role,
      module_write_access: role === "viewer" ? [] : current.module_write_access,
    }));
  };

  const selectedRole = ROLE_OPTIONS.find((r) => r.value === form.role);

  return (
    <div className="flex flex-col gap-6">

      {/* ── Identity row ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={fieldLabel}>Username</label>
          <input
            className={inputBase}
            value={form.username}
            disabled={disableIdentity}
            onChange={(e) => setForm((c) => ({ ...c, username: e.target.value.toLowerCase() }))}
            placeholder="username"
          />
        </div>
        <div>
          <label className={fieldLabel}>Email</label>
          <input
            className={inputBase}
            type="email"
            value={form.email}
            disabled={disableIdentity}
            onChange={(e) => setForm((c) => ({ ...c, email: e.target.value.toLowerCase() }))}
            placeholder="member@example.com"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={fieldLabel}>Display Name</label>
          <input
            className={inputBase}
            value={form.display_name}
            onChange={(e) => setForm((c) => ({ ...c, display_name: e.target.value }))}
            placeholder="Full name"
          />
        </div>
        <div>
          <label className={fieldLabel}>Role</label>
          <div className="relative">
            <select
              className={`${inputBase} bg-field appearance-none pr-10 cursor-pointer`}
              value={form.role}
              onChange={(e) => handleRoleChange(e.target.value as AdminRole)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
          {selectedRole && (
            <p className="mt-2 text-[11px] text-fg-muted">{selectedRole.description}</p>
          )}
        </div>
      </div>

      <div>
        <label className={fieldLabel}>{disableIdentity ? "Reset Password (leave blank to keep current)" : "Temporary Password"}</label>
        <input
          className={inputBase}
          type="password"
          value={form.password}
          onChange={(e) => setForm((c) => ({ ...c, password: e.target.value }))}
          placeholder={disableIdentity ? "••••••••" : "Set first login password"}
        />
      </div>

      {/* ── Surface Access ── */}
      <div className="rounded-2xl border border-subtle/80 bg-surface-1 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-subtle/60 px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-secondary">Surface Access</p>
            <p className="mt-0.5 text-[11px] text-fg-muted">Controls which top-level surfaces this user can enter.</p>
          </div>
          <button
            type="button"
            onClick={() => setForm((c) => ({ ...c, is_active: !c.is_active }))}
            className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors ${
              form.is_active
                ? "border-success bg-success-muted text-success"
                : "border-default bg-surface-2/50 text-fg-muted"
            }`}
          >
            {form.is_active ? "Active" : "Inactive"}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-zinc-800/60">
          {SURFACES.map((surface) => {
            const active = form.surface_access.includes(surface);
            return (
              <button
                key={surface}
                type="button"
                onClick={() => toggleSurface(surface)}
                className={`flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors ${
                  active ? "bg-primary/6 text-primary" : "text-fg-muted hover:bg-surface-2"
                }`}
              >
                <div>
                  <p className={`text-sm font-semibold ${active ? "text-primary" : "text-fg-secondary"}`}>
                    {SURFACE_LABELS[surface]}
                  </p>
                  <p className="mt-0.5 text-[11px] text-fg-muted">Enable in gateway and sidebar.</p>
                </div>
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  active ? "border-primary bg-primary text-background" : "border-default bg-transparent"
                }`}>
                  {active && <Check size={11} strokeWidth={2.5} />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Module Controls ── */}
      <div className="rounded-2xl border border-subtle/80 bg-surface-1 overflow-hidden">
        <div className="border-b border-subtle/60 px-5 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-secondary">Module Controls</p>
          <p className="mt-0.5 text-[11px] text-fg-muted">Read = visibility. Write = editing and destructive actions.</p>
        </div>
        <div className="flex flex-col divide-y divide-zinc-800/40">
          {SURFACES.filter((surface) => form.surface_access.includes(surface)).map((surface) => (
            <div key={surface}>
              {/* Surface sub-header */}
              <div className="grid grid-cols-[1fr_80px_80px] gap-3 bg-surface-1 px-5 py-2.5 items-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-fg-muted">{SURFACE_LABELS[surface]}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-fg-muted text-center">Read</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-fg-muted text-center">Write</p>
              </div>
              {/* Module rows */}
              {ACCESS_MODULES.filter((m) => m.surface === surface).map((module, idx, arr) => {
                const hasRead = form.module_access.includes(module.key);
                const hasWrite = form.module_write_access.includes(module.key);
                return (
                  <div
                    key={module.key}
                    className={`grid grid-cols-[1fr_80px_80px] gap-3 px-5 items-center py-3.5 transition-colors ${
                      idx < arr.length - 1 ? "border-b border-subtle/30" : ""
                    } ${hasRead ? "bg-primary/[0.03]" : ""}`}
                  >
                    <div>
                      <p className={`text-sm font-medium ${hasRead ? "text-fg-primary" : "text-fg-secondary"}`}>
                        {module.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-fg-muted">{module.description}</p>
                    </div>
                    {/* Read toggle */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => toggleReadModule(module.key)}
                        className={`relative h-6 w-11 rounded-full border transition-colors ${
                          hasRead
                            ? "border-primary/40 bg-primary/20"
                            : "border-default bg-surface-2/50"
                        }`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                          hasRead
                            ? "left-[calc(100%-18px)] bg-primary"
                            : "left-0.5 bg-zinc-600"
                        }`} />
                      </button>
                    </div>
                    {/* Write toggle */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => toggleWriteModule(module.key)}
                        disabled={!canWrite}
                        className={`relative h-6 w-11 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                          hasWrite
                            ? "border-primary/40 bg-primary/20"
                            : "border-default bg-surface-2/50"
                        }`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                          hasWrite
                            ? "left-[calc(100%-18px)] bg-primary"
                            : "left-0.5 bg-zinc-600"
                        }`} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AccessPage() {
  const { profile, checked, session } = useAdminAccess();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activity, setActivity] = useState<AdminActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [canCreateAuthUsers, setCanCreateAuthUsers] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createForm, setCreateForm] = useState<UserFormState>(emptyForm());
  const [editForm, setEditForm] = useState<UserFormState>(emptyForm());
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => {
      if (a.role === "master" && b.role !== "master") return -1;
      if (a.role !== "master" && b.role === "master") return 1;
      return a.username.localeCompare(b.username);
    }),
    [users],
  );

  const stats = useMemo(() => {
    const active = users.filter((u) => u.is_active).length;
    const writers = users.filter((u) => u.role !== "viewer" && u.module_write_access.length > 0).length;
    const contentUsers = users.filter((u) => u.surface_access.includes("content")).length;
    return { total: users.length, active, writers, contentUsers };
  }, [users]);

  const loadUsers = async () => {
    const accessToken = await resolveAccessToken(session?.access_token);
    if (!accessToken) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let response = await fetch("/api/admin/users", { headers: authHeaders(accessToken) });
      let json = await response.json();
      if (!response.ok && json?.error === "Invalid session") {
        const retryToken = await resolveAccessToken();
        if (retryToken && retryToken !== accessToken) {
          response = await fetch("/api/admin/users", { headers: authHeaders(retryToken) });
          json = await response.json();
        }
      }
      if (!json.success) throw new Error(json.error || "Failed to load users");
      setUsers(json.data || []);
      setActivity(json.meta?.activity || []);
      setCanCreateAuthUsers(Boolean(json.meta?.canCreateAuthUsers));
      setMetaLoaded(true);
    } catch (error: any) {
      showToast(error.message || "Failed to load access list", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (checked && session?.access_token) {
      loadUsers();
    }
  }, [checked, session?.access_token]);

  const handleCreate = async () => {
    const accessToken = await resolveAccessToken(session?.access_token);
    if (!accessToken) {
      showToast("Session expired. Please sign in again.", "error");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify(createForm),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error || "Failed to create access profile");
      showToast(json.meta?.note || "Access profile created.", "success");
      setCreateOpen(false);
      setCreateForm(emptyForm());
      await loadUsers();
    } catch (error: any) {
      showToast(error.message || "Failed to create access profile", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedUser) return;
    const accessToken = await resolveAccessToken(session?.access_token);
    if (!accessToken) {
      showToast("Session expired. Please sign in again.", "error");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: authHeaders(accessToken),
        body: JSON.stringify(editForm),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error || "Failed to update member");
      showToast("Access updated.", "success");
      setEditOpen(false);
      setSelectedUser(null);
      await loadUsers();
    } catch (error: any) {
      showToast(error.message || "Failed to update member", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedUser) return;
    const accessToken = await resolveAccessToken(session?.access_token);
    if (!accessToken) {
      showToast("Session expired. Please sign in again.", "error");
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/users/${selectedUser.id}`, {
        method: "DELETE",
        headers: authHeaders(accessToken),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error || "Failed to delete member");
      showToast("Member removed from access and auth.", "success");
      setDeleteOpen(false);
      setEditOpen(false);
      setSelectedUser(null);
      await loadUsers();
    } catch (error: any) {
      showToast(error.message || "Failed to delete member", "error");
    } finally {
      setDeleting(false);
    }
  };

  const openEditor = (user: AdminUser) => {
    setSelectedUser(user);
    setEditForm(toFormState(user));
    setEditOpen(true);
  };

  const openDelete = (user: AdminUser) => {
    setSelectedUser(user);
    setDeleteOpen(true);
  };

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">

        {/* ── Header ── */}
        <header className="ui-page-header">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-fg-muted">
              <span>Admin</span><span className="opacity-40">/</span><span className="text-primary">Access</span>
            </div>
            <h1 className="font-headline font-extrabold text-[32px] text-on-surface tracking-[-0.02em] leading-none">ACCESS CONTROL</h1>
            <p className="mt-1 font-body text-[13px] text-fg-muted">Manage team credentials, module visibility, and write permissions.</p>
          </div>
          <button
            className="ui-btn ui-btn-primary"
            onClick={() => setCreateOpen(true)}
            disabled={!canCreateAuthUsers}
          >
            <UserPlus size={13} />
            New Member
          </button>
        </header>

        {/* ── 12-col grid ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">

          {/* ── Left: 8 cols ── */}
          <div className="flex flex-col gap-5 lg:col-span-8">

            {/* Metric strip */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-subtle py-6 md:grid-cols-4">
              {[
                { label: "Members", value: stats.total, color: "text-fg-primary" },
                { label: "Active", value: stats.active, color: "text-success" },
                { label: "Writers", value: stats.writers, color: "text-fg-primary" },
                { label: "In Content", value: stats.contentUsers, color: "text-fg-primary" },
              ].map(({ label, value, color }) => (
                <div key={label} className="min-w-0 border-r border-subtle pr-4 last:border-r-0">
                  <p className="font-body text-[10px] font-bold uppercase tracking-widest text-fg-muted mb-1">{label}</p>
                  <p className={`font-headline text-[28px] font-bold leading-none ${color}`}>
                    {loading ? "—" : value}
                  </p>
                </div>
              ))}
            </div>

            {/* Member table */}
            <div className="relative min-h-[400px] overflow-x-auto border-y border-subtle">
              <div className="min-w-[640px]">
              {/* Table header */}
              <div className="relative grid grid-cols-[40px_1fr_96px_150px_100px] items-center gap-4 border-b border-subtle bg-surface-2 px-6 py-3.5">
                <div />
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted">Member</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted">Role</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted">Access</p>
                <p className="text-right text-[10px] font-bold uppercase tracking-[0.12em] text-fg-muted">Actions</p>
              </div>

              {loading ? (
                <div className="flex min-h-[320px] items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-fg-muted" />
                </div>
              ) : sortedUsers.length === 0 ? (
                <div className="relative flex min-h-[320px] flex-col items-center justify-center gap-5 px-8 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-subtle bg-field">
                    <Shield size={24} className="text-primary/60" />
                  </div>
                  <div>
                    <p className="font-body text-sm font-semibold text-fg-primary">No team members yet</p>
                    <p className="mt-1.5 font-body text-xs text-fg-muted max-w-[300px]">
                      Create a member to provision Supabase Auth credentials and link their access profile in one action.
                    </p>
                  </div>
                  {canCreateAuthUsers ? (
                    <button
                      onClick={() => setCreateOpen(true)}
                      className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary transition-colors hover:bg-primary/12 active:scale-95"
                    >
                      <UserPlus size={13} />
                      Create First Member
                    </button>
                  ) : metaLoaded ? (
                    <p className="text-[11px] text-fg-muted max-w-[280px]">Auth creation requires the service role key to be configured.</p>
                  ) : null}
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {sortedUsers.map((user) => (
                    <div
                      key={user.id || user.email}
                      className="grid grid-cols-[40px_1fr_96px_150px_100px] items-center gap-4 px-6 py-4 transition-colors hover:bg-surface-2"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-subtle bg-surface-2 text-[11px] font-bold text-fg-secondary">
                        {(user.display_name || user.username).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-fg-primary">{user.display_name || user.username}</p>
                          {!user.is_active && (
                            <span className="shrink-0 rounded-full border border-default bg-surface-2 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-fg-secondary">Inactive</span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-fg-muted">@{user.username} · {user.email}</p>
                      </div>
                      <div>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${ROLE_COLORS[user.role]}`}>
                          {user.role}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap gap-1">
                          {user.surface_access.map((s) => (
                            <span key={`${user.id}-${s}`} className="rounded border border-subtle bg-field px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-fg-secondary">
                              {SURFACE_LABELS[s as AdminSurface] || s}
                            </span>
                          ))}
                        </div>
                        <p className="text-[10px] text-fg-muted">{user.module_write_access.length}w · {user.module_access.length}r modules</p>
                      </div>
                      <div className="flex justify-end gap-1.5">
                        {user.role === "master" ? (
                          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-fg-muted">Locked</span>
                        ) : (
                          <>
                            <button onClick={() => openEditor(user)} className="rounded-lg border border-subtle px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-fg-secondary transition-colors hover:border-primary/40 hover:text-primary">Edit</button>
                            <button onClick={() => openDelete(user)} className="rounded-lg border border-danger bg-danger-muted px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-danger transition-colors hover:border-danger hover:text-danger">Del</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </div>
          </div>

          {/* ── Right: 4 cols ── */}
          <div className="flex flex-col gap-5 lg:col-span-4">

            {/* System Monitor */}
            <div className="border-t border-subtle pt-4">
              <div className="flex items-center justify-between pb-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">System Monitor</p>
                <UserCog size={14} className="text-fg-muted" />
              </div>
              <div className="p-4">
                {/* Master user card */}
                <div className="relative flex items-center gap-3 border-t border-subtle py-3">
                  <div className="absolute bottom-0 left-0 top-0 w-[2px] bg-review" />
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-subtle bg-surface-1 text-[12px] font-bold text-fg-secondary">
                    {(profile?.display_name || profile?.username || "SR").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg-primary">{profile?.display_name || profile?.username || "Master"}</p>
                    <p className="text-[11px] text-review">Active Master</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <p className="text-[9px] uppercase tracking-wider text-fg-muted">Auth</p>
                    {!metaLoaded ? (
                      <span className="rounded border border-default bg-surface-2 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-fg-muted">...</span>
                    ) : canCreateAuthUsers ? (
                      <span className="flex items-center gap-1 rounded border border-success bg-surface-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-success">
                        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />Live
                      </span>
                    ) : (
                      <span className="rounded border border-default bg-surface-2 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-fg-muted">Off</span>
                    )}
                  </div>
                </div>
                {profile?.email && (
                  <p className="mt-2.5 truncate text-[11px] text-fg-muted px-1">{profile.email}</p>
                )}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="flex flex-1 flex-col border-t border-subtle pt-4">
              <div className="flex items-center justify-between pb-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-fg-muted">Recent Activity</p>
                <Activity size={14} className="text-fg-muted" />
              </div>

              {activity.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-subtle">
                    <span className="h-2 w-2 animate-ping rounded-full bg-fg-muted" />
                  </div>
                  <p className="font-body text-[13px] italic text-fg-muted">No activity logged yet.</p>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                  {activity.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-primary/8">
                        <Activity size={9} className="text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold leading-snug text-fg-primary">{summarizeActivity(log)}</p>
                        <p className="mt-0.5 text-[10px] text-fg-muted">{log.actor_username || log.actor_email || "system"} · {formatTimestamp(log.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="Create Member Access" maxWidth="980px">
        <PermissionEditor form={createForm} setForm={setCreateForm} />
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-subtle pt-5">
          <button
            onClick={() => setCreateOpen(false)}
            className="ui-btn ui-btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="ui-btn ui-btn-primary disabled:opacity-60"
          >
            {saving ? "Saving..." : "Create Access"}
          </button>
        </div>
      </Modal>

      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Edit Member Access" maxWidth="980px">
        <PermissionEditor form={editForm} setForm={setEditForm} disableIdentity={Boolean(selectedUser?.role === "master")} />
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-subtle pt-5">
          <div className="text-xs text-fg-muted">
            {selectedUser ? `Editing ${selectedUser.display_name || selectedUser.username}` : "No member selected"}
          </div>
          <div className="flex items-center gap-3">
            {selectedUser && selectedUser.role !== "master" ? (
              <button
                onClick={() => openDelete(selectedUser)}
                className="flex items-center gap-2 rounded-xl border border-danger bg-danger-muted px-4 py-3 text-[12px] font-bold uppercase tracking-[0.08em] text-danger"
              >
                <Trash2 size={14} />
                Delete Member
              </button>
            ) : null}
            <button
              onClick={() => setEditOpen(false)}
              className="ui-btn ui-btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleEdit}
              disabled={saving}
              className="ui-btn ui-btn-primary disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Access"}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Delete Member"
        message={selectedUser
          ? `Delete ${selectedUser.display_name || selectedUser.username} from both admin access and Supabase Auth? This removes their login and cannot be undone.`
          : "Delete this member from admin access and Supabase Auth?"}
        confirmText="Delete Member"
      />

      <Toast />
    </AdminLayout>
  );
}
