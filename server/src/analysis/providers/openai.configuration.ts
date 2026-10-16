export const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";
// Reasoning effort, image detail and output budget are per fidelity mode: see ../analysis-profiles.ts.

export function readOpenAIConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to construct the analysis provider.");
  const model = environment.OPENAI_MODEL?.trim() ?? DEFAULT_OPENAI_MODEL;
  if (!model) throw new Error("OPENAI_MODEL must not be empty.");
  return { apiKey, model };
}
