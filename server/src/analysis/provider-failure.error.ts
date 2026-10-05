export class ProviderFailureError extends Error {
  constructor(readonly kind: "RATE_LIMITED" | "UNAVAILABLE") {
    super(kind === "RATE_LIMITED" ? "Analysis provider rate limited." : "Analysis provider unavailable.");
    this.name = "ProviderFailureError";
  }
}
