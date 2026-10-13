import type { AuthSession, SignUpResult, SignInInput, SignUpInput } from "./authTypes.ts";
import { AuthDomainError } from "./authErrors.ts";

/**
 * Provider-independent authentication port.
 * Allows swapping between noop/unconfigured provider, Supabase adapter, or test double
 * without modifying domain auth logic or UI consumers.
 */
export interface AuthProvider {
  /**
   * Attempts to restore an existing session on startup.
   * Returns null if no active or valid session exists.
   */
  restoreSession(signal?: AbortSignal): Promise<AuthSession | null>;

  /**
   * Authenticates an existing user with validated email and password.
   */
  signIn(input: SignInInput, signal?: AbortSignal): Promise<AuthSession>;

  /**
   * Registers a new user account with validated credentials.
   * Returns SignUpResult indicating whether an immediate session was established
   * or email confirmation is required.
   */
  signUp(input: SignUpInput, signal?: AbortSignal): Promise<SignUpResult>;

  /**
   * Terminates the current authenticated session.
   */
  signOut(signal?: AbortSignal): Promise<void>;

  /**
   * Retrieves the raw bearer access token for authorized API calls to the backend.
   * Stays below the UI/domain identity surface; NEVER exposed in AuthUser or AuthState.
   */
  getAccessToken?(): Promise<string | null>;
}

/**
 * Default production provider when no external auth backend is configured.
 * Does NOT simulate successful login or fake credentials.
 * Always reports no restored session and rejects mutation attempts with a safe domain error.
 */
export function createUnconfiguredAuthProvider(): AuthProvider {
  return {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      throw new AuthDomainError("NETWORK_ERROR", "Authentication service is not configured");
    },
    async signUp(): Promise<SignUpResult> {
      throw new AuthDomainError("NETWORK_ERROR", "Authentication service is not configured");
    },
    async signOut(): Promise<void> {
      // Nothing to clear when unconfigured
    },
    async getAccessToken(): Promise<string | null> {
      return null;
    },
  };
}
