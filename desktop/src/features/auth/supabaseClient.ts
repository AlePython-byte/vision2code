import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConfig {
  readonly url: string;
  readonly publishableKey: string;
}

/**
 * Reads public client configuration for Supabase.
 * Checks VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or legacy VITE_SUPABASE_ANON_KEY).
 *
 * Security notice:
 * - Service-role keys must NEVER exist in the desktop/client.
 * - A backend may use a service-role credential for legitimate privileged server-only operations in future.
 * - Vision2Code does NOT need or use one for authentication or JWT verification.
 */
export function readSupabaseConfig(): SupabaseConfig | null {
  const env = (import.meta as any).env ?? (typeof (globalThis as any).process !== "undefined" ? (globalThis as any).process.env : {}) ?? {};
  const url = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
  const publishableKey = typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === "string" && env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
    ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
    : typeof env.VITE_SUPABASE_ANON_KEY === "string" && env.VITE_SUPABASE_ANON_KEY.trim()
      ? env.VITE_SUPABASE_ANON_KEY.trim()
      : "";

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

let cachedClient: SupabaseClient | null = null;

/**
 * Returns a singleton instance of the public Supabase client.
 * Returns null if required configuration is absent.
 */
export function getSupabaseClient(configOverride?: SupabaseConfig | null): SupabaseClient | null {
  if (configOverride) {
    if (!configOverride.url || !configOverride.publishableKey) {
      return null;
    }
    return createClient(configOverride.url, configOverride.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }

  if (cachedClient) {
    return cachedClient;
  }

  const config = readSupabaseConfig();
  if (!config) {
    return null;
  }

  cachedClient = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  return cachedClient;
}
