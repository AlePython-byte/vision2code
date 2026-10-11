/**
 * Safe domain-level authentication error codes.
 * Prevents provider-specific raw errors, secrets, or internal stack traces from leaking to the UI.
 */
export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_CONFIRMED"
  | "EMAIL_ALREADY_REGISTERED"
  | "NETWORK_ERROR"
  | "SESSION_EXPIRED"
  | "VALIDATION_FAILED"
  | "UNKNOWN";

/**
 * Domain-level authentication error.
 * Wraps error codes safely without exposing raw provider details.
 */
export class AuthDomainError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? `Auth error: ${code}`);
    this.name = "AuthDomainError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Maps arbitrary thrown values or provider exceptions to safe AuthDomainError.
 * Ensures raw secrets, connection strings, or provider internals are never forwarded.
 */
export function toAuthDomainError(error: unknown): AuthDomainError {
  if (error instanceof AuthDomainError) {
    return error;
  }
  return new AuthDomainError("UNKNOWN", "An unexpected authentication error occurred");
}

