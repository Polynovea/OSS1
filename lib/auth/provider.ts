import type { Session, User } from "@supabase/supabase-js";

/**
 * Provider boundary for identity. CMS authorization deliberately remains
 * outside this interface: an external identity is resolved to admin_user,
 * workspace membership, roles, permissions and model policy by platform code.
 */
export interface BrowserIdentityProvider {
  signInWithPassword(input: { email: string; password: string }): Promise<{ session: Session | null; error: Error | null }>;
  getSession(): Promise<{ session: Session | null; error: Error | null }>;
  refreshSession(): Promise<{ session: Session | null; error: Error | null }>;
  signOut(): Promise<{ error: Error | null }>;
  onSessionChange(listener: (session: Session | null) => void): { unsubscribe(): void };
}

export interface ServerIdentityProvider {
  verifyBearerToken(token: string): Promise<{ user: User | null; error: Error | null }>;
  createUser(input: { email: string; password: string; emailConfirmed: boolean; metadata?: Record<string, unknown> }): Promise<{ user: User | null; error: Error | null }>;
  updateUser(id: string, input: { password?: string; metadata?: Record<string, unknown> }): Promise<{ error: Error | null }>;
  deleteUser(id: string): Promise<{ error: Error | null }>;
}
