import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthenticatedUser } from "./authenticated-user.js";

export interface SupabaseJwtVerifier {
  verifyToken(token: string): Promise<AuthenticatedUser>;
}

export interface SupabaseVerifierOptions {
  readonly supabaseUrl?: string | undefined;
  readonly expectedIssuer?: string | undefined;
  readonly expectedAudience?: string | undefined;
  readonly keySetOverride?: JWTVerifyGetKey | undefined;
}

/**
 * Cryptographic JWT verifier using remote JWKS.
 *
 * Security notice:
 * - Service-role keys must NEVER exist in the desktop/client.
 * - A backend may use a service-role credential for legitimate privileged server-only operations in future.
 * - Vision2Code does NOT need or use one for authentication or JWT verification.
 */
export class JoseSupabaseJwtVerifier implements SupabaseJwtVerifier {
  private readonly jwks: JWTVerifyGetKey | null;
  private readonly issuer: string | null;
  private readonly audience: string;

  constructor(options: SupabaseVerifierOptions = {}) {
    const rawUrl = options.supabaseUrl?.trim();
    if (options.keySetOverride) {
      this.jwks = options.keySetOverride;
      this.issuer = options.expectedIssuer ?? (rawUrl ? `${rawUrl.replace(/\/+$/, "")}/auth/v1` : null);
    } else if (rawUrl) {
      const cleanUrl = rawUrl.replace(/\/+$/, "");
      const jwksUri = new URL(`${cleanUrl}/auth/v1/.well-known/jwks.json`);
      // jose creates a remote JWKS set that automatically handles caching and key rotation
      this.jwks = createRemoteJWKSet(jwksUri);
      this.issuer = options.expectedIssuer ?? `${cleanUrl}/auth/v1`;
    } else {
      this.jwks = null;
      this.issuer = null;
    }
    this.audience = options.expectedAudience ?? "authenticated";
  }

  async verifyToken(token: string): Promise<AuthenticatedUser> {
    if (!token || typeof token !== "string" || !token.trim()) {
      throw new Error("Missing or empty JWT");
    }

    if (!this.jwks) {
      throw new Error("JWT verifier is not configured with a valid Supabase JWKS URL or key set");
    }

    const verifyOptions: { audience: string; issuer?: string } = {
      audience: this.audience,
    };
    if (this.issuer) {
      verifyOptions.issuer = this.issuer;
    }

    const { payload } = await jwtVerify(token, this.jwks, verifyOptions);

    if (!payload.sub || typeof payload.sub !== "string") {
      throw new Error("JWT missing valid subject (sub) claim");
    }

    const email = typeof payload.email === "string" ? payload.email : undefined;

    return Object.freeze({
      id: payload.sub,
      email,
    });
  }
}
