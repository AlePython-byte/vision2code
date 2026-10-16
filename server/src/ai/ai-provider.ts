import type { AnalysisImageInput } from "../analysis/analysis-image-input.js";
import type { AnalysisUsage } from "../analysis/analysis-summary-log.js";

// External structured output is untrusted until the application validates it.
export interface AIProvider {
  /** `onUsage` receives the token usage when the provider reports it, even if the output is then rejected. */
  analyze(input: AnalysisImageInput, signal?: AbortSignal, onUsage?: (usage: AnalysisUsage) => void): Promise<unknown>;
}
