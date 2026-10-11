import type { AuthState, AuthUser, SignInInput, SignUpInput } from "./authTypes.ts";
import { SignInInputSchema, SignUpInputSchema } from "./authTypes.ts";
import type { AuthProvider } from "./authProvider.ts";
import { createUnconfiguredAuthProvider } from "./authProvider.ts";
import { toAuthDomainError, type AuthErrorCode } from "./authErrors.ts";

export interface AuthModel {
  getSnapshot(): AuthState;
  subscribe(listener: () => void): () => void;
  restoreSession(): Promise<void>;
  signIn(input: unknown): Promise<void>;
  signUp(input: unknown): Promise<void>;
  signOut(): Promise<void>;
  clearError(): void;
  getAccessToken(): Promise<string | null>;
}

/**
 * Creates an AuthModel that manages client authentication state machine.
 * Follows the observable store pattern used across Vision2Code (getSnapshot, subscribe).
 *
 * Guarantees:
 * 1. Deterministic transitions: RESTORING -> AUTHENTICATED / UNAUTHENTICATED; AUTHENTICATING -> AUTHENTICATED / ERROR.
 * 2. Protection against stale asynchronous calls via generation/revision and AbortController.
 * 3. Never logs or persists passwords.
 * 4. Never exposes tokens, secrets, or raw provider errors in state snapshots.
 * 5. Returns deeply frozen/immutable AuthUser snapshots so consumers cannot mutate identity.
 */
export function createAuthModel(
  provider: AuthProvider = createUnconfiguredAuthProvider(),
  options?: { autoRestore?: boolean }
): AuthModel {
  let state: AuthState = Object.freeze({
    status: "RESTORING",
    user: null,
    error: null,
    revision: 0,
  });

  let controller: AbortController | null = null;
  let activeOperationId = 0;
  const listeners = new Set<() => void>();

  function update(next: {
    status: AuthState["status"];
    user: AuthUser | null;
    error: AuthErrorCode | null;
  }) {
    state = Object.freeze({
      status: next.status,
      user: next.user ? Object.freeze({ ...next.user }) : null,
      error: next.error,
      revision: state.revision + 1,
    });
    listeners.forEach((listener) => listener());
  }

  function beginOperation(): { id: number; signal: AbortSignal } {
    controller?.abort();
    controller = new AbortController();
    activeOperationId += 1;
    return { id: activeOperationId, signal: controller.signal };
  }

  const model: AuthModel = {
    getSnapshot(): AuthState {
      return state;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async restoreSession(): Promise<void> {
      const op = beginOperation();
      update({ status: "RESTORING", user: null, error: null });

      try {
        const session = await provider.restoreSession(op.signal);
        if (op.signal.aborted || op.id !== activeOperationId) {
          return;
        }

        if (session?.user) {
          update({ status: "AUTHENTICATED", user: session.user, error: null });
        } else {
          update({ status: "UNAUTHENTICATED", user: null, error: null });
        }
      } catch (err) {
        if (op.signal.aborted || op.id !== activeOperationId) {
          return;
        }
        const domainError = toAuthDomainError(err);
        update({ status: "UNAUTHENTICATED", user: null, error: domainError.code });
      } finally {
        if (op.id === activeOperationId) {
          controller = null;
        }
      }
    },

    async signIn(rawInput: unknown): Promise<void> {
      const validation = SignInInputSchema.safeParse(rawInput);
      if (!validation.success) {
        update({ status: "ERROR", user: null, error: "VALIDATION_FAILED" });
        return;
      }
      const input: SignInInput = validation.data;

      const op = beginOperation();
      update({ status: "AUTHENTICATING", user: null, error: null });

      try {
        const session = await provider.signIn(input, op.signal);
        if (op.signal.aborted || op.id !== activeOperationId) {
          return;
        }

        update({ status: "AUTHENTICATED", user: session.user, error: null });
      } catch (err) {
        if (op.signal.aborted || op.id !== activeOperationId) {
          return;
        }
        const domainError = toAuthDomainError(err);
        update({ status: "ERROR", user: null, error: domainError.code });
      } finally {
        if (op.id === activeOperationId) {
          controller = null;
        }
      }
    },

    async signUp(rawInput: unknown): Promise<void> {
      const validation = SignUpInputSchema.safeParse(rawInput);
      if (!validation.success) {
        update({ status: "ERROR", user: null, error: "VALIDATION_FAILED" });
        return;
      }
      const input: SignUpInput = validation.data;

      const op = beginOperation();
      update({ status: "AUTHENTICATING", user: null, error: null });

      try {
        const result = await provider.signUp(input, op.signal);
        if (op.signal.aborted || op.id !== activeOperationId) {
          return;
        }

        if (result.session?.user) {
          update({ status: "AUTHENTICATED", user: result.session.user, error: null });
        } else if (result.requiresEmailConfirmation || !result.session) {
          update({ status: "AWAITING_EMAIL_CONFIRMATION", user: result.user, error: null });
        } else {
          update({ status: "AUTHENTICATED", user: result.user, error: null });
        }
      } catch (err) {
        if (op.signal.aborted || op.id !== activeOperationId) {
          return;
        }
        const domainError = toAuthDomainError(err);
        update({ status: "ERROR", user: null, error: domainError.code });
      } finally {
        if (op.id === activeOperationId) {
          controller = null;
        }
      }
    },

    async signOut(): Promise<void> {
      const op = beginOperation();
      // On sign out, immediately reset user and transition to UNAUTHENTICATED
      update({ status: "UNAUTHENTICATED", user: null, error: null });

      try {
        await provider.signOut(op.signal);
      } catch {
        // Sign-out errors do not prevent local unauthentication
      } finally {
        if (op.id === activeOperationId) {
          controller = null;
        }
      }
    },

    clearError(): void {
      if (state.error !== null) {
        update({
          status: state.status === "ERROR" ? "UNAUTHENTICATED" : state.status,
          user: state.user,
          error: null,
        });
      }
    },

    async getAccessToken(): Promise<string | null> {
      return provider.getAccessToken ? await provider.getAccessToken() : null;
    },
  };

  if (options?.autoRestore ?? true) {
    void model.restoreSession();
  }

  return model;
}
