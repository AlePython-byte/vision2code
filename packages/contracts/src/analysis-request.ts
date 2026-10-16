import { z } from "zod";

/**
 * Analysis fidelity requested by the client. Only the mode travels: the server owns the numbers
 * behind it (node budget, image detail, reasoning effort, output tokens) and caps them.
 * Optional on the wire; a request without it is analyzed as "balanced", so older clients keep working.
 */
export const AnalysisFidelitySchema = z.enum(["fast", "balanced", "precise"]);
export type AnalysisFidelity = z.infer<typeof AnalysisFidelitySchema>;
export const DEFAULT_ANALYSIS_FIDELITY: AnalysisFidelity = "balanced";

/** Server-side deadline per mode (ms): precise reasons longer over a higher-detail image. */
export const ANALYSIS_SERVER_TIMEOUT_MS: Readonly<Record<AnalysisFidelity, number>> = Object.freeze({
  fast: 90_000,
  balanced: 120_000,
  precise: 180_000,
});
/** The client waits this much longer than the server, so the server's own error always arrives first. */
export const ANALYSIS_CLIENT_GRACE_MS = 30_000;

export function analysisClientTimeoutMs(fidelity: AnalysisFidelity): number {
  return ANALYSIS_SERVER_TIMEOUT_MS[fidelity] + ANALYSIS_CLIENT_GRACE_MS;
}
