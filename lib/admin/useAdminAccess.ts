"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserIdentityProvider } from "@/lib/auth/supabaseProvider";
import type { AdminUser } from "@/lib/admin/types";

export function useAdminAccess() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AdminUser | null>(null);
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
        const json = res.ok ? await res.json() : null;
        setProfile(json?.data ?? null);
      } catch {
        setProfile(null);
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
    refresh,
  };
}
