import { ANALYSIS_SERVER_TIMEOUT_MS } from "@vision2code/contracts";
import type { AnalysisFidelity } from "@vision2code/contracts";
import { ConfigurationError } from "../configuration-error.js";

/**
 * Server deadline per mode, in ms. The contract's `ANALYSIS_SERVER_TIMEOUT_MS` is the ceiling (the
 * desktop waits that long plus a grace period, so the server's own error must arrive first); an
 * environment value can only shorten it, which also makes a timeout easy to provoke locally.
 */
export type AnalysisDeadlines = Readonly<Record<AnalysisFidelity, number>>;

export const MIN_ANALYSIS_DEADLINE_SECONDS = 5;

export const DEFAULT_ANALYSIS_DEADLINES: AnalysisDeadlines = ANALYSIS_SERVER_TIMEOUT_MS;

/** Reads ANALYSIS_<MODE>_TIMEOUT_SECONDS (MODE = FAST, BALANCED, PRECISE), clamped to 5 s..the contract's deadline. */
export function readAnalysisDeadlines(environment: NodeJS.ProcessEnv = process.env): AnalysisDeadlines {
  const read = (mode: AnalysisFidelity): number => {
    const name = `ANALYSIS_${mode.toUpperCase()}_TIMEOUT_SECONDS`;
    const raw = environment[name]?.trim();
    const ceiling = ANALYSIS_SERVER_TIMEOUT_MS[mode];
    if (raw === undefined || raw === "") return ceiling;
    if (!/^\d+$/.test(raw)) throw new ConfigurationError(`${name} must be a positive integer.`);
    return Math.min(ceiling, Math.max(MIN_ANALYSIS_DEADLINE_SECONDS * 1000, Number(raw) * 1000));
  };
  return Object.freeze({ fast: read("fast"), balanced: read("balanced"), precise: read("precise") });
}
