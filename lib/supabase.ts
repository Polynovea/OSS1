import { createClient } from "@supabase/supabase-js";

export type SupabaseBrowserConfig = {
  url: string;
  anonKey: string;
};

/**
 * Browser configuration is deliberately explicit.  An OSS checkout must never
 * silently send browser traffic to a project owned by somebody else.
 */
export function getSupabaseBrowserConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SupabaseBrowserConfig | null {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const anonKey = environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  return url && anonKey ? { url, anonKey } : null;
}

const browserConfig = getSupabaseBrowserConfig();
const supabaseUrl = browserConfig?.url || "";
const supabaseAnonKey = browserConfig?.anonKey || "";

export const hasSupabaseConfig = Boolean(browserConfig);

function createMissingConfigProxy() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(
          "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        );
      },
    },
  );
}

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (createMissingConfigProxy() as ReturnType<typeof createClient>);

export { supabaseUrl };
