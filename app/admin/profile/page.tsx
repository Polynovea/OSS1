"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, KeyRound, LockKeyhole, Save, ShieldCheck, UserRound } from "lucide-react";
import AdminLayout from "@/components/admin/AdminLayout";
import { useAdminAccess } from "@/lib/admin/useAdminAccess";
import { getSupabaseBrowserIdentityProvider } from "@/lib/auth/supabaseProvider";

async function getAccessToken(fallback?: string | null) {
  if (fallback) return fallback;
  const { session } = await getSupabaseBrowserIdentityProvider().getSession();
  return session?.access_token ?? null;
}

export default function ProfilePage() {
  const { profile, session, refresh } = useAdminAccess();
  const [displayName, setDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    setDisplayName(profile?.display_name || profile?.username || "");
  }, [profile?.display_name, profile?.username]);

  const initials = useMemo(() => {
    const source = profile?.display_name || profile?.username || "U";
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";
  }, [profile?.display_name, profile?.username]);

  const updateMe = async (payload: Record<string, string>) => {
    const token = await getAccessToken(session?.access_token);
    if (!token) throw new Error("Session expired. Please sign in again.");

    const response = await fetch("/api/admin/me", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json();
    if (!response.ok || !body.success) throw new Error(body.error || "Could not update profile");
    return body.data;
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileMessage(null);
    const value = displayName.trim();
    if (!value) {
      setProfileMessage({ type: "error", text: "Display name cannot be empty." });
      return;
    }

    setSavingProfile(true);
    try {
      await updateMe({ display_name: value });
      refresh();
      setProfileMessage({ type: "success", text: "Profile updated." });
    } catch (error) {
      setProfileMessage({ type: "error", text: error instanceof Error ? error.message : "Could not update profile." });
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordMessage(null);

    if (newPassword.length < 8) {
      setPasswordMessage({ type: "error", text: "Password must be at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: "error", text: "The passwords do not match." });
      return;
    }

    setSavingPassword(true);
    try {
      await updateMe({ password: newPassword });
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage({ type: "success", text: "Password updated." });
    } catch (error) {
      setPasswordMessage({ type: "error", text: error instanceof Error ? error.message : "Could not update password." });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-6xl">
        <header className="ui-page-header">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-fg-muted">
              <span>Account</span><span className="opacity-40">/</span><span className="text-primary">Profile</span>
            </div>
            <h1 className="font-headline text-[32px] font-extrabold leading-none tracking-[-0.02em] text-on-surface">PROFILE & SETTINGS</h1>
            <p className="mt-1 font-body text-[13px] text-fg-muted">Manage your identity, password, and review the access attached to this account.</p>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="lg:col-span-4">
            <div className="border-t border-subtle pt-5">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-subtle bg-surface-2 font-headline text-xl font-bold text-fg-primary">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-fg-primary">{profile?.display_name || profile?.username || "Account"}</p>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">{profile?.role || "member"}</p>
                </div>
              </div>

              <div className="mt-6 space-y-4 border-t border-subtle pt-5">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-fg-muted">Username</p>
                  <p className="mt-1 text-[13px] text-fg-primary">{profile?.username || "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-fg-muted">Email</p>
                  <p className="mt-1 break-all text-[13px] text-fg-primary">{profile?.email || session?.user.email || "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-fg-muted">Account status</p>
                  <p className="mt-1 flex items-center gap-2 text-[13px] text-success"><Check size={13} /> Active</p>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-subtle bg-surface-1 p-4 text-[11px] leading-5 text-fg-muted">
                Username, email, role, and permissions are account-control fields. They are intentionally not editable from self-service profile settings.
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-7 lg:col-span-8">
            <section className="border-t border-subtle pt-5">
              <div className="mb-5 flex items-center gap-3">
                <UserRound size={16} className="text-primary" />
                <div>
                  <h2 className="text-sm font-semibold text-fg-primary">Personal information</h2>
                  <p className="text-[11px] text-fg-muted">This name is shown in the CMS header, activity surfaces, and collaboration UI.</p>
                </div>
              </div>

              <form onSubmit={saveProfile} className="max-w-xl space-y-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-fg-muted">Display name</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={80}
                    autoComplete="name"
                    className="w-full rounded-xl border border-subtle bg-surface-1 px-4 py-3 text-sm text-fg-primary outline-none transition focus:border-primary/50"
                    placeholder="Your display name"
                  />
                </label>

                <div className="flex items-center gap-3">
                  <button type="submit" disabled={savingProfile} className="ui-btn ui-btn-primary">
                    <Save size={13} />
                    {savingProfile ? "Saving..." : "Save profile"}
                  </button>
                  {profileMessage && (
                    <p className={`text-[11px] ${profileMessage.type === "success" ? "text-success" : "text-danger"}`}>{profileMessage.text}</p>
                  )}
                </div>
              </form>
            </section>

            <section className="border-t border-subtle pt-5">
              <div className="mb-5 flex items-center gap-3">
                <KeyRound size={16} className="text-primary" />
                <div>
                  <h2 className="text-sm font-semibold text-fg-primary">Security</h2>
                  <p className="text-[11px] text-fg-muted">Change the password for your current CMS account.</p>
                </div>
              </div>

              <form onSubmit={savePassword} className="max-w-xl space-y-4">
                <label className="block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-fg-muted">New password</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-subtle bg-surface-1 px-4 py-3 text-sm text-fg-primary outline-none transition focus:border-primary/50"
                    placeholder="At least 8 characters"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-fg-muted">Confirm password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-subtle bg-surface-1 px-4 py-3 text-sm text-fg-primary outline-none transition focus:border-primary/50"
                    placeholder="Repeat the new password"
                  />
                </label>

                <div className="flex items-center gap-3">
                  <button type="submit" disabled={savingPassword || !newPassword || !confirmPassword} className="ui-btn ui-btn-primary">
                    <LockKeyhole size={13} />
                    {savingPassword ? "Updating..." : "Update password"}
                  </button>
                  {passwordMessage && (
                    <p className={`text-[11px] ${passwordMessage.type === "success" ? "text-success" : "text-danger"}`}>{passwordMessage.text}</p>
                  )}
                </div>
              </form>
            </section>

            <section className="border-t border-subtle pt-5">
              <div className="mb-5 flex items-center gap-3">
                <ShieldCheck size={16} className="text-primary" />
                <div>
                  <h2 className="text-sm font-semibold text-fg-primary">Access summary</h2>
                  <p className="text-[11px] text-fg-muted">A read-only view of what this account can use.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-subtle bg-surface-1 p-4">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-fg-muted">Surfaces</p>
                  <p className="mt-2 text-2xl font-bold text-fg-primary">{profile?.role === "master" ? "All" : profile?.surface_access.length ?? 0}</p>
                </div>
                <div className="rounded-xl border border-subtle bg-surface-1 p-4">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-fg-muted">Readable modules</p>
                  <p className="mt-2 text-2xl font-bold text-fg-primary">{profile?.role === "master" ? "All" : profile?.module_access.length ?? 0}</p>
                </div>
                <div className="rounded-xl border border-subtle bg-surface-1 p-4">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-fg-muted">Writable modules</p>
                  <p className="mt-2 text-2xl font-bold text-fg-primary">{profile?.role === "master" ? "All" : profile?.module_write_access.length ?? 0}</p>
                </div>
              </div>

              {profile?.role === "master" && (
                <div className="mt-4 text-[11px] text-fg-muted">
                  Team access is managed separately in <Link href="/admin/access" className="font-medium text-action no-underline hover:text-link-hover">Access Control</Link>.
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
