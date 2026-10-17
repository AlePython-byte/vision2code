export const AI_PROVIDER = Symbol("AIProvider");
/** The per-user analysis limit (analysis-quota.ts); one instance per process. */
export const ANALYSIS_QUOTA = Symbol("AnalysisQuota");
/** Server deadline per fidelity mode (analysis-deadlines.ts). */
export const ANALYSIS_DEADLINES = Symbol("AnalysisDeadlines");
/** Balanced deadline (the default mode); per-mode deadlines live in the shared contracts. */
export const ANALYSIS_TIMEOUT_MS = 180_000;
export const MAX_ANALYSIS_IMAGE_BYTES = 10_000_000;
