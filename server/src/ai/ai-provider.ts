import type { AnalysisImageInput } from "../analysis/analysis-image-input.js";

// External structured output is untrusted until the application validates it.
export interface AIProvider {
  analyze(input: AnalysisImageInput, signal?: AbortSignal): Promise<unknown>;
}
