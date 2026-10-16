import type { AnalysisFidelity } from "@vision2code/contracts";

/**
 * What each fidelity mode means on the provider. The client only names the mode; these numbers are
 * the server's, can be tuned per deployment through environment variables, and are always clamped to
 * the hard caps below so a configuration can never make one analysis arbitrarily expensive.
 */
export type ImageDetail = "low" | "auto" | "high";
export type ReasoningEffort = "low" | "medium" | "high";

export interface AnalysisProfile {
  /** Node budget the prompt asks for (root included). */
  readonly nodes: { readonly min: number; readonly max: number };
  readonly imageDetail: ImageDetail;
  readonly reasoningEffort: ReasoningEffort;
  /** Responses counts visible output and reasoning tokens toward this bound. */
  readonly maxOutputTokens: number;
}

/**
 * Defaults. FAST: low image detail and a small budget, the cheapest useful structure. BALANCED: what
 * shipped before (auto detail, low reasoning) with a node budget that no longer forces merging rows
 * and columns into flat blocks, and room for the larger schema. PRECISE: high image detail, medium
 * reasoning, the largest budget; it takes longer and costs more (see README for the estimate).
 */
export const DEFAULT_ANALYSIS_PROFILES: Readonly<Record<AnalysisFidelity, AnalysisProfile>> = Object.freeze({
  fast: Object.freeze({ nodes: Object.freeze({ min: 10, max: 20 }), imageDetail: "low", reasoningEffort: "low", maxOutputTokens: 6_000 }),
  balanced: Object.freeze({ nodes: Object.freeze({ min: 20, max: 35 }), imageDetail: "auto", reasoningEffort: "low", maxOutputTokens: 10_000 }),
  precise: Object.freeze({ nodes: Object.freeze({ min: 30, max: 50 }), imageDetail: "high", reasoningEffort: "medium", maxOutputTokens: 16_000 }),
});

/** Hard caps in code: environment values beyond them are clamped, never honored. */
export const ANALYSIS_PROFILE_LIMITS = Object.freeze({
  nodes: Object.freeze({ min: 3, max: 60 }),
  maxOutputTokens: Object.freeze({ min: 2_000, max: 20_000 }),
  /** Ordered from cheapest to most expensive; anything above the last one is clamped to it. */
  reasoningEfforts: Object.freeze(["low", "medium", "high"] as const),
  imageDetails: Object.freeze(["low", "auto", "high"] as const),
});

/** Effort levels the SDK knows but that exceed the cap; they are clamped to the highest allowed. */
const EFFORTS_ABOVE_CAP = new Set(["xhigh", "max"]);
/** Effort levels below the floor are raised to "low": structured output of a whole UI needs reasoning. */
const EFFORTS_BELOW_FLOOR = new Set(["none", "minimal"]);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a positive integer.`);
  return clamp(Number(raw), min, max);
}

function effort(environment: NodeJS.ProcessEnv, name: string, fallback: ReasoningEffort): ReasoningEffort {
  const raw = environment[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if ((ANALYSIS_PROFILE_LIMITS.reasoningEfforts as readonly string[]).includes(raw)) return raw as ReasoningEffort;
  if (EFFORTS_ABOVE_CAP.has(raw)) return "high";
  if (EFFORTS_BELOW_FLOOR.has(raw)) return "low";
  throw new Error(`${name} must be one of low, medium, high.`);
}

function detail(environment: NodeJS.ProcessEnv, name: string, fallback: ImageDetail): ImageDetail {
  const raw = environment[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if ((ANALYSIS_PROFILE_LIMITS.imageDetails as readonly string[]).includes(raw)) return raw as ImageDetail;
  throw new Error(`${name} must be one of low, auto, high.`);
}

/**
 * Reads ANALYSIS_<MODE>_NODES_MIN, _NODES_MAX, _MAX_OUTPUT_TOKENS, _IMAGE_DETAIL and
 * _REASONING_EFFORT (MODE = FAST, BALANCED, PRECISE). Values beyond the hard caps are clamped;
 * malformed values stop startup with a message naming the variable (never its value).
 */
export function readAnalysisProfiles(environment: NodeJS.ProcessEnv = process.env): Readonly<Record<AnalysisFidelity, AnalysisProfile>> {
  const limits = ANALYSIS_PROFILE_LIMITS;
  const read = (mode: AnalysisFidelity): AnalysisProfile => {
    const prefix = `ANALYSIS_${mode.toUpperCase()}_`;
    const base = DEFAULT_ANALYSIS_PROFILES[mode];
    const min = integer(environment, `${prefix}NODES_MIN`, base.nodes.min, limits.nodes.min, limits.nodes.max);
    const max = integer(environment, `${prefix}NODES_MAX`, base.nodes.max, limits.nodes.min, limits.nodes.max);
    return Object.freeze({
      nodes: Object.freeze({ min: Math.min(min, max), max: Math.max(min, max) }),
      imageDetail: detail(environment, `${prefix}IMAGE_DETAIL`, base.imageDetail),
      reasoningEffort: effort(environment, `${prefix}REASONING_EFFORT`, base.reasoningEffort),
      maxOutputTokens: integer(environment, `${prefix}MAX_OUTPUT_TOKENS`, base.maxOutputTokens, limits.maxOutputTokens.min, limits.maxOutputTokens.max),
    });
  };
  return Object.freeze({ fast: read("fast"), balanced: read("balanced"), precise: read("precise") });
}
