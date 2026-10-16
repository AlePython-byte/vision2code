import type { AnalysisFidelity } from "@vision2code/contracts";

/**
 * One structured line per analysis that reached the provider, to tune the profiles: how long each mode
 * takes and how many tokens it uses. It carries only the request id (already validated to a safe
 * charset), the mode, an outcome from a closed list and numbers. Never the image, the schema, the
 * token, an error message or any identifier of the user. Unlike the development diagnostics it is
 * also written in production: it holds nothing sensitive and its purpose is operating the service.
 */
export type AnalysisOutcome = "ok" | "timeout" | "client_abort" | "provider_error" | "truncated" | "invalid";

/** Token usage as the provider reports it (absent when the call never completed). */
export interface AnalysisUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

export interface AnalysisSummary {
  readonly requestId: string;
  readonly fidelity: AnalysisFidelity;
  readonly durationMs: number;
  readonly outcome: AnalysisOutcome;
  readonly usage: AnalysisUsage | null;
}

const count = (value: number) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

export function logAnalysisSummary(summary: AnalysisSummary): void {
  const { usage } = summary;
  // Built field by field so nothing else can ride along.
  const line = {
    context: "AnalysisSummary",
    requestId: summary.requestId,
    fidelity: summary.fidelity,
    outcome: summary.outcome,
    durationMs: count(Math.round(summary.durationMs)),
    inputTokens: usage === null ? null : count(usage.inputTokens),
    outputTokens: usage === null ? null : count(usage.outputTokens),
    reasoningTokens: usage === null ? null : count(usage.reasoningTokens),
  };
  try { console.info(JSON.stringify(line)); }
  catch { /* Logging is best effort and never changes the response. */ }
}
