"use client";

import { getSupabaseBrowserIdentityProvider } from "@/lib/auth/supabaseProvider";

const identity = getSupabaseBrowserIdentityProvider();

export async function isAuthenticated(): Promise<boolean> {
  const { session, error } = await identity.getSession();
  if (error) return false;
  return !!session;
}

export async function login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await identity.signInWithPassword({ email, password });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function logout(): Promise<void> {
  await identity.signOut();
}

export async function getAccessToken(): Promise<string | null> {
  const { session, error } = await identity.getSession();
  if (error || !session) return null;

  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (expiresAt < Date.now() + 30_000) {
    const { session: refreshedSession } = await identity.refreshSession();
    return refreshedSession?.access_token ?? null;
  }

  return session.access_token ?? null;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}
