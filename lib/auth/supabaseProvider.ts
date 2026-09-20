import type { User } from "@supabase/supabase-js";
import type { BrowserIdentityProvider, ServerIdentityProvider } from "@/lib/auth/provider";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { supabase } from "@/lib/supabase";

const toError = (error: { message: string } | null): Error | null => error ? new Error(error.message) : null;

/** Current first-class identity adapter. It is intentionally named rather
 * than hidden so unsupported providers are never mistaken for working ones. */
export function getSupabaseBrowserIdentityProvider(): BrowserIdentityProvider {
  return {
    async signInWithPassword(input) {
      const { data, error } = await supabase.auth.signInWithPassword(input);
      return { session: data.session, error: toError(error) };
    },
    async getSession() {
      const { data, error } = await supabase.auth.getSession();
      return { session: data.session, error: toError(error) };
    },
    async refreshSession() {
      const { data, error } = await supabase.auth.refreshSession();
      return { session: data.session, error: toError(error) };
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      return { error: toError(error) };
    },
    onSessionChange(listener) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => listener(session));
      return { unsubscribe: () => subscription.unsubscribe() };
    },
  };
}

export function getSupabaseServerIdentityProvider(): ServerIdentityProvider {
  const client = createServiceRoleClient();
  return {
    async verifyBearerToken(token) {
      const { data, error } = await client.auth.getUser(token);
      return { user: (data.user as User | null) ?? null, error: toError(error) };
    },
    async createUser(input) {
      const { data, error } = await client.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: input.emailConfirmed,
        user_metadata: input.metadata,
      });
      return { user: (data.user as User | null) ?? null, error: toError(error) };
    },
    async updateUser(id, input) {
      const { error } = await client.auth.admin.updateUserById(id, {
        ...(input.password ? { password: input.password } : {}),
        ...(input.metadata ? { user_metadata: input.metadata } : {}),
      });
      return { error: toError(error) };
    },
    async deleteUser(id) {
      const { error } = await client.auth.admin.deleteUser(id);
      return { error: toError(error) };
    },
  };
}
