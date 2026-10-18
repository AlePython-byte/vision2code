import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthStorage } from "./authStorage.ts";
import { cleanLegacyLocalStorage } from "./authStorage.ts";
import { getDefaultAuthStorage } from "./tauriStrongholdStorage.ts";

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
  const metaEnv = (import.meta as any).env;
  const procEnv = typeof (globalThis as any).process !== "undefined" ? (globalThis as any).process.env : undefined;
  const env = metaEnv ?? procEnv ?? {};

  const url = typeof env.VITE_SUPABASE_URL === "string" && env.VITE_SUPABASE_URL.trim()
    ? env.VITE_SUPABASE_URL.trim()
    : typeof import.meta.env?.VITE_SUPABASE_URL === "string"
      ? import.meta.env.VITE_SUPABASE_URL.trim()
      : "";

  const publishableKey = typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === "string" && env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
    ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
    : typeof import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY === "string" && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
      ? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
      : typeof env.VITE_SUPABASE_ANON_KEY === "string" && env.VITE_SUPABASE_ANON_KEY.trim()
        ? env.VITE_SUPABASE_ANON_KEY.trim()
        : typeof import.meta.env?.VITE_SUPABASE_ANON_KEY === "string"
          ? import.meta.env.VITE_SUPABASE_ANON_KEY.trim()
          : "";

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

/**
 * Storage key of the persisted session: the SDK default (`sb-<first host label>-auth-token`), passed explicitly so
 * sign-out can clear exactly what the client wrote and sessions stored by earlier versions are still found.
 */
export function supabaseAuthStorageKey(url: string): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

let cachedClient: SupabaseClient | null = null;

/**
 * Returns a singleton instance of the public Supabase client.
 * Returns null if required configuration is absent.
 */
export function getSupabaseClient(
  configOverride?: SupabaseConfig | null,
  storageOverride?: AuthStorage | null
): SupabaseClient | null {
  const storage = storageOverride ?? getDefaultAuthStorage();

  if (configOverride) {
    if (!configOverride.url || !configOverride.publishableKey) {
      return null;
    }
    return createClient(configOverride.url, configOverride.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage,
        storageKey: supabaseAuthStorageKey(configOverride.url),
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

  // Purge legacy WebView localStorage session on startup to enforce clean-break boundary
  cleanLegacyLocalStorage();

  cachedClient = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage,
      storageKey: supabaseAuthStorageKey(config.url),
    },
  });

  return cachedClient;
}

/**
 * Resets the cached Supabase singleton for isolated testing.
 */
export function resetSupabaseClientForTesting(): void {
  cachedClient = null;
}
