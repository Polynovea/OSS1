"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserIdentityProvider } from "@/lib/auth/supabaseProvider";
import type { AdminUser } from "@/lib/admin/types";

export function useAdminAccess() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AdminUser | null>(null);
  const [accessError, setAccessError] = useState("");
  const [checked, setChecked] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    const identity = getSupabaseBrowserIdentityProvider();
    const resolveProfile = async (nextSession: Session | null) => {
      setSession(nextSession);

      if (!nextSession) {
        setProfile(null);
        setAccessError("");
        setChecked(true);
        return;
      }

      try {
        const res = await fetch("/api/admin/me", {
          headers: {
            Authorization: `Bearer ${nextSession.access_token}`,
            "Content-Type": "application/json",
          },
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setProfile(null);
          setAccessError(
            res.status === 403
              ? "Your credentials are valid, but this account has not been granted CMS access. Ask an owner to provision or activate it."
              : (json?.error || "Could not verify CMS access."),
          );
          return;
        }
        setProfile(json?.data ?? null);
        setAccessError("");
      } catch {
        setProfile(null);
        setAccessError("Could not verify CMS access. Please try again.");
      } finally {
        setChecked(true);
      }
    };

    identity.getSession().then(({ session: nextSession, error }) => {
      if (error) {
        // Stale or revoked refresh token — clear local session and force re-login
        void identity.signOut();
        setSession(null);
        setProfile(null);
        setAccessError("");
        setChecked(true);
        return;
      }
      resolveProfile(nextSession);
    });

    const subscription = identity.onSessionChange((nextSession) => {
      resolveProfile(nextSession);
    });

    return () => subscription.unsubscribe();
  }, [refreshKey]);

  return {
    session,
    profile,
    checked,
    allowed: Boolean(session && profile),
    accessError,
    refresh,
  };
}
