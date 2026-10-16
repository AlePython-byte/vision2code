import { UISchemaSchema } from "@vision2code/contracts";
import { logAnalysisDiagnostic } from "./analysis-diagnostics.js";
import type { UISchema } from "@vision2code/contracts";
import type { AIProvider } from "../ai/ai-provider.js";
import { AnalysisImageInputSchema } from "./analysis-image-input.js";
import type { AnalysisImageInput } from "./analysis-image-input.js";
import { InvalidAnalysisOutputError } from "./invalid-analysis-output.error.js";
import type { AnalysisUsage } from "./analysis-summary-log.js";

export interface AnalysisHooks {
  /** Runs after validation and right before the paid call; throwing there skips the provider. */
  readonly beforeProvider?: ((input: AnalysisImageInput) => void) | undefined;
  /** Token usage reported by the provider, when it does. */
  readonly onUsage?: ((usage: AnalysisUsage) => void) | undefined;
}

export class AnalyzeInterfaceUseCase {
  constructor(private readonly provider: AIProvider) {}

  async execute(input: AnalysisImageInput, signal?: AbortSignal, hooks: AnalysisHooks = {}): Promise<UISchema> {
    signal?.throwIfAborted();
    const validatedInput = AnalysisImageInputSchema.parse(input);
    hooks.beforeProvider?.(validatedInput);
    const output = await this.provider.analyze(validatedInput, signal, hooks.onUsage);
    signal?.throwIfAborted();
    const result = UISchemaSchema.safeParse(output);
    if (!result.success) {
      logAnalysisDiagnostic("ui_schema_validation_failed", {
        errorName: "ZodError", message: "Provider output failed UISchema validation.",
        // UISchema has fixed object keys, not arbitrary records. Never include issue messages,
        // received values, or unrecognized-key lists, which can contain provider content.
        issues: result.error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.slice(0, 32).join("."), code: issue.code,
        })),
        truncated: result.error.issues.length > 20 || result.error.issues.some((issue) => issue.path.length > 32),
      });
      throw new InvalidAnalysisOutputError();
    }
    return result.data;
  }
}
