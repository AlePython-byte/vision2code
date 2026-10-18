import type { SupabaseClient, User, Session, AuthError } from "@supabase/supabase-js";
import type { AuthProvider } from "./authProvider.ts";
import type { AuthSession, AuthUser, SignUpResult, SignInInput, SignUpInput } from "./authTypes.ts";
import { AuthDomainError, toAuthDomainError } from "./authErrors.ts";
import { getSupabaseClient, readSupabaseConfig, supabaseAuthStorageKey } from "./supabaseClient.ts";
import type { AuthStorage } from "./authStorage.ts";
import { getDefaultAuthStorage } from "./tauriStrongholdStorage.ts";

/**
 * Safely maps a Supabase User object into an immutable domain AuthUser.
 * Strictly avoids leaking Supabase metadata, tokens, app_metadata, etc.
 */
export function mapSupabaseUser(user: User, fallbackEmail?: string): AuthUser {
  if (!user || typeof user.id !== "string" || !user.id) {
    throw new AuthDomainError("UNKNOWN", "Malformed user in Supabase response");
  }

  const rawEmail = typeof user.email === "string" && user.email.trim() ? user.email.trim() : fallbackEmail;
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

  // In Supabase, confirmed_at or email_confirmed_at indicates email verification
  const emailVerified = Boolean(
    (user as any).email_confirmed_at ||
    (user as any).confirmed_at
  );

  return Object.freeze({
    id: user.id,
    email,
    emailVerified,
  });
}

/**
 * Safely maps a Supabase Session into a domain AuthSession.
 * Access tokens and refresh tokens are excluded from the returned domain session.
 */
export function mapSupabaseSession(session: Session | null): AuthSession | null {
  if (!session || !session.user) {
    return null;
  }
  const user = mapSupabaseUser(session.user);
  return Object.freeze({ user });
}

/**
 * Maps Supabase AuthError instances to domain-safe AuthErrorCode codes.
 * Never displays raw Supabase error messages directly to avoid account enumeration
 * or internal schema leaks.
 */
export function mapSupabaseError(error: AuthError | Error | unknown): AuthDomainError {
  if (error instanceof AuthDomainError) {
    return error;
  }

  if (error && typeof error === "object") {
    const message = ("message" in error && typeof error.message === "string" ? error.message : "").toLowerCase();
    const status = "status" in error && typeof error.status === "number" ? error.status : 0;
    const code = "code" in error && typeof error.code === "string" ? error.code.toLowerCase() : "";

    // 1. Invalid credentials
    if (
      code === "invalid_credentials" ||
      code === "invalid_grant" ||
      message.includes("invalid login credentials") ||
      message.includes("invalid credentials") ||
      message.includes("invalid grant")
    ) {
      return new AuthDomainError("INVALID_CREDENTIALS", "Invalid credentials");
    }

    // 2. Email not confirmed
    if (
      code === "email_not_confirmed" ||
      message.includes("email not confirmed") ||
      message.includes("not confirmed")
    ) {
      return new AuthDomainError("EMAIL_NOT_CONFIRMED", "Email not confirmed");
    }

    // 3. Rate limited (HTTP 429 or provider rate limit codes)
    if (
      status === 429 ||
      code === "over_email_send_rate_limit" ||
      code === "over_request_rate_limit" ||
      message.includes("rate limit") ||
      message.includes("too many requests")
    ) {
      return new AuthDomainError("RATE_LIMITED", "Too many requests");
    }

    // 4. Email already registered (requires stable evidence)
    if (
      code === "user_already_exists" ||
      code === "email_exists" ||
      message.includes("user already registered") ||
      message.includes("already registered") ||
      message.includes("user already exists") ||
      message.includes("email already exists") ||
      message.includes("email exists") ||
      message.includes("already in use") ||
      message.includes("already been registered")
    ) {
      return new AuthDomainError("EMAIL_ALREADY_REGISTERED", "Email already registered");
    }

    // 5. Validation / weak password / generic 422
    if (
      status === 422 ||
      code === "weak_password" ||
      code === "validation_failed" ||
      code === "email_address_invalid" ||
      message.includes("weak password") ||
      message.includes("password should be") ||
      message.includes("invalid email") ||
      message.includes("validation")
    ) {
      return new AuthDomainError("VALIDATION_FAILED", "Validation failed");
    }

    // 6. Session expired or refresh token invalid
    if (
      code === "session_expired" ||
      code === "session_not_found" ||
      code === "bad_jwt" ||
      message.includes("token is expired") ||
      message.includes("jwt expired") ||
      message.includes("session expired")
    ) {
      return new AuthDomainError("SESSION_EXPIRED", "Session expired");
    }

    // 7. Network, server/gateway errors (HTTP 500+)
    if (
      status === 0 ||
      status >= 500 ||
      message.includes("failed to fetch") ||
      message.includes("network error") ||
      message.includes("timeout") ||
      message.includes("service unavailable")
    ) {
      return new AuthDomainError("NETWORK_ERROR", "Network connection failed");
    }
  }

  return toAuthDomainError(error);
}

/** Where the client persists its session, so sign-out can clear it without waiting for the network. */
export interface SupabaseSessionStore {
  readonly storage: AuthStorage;
  readonly storageKey: string;
  /** How long sign-out waits for POST /logout before clearing the local copy anyway (default 2500 ms). */
  readonly remoteSignOutWaitMs?: number | undefined;
}

const REMOTE_SIGN_OUT_WAIT_MS = 2500;

function defaultSessionStore(): SupabaseSessionStore | null {
  const config = readSupabaseConfig();
  return config ? { storage: getDefaultAuthStorage(), storageKey: supabaseAuthStorageKey(config.url) } : null;
}

/** Every key the SDK keeps for one session (auth-js `_removeSession`; PKCE is not used by this app). */
function sessionKeys(storageKey: string): readonly string[] {
  return [storageKey, `${storageKey}-user`, `${storageKey}-code-verifier`];
}

/**
 * Creates an AuthProvider backed by the official Supabase JavaScript SDK.
 * Supports dependency injection for testing.
 */
export function createSupabaseAuthProvider(
  client: SupabaseClient | null = getSupabaseClient(),
  session: SupabaseSessionStore | null = defaultSessionStore()
): AuthProvider {
  function requireClient(): SupabaseClient {
    if (!client) {
      throw new AuthDomainError("NETWORK_ERROR", "Supabase authentication is not configured");
    }
    return client;
  }

  return {
    async restoreSession(signal?: AbortSignal): Promise<AuthSession | null> {
      if (!client) {
        return null;
      }
      if (signal?.aborted) {
        return null;
      }

      try {
        const { data, error } = await client.auth.getSession();
        if (signal?.aborted) {
          return null;
        }

        if (error) {
          throw mapSupabaseError(error);
        }

        if (!data.session) {
          if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
            console.info("[Auth] restore session found: no");
          }
          return null;
        }

        if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
          console.info("[Auth] restore session found: yes");
        }
        return mapSupabaseSession(data.session);
      } catch (err) {
        if (signal?.aborted) {
          return null;
        }
        throw mapSupabaseError(err);
      }
    },

    async signIn(input: SignInInput, signal?: AbortSignal): Promise<AuthSession> {
      const supabase = requireClient();
      if (signal?.aborted) {
        throw new AuthDomainError("UNKNOWN", "Sign in aborted");
      }
      session?.storage.allowSessionWrites?.();

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: input.email,
          password: input.password,
        });

        if (signal?.aborted) {
          throw new AuthDomainError("UNKNOWN", "Sign in aborted");
        }

        if (error) {
          throw mapSupabaseError(error);
        }

        if (!data.session || !data.user) {
          throw new AuthDomainError("UNKNOWN", "Incomplete session returned by provider");
        }

        const mapped = mapSupabaseSession(data.session);
        if (!mapped) {
          throw new AuthDomainError("UNKNOWN", "Invalid session structure");
        }

        return mapped;
      } catch (err) {
        throw mapSupabaseError(err);
      }
    },

    async signUp(input: SignUpInput, signal?: AbortSignal): Promise<SignUpResult> {
      const supabase = requireClient();
      if (signal?.aborted) {
        throw new AuthDomainError("UNKNOWN", "Sign up aborted");
      }
      session?.storage.allowSessionWrites?.();

      try {
        const { data, error } = await supabase.auth.signUp({
          email: input.email,
          password: input.password,
        });

        if (signal?.aborted) {
          throw new AuthDomainError("UNKNOWN", "Sign up aborted");
        }

        if (error) {
          throw mapSupabaseError(error);
        }

        if (!data || !data.user) {
          throw new AuthDomainError("UNKNOWN", "No user returned from registration");
        }

        const user = mapSupabaseUser(data.user, input.email);
        const mapped = mapSupabaseSession(data.session);
        const requiresEmailConfirmation = mapped === null;

        return Object.freeze({
          user,
          session: mapped,
          requiresEmailConfirmation,
        });
      } catch (err) {
        throw mapSupabaseError(err);
      }
    },

    async signOut(signal?: AbortSignal): Promise<void> {
      if (!client) {
        return;
      }
      if (signal?.aborted) {
        return;
      }

      // POST /logout revokes the session on the server, but the SDK removes its local copy only once that request
      // answers (never, if it hangs). Give it a bounded wait, then clear the local copy ourselves: the session must be
      // off the disk before sign-out resolves, whatever the network does. Server errors stay non-fatal.
      const remote = Promise.resolve()
        .then(() => client.auth.signOut())
        .then(() => undefined, () => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, session?.remoteSignOutWaitMs ?? REMOTE_SIGN_OUT_WAIT_MS);
      });
      await Promise.race([remote, waited]);
      clearTimeout(timer);

      if (!session) {
        return;
      }
      const keys = sessionKeys(session.storageKey);
      try {
        if (session.storage.clearSession) {
          await session.storage.clearSession(keys);
        } else {
          for (const key of keys) await session.storage.removeItem(key);
        }
      } catch {
        throw new AuthDomainError("SIGN_OUT_NOT_PERSISTED", "The stored session could not be removed");
      }
    },

    async getAccessToken(): Promise<string | null> {
      if (!client) {
        return null;
      }
      try {
        const { data } = await client.auth.getSession();
        return data.session?.access_token ?? null;
      } catch {
        return null;
      }
    },
  };
}

