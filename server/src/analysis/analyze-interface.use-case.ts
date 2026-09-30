import { UISchemaSchema } from "@vision2code/contracts";
import type { UISchema } from "@vision2code/contracts";
import type { AIProvider } from "../ai/ai-provider.js";
import { AnalysisImageInputSchema } from "./analysis-image-input.js";
import type { AnalysisImageInput } from "./analysis-image-input.js";
import { InvalidAnalysisOutputError } from "./invalid-analysis-output.error.js";

export class AnalyzeInterfaceUseCase {
  constructor(private readonly provider: AIProvider) {}

  async execute(input: AnalysisImageInput, signal?: AbortSignal): Promise<UISchema> {
    signal?.throwIfAborted();
    const validatedInput = AnalysisImageInputSchema.parse(input);
    const output = await this.provider.analyze(validatedInput, signal);
    signal?.throwIfAborted();
    const result = UISchemaSchema.safeParse(output);
    if (!result.success) throw new InvalidAnalysisOutputError();
    return result.data;
  }
}
