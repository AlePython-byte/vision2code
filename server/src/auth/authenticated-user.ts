/**
 * Verified user identity attached to the request after successful JWT cryptographic verification.
 * Derived EXCLUSIVELY from the verified JWT claims (sub and email).
 * Never accepted from request bodies, query parameters, cookies, or frontend headers.
 */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email?: string | undefined;
}
