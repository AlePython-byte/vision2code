import { z } from "zod";

/**
 * Normalized email validator:
 * - Trims leading and trailing whitespace
 * - Converts to lower case
 * - Validates standard email structure
 */
export const AuthEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Formato de correo electrónico inválido");

/**
 * Password validation rule:
 * - Minimum 8 characters for practical security
 * - Maximum 128 characters to prevent DoS
 * - Must not be empty or purely whitespace
 */
export const AuthPasswordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(128, "La contraseña no debe exceder 128 caracteres");

export const SignInInputSchema = z
  .object({
    email: AuthEmailSchema,
    password: AuthPasswordSchema,
  })
  .strict();

export type SignInInput = z.infer<typeof SignInInputSchema>;

export const SignUpInputSchema = z
  .object({
    email: AuthEmailSchema,
    password: AuthPasswordSchema,
  })
  .strict();

export type SignUpInput = z.infer<typeof SignUpInputSchema>;

/**
 * Smallest useful authenticated user representation.
 * Immutable user identity for UI consumers.
 * DOES NOT include: passwords, tokens, provider secrets, database profiles, billing.
 */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/**
 * Client-facing session representation.
 * Tokens belong to infrastructure/network adapters, not UI user identity.
 */
export interface AuthSession {
  readonly user: AuthUser;
}

/**
 * Provider-independent result of a registration attempt.
 * Represents both immediate active sessions and registrations requiring email confirmation.
 */
export interface SignUpResult {
  readonly user: AuthUser;
  readonly session: AuthSession | null;
  readonly requiresEmailConfirmation: boolean;
}

/**
 * Deterministic auth state-machine statuses.
 */
export type AuthStatus =
  | "RESTORING"
  | "UNAUTHENTICATED"
  | "AUTHENTICATING"
  | "AUTHENTICATED"
  | "AWAITING_EMAIL_CONFIRMATION"
  | "ERROR";

/**
 * Snapshot of auth state exposed to consumers.
 * Passwords, tokens and raw secrets are strictly forbidden here.
 */
export interface AuthState {
  readonly status: AuthStatus;
  readonly user: AuthUser | null;
  readonly error: import("./authErrors.ts").AuthErrorCode | null;
  readonly revision: number;
}

