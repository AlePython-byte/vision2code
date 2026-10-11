import { z } from "zod";

const PortSchema = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535));

export function readConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const port = PortSchema.safeParse(environment.PORT ?? "3000");
  if (!port.success) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

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
    supabaseUrl,
  };
}
