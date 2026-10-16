/**
 * RATE_LIMITED: provider HTTP 429. UNAVAILABLE: network, timeout or provider failure.
 * TRUNCATED: the provider stopped at the mode's output budget before finishing the schema.
 * UNSUPPORTED_SETTINGS: the provider rejected a setting of the mode (detail, reasoning, budget).
 * TIMEOUT: the server's deadline for the mode ran out (a client that disconnects is not a failure to show).
 */
export type ProviderFailureKind = "RATE_LIMITED" | "UNAVAILABLE" | "TRUNCATED" | "UNSUPPORTED_SETTINGS" | "TIMEOUT";

const messages: Record<ProviderFailureKind, string> = {
  RATE_LIMITED: "Analysis provider rate limited.",
  UNAVAILABLE: "Analysis provider unavailable.",
  TRUNCATED: "Analysis provider output was truncated.",
  UNSUPPORTED_SETTINGS: "Analysis provider rejected the mode settings.",
  TIMEOUT: "Analysis exceeded the server deadline.",
};

export class ProviderFailureError extends Error {
  constructor(readonly kind: ProviderFailureKind) {
    super(messages[kind]);
    this.name = "ProviderFailureError";
  }
}
