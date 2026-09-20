import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase";

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function getServiceRoleKey(): string {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  return raw ? stripWrappingQuotes(raw) : "";
}

export function hasServiceRoleKey(): boolean {
  return Boolean(getServiceRoleKey());
}

export function createServiceRoleClient() {
  const serviceRoleKey = getServiceRoleKey();
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!supabaseUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Configure the Supabase/PostgREST endpoint before starting the server.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
