import { z } from "zod";

const PortSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535));

/** Origins that are always allowed: the Vite dev server and the packaged Tauri webview (per platform). */
export const DEFAULT_CORS_ORIGINS: readonly string[] = [
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

/**
 * Reads CORS_ALLOWED_ORIGINS (comma separated) and returns the defaults plus the extra origins.
 * Each entry must be a bare origin (scheme://host[:port]); "*" and anything with a path are rejected,
 * so a typo can never open the API to every site. Messages name the variable, never its value.
 */
export function readCorsOrigins(environment: NodeJS.ProcessEnv = process.env): string[] {
  const origins = new Set(DEFAULT_CORS_ORIGINS);
  for (const entry of (environment.CORS_ALLOWED_ORIGINS ?? "").split(",")) {
    const value = entry.trim();
    if (!value) continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("CORS_ALLOWED_ORIGINS must contain only origins such as https://example.com.");
    }
    if (value === "*" || parsed.origin === "null" || parsed.origin !== value) {
      throw new Error("CORS_ALLOWED_ORIGINS must contain only origins such as https://example.com.");
    }
    origins.add(value);
  }
  return [...origins];
}

export function readConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const port = PortSchema.safeParse(environment.PORT ?? "3000");
  if (!port.success) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  // Loopback by default so a local run is not exposed to the network; a hosted run (NODE_ENV=production,
  // e.g. Render) must listen on every interface. HOST overrides both.
  const host = environment.HOST?.trim() || (environment.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

  /**
   * Supabase URL used solely for asymmetric JWKS remote key retrieval and JWT verification.
   * Security notice:
   * - Service-role keys must NEVER exist in the desktop/client.
   * - A backend may use a service-role credential for legitimate privileged server-only operations in future.
   * - Vision2Code does NOT need or use one for authentication or JWT verification.
   */
  const supabaseUrl = typeof environment.SUPABASE_URL === "string" && environment.SUPABASE_URL.trim()
    ? environment.SUPABASE_URL.trim()
    : undefined;

  return {
    port: port.data,
    host,
    corsOrigins: readCorsOrigins(environment),
    supabaseUrl,
  };
}
