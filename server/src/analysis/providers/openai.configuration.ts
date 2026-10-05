export const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";
export const OPENAI_REASONING_EFFORT = "low";
// Responses counts both visible output and reasoning tokens toward this bound.
export const OPENAI_MAX_OUTPUT_TOKENS = 8000;
// Let the model select image detail for the compact structure analysis.
export const OPENAI_IMAGE_DETAIL = "auto";

export function readOpenAIConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to construct the analysis provider.");
  const model = environment.OPENAI_MODEL?.trim() ?? DEFAULT_OPENAI_MODEL;
  if (!model) throw new Error("OPENAI_MODEL must not be empty.");
  return { apiKey, model };
}
