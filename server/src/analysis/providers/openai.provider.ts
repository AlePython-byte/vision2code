import OpenAI from "openai";
import { logAnalysisDiagnostic, safeDiagnosticValue } from "../analysis-diagnostics.js";
import { zodTextFormat } from "openai/helpers/zod";
import { UISchemaSchema } from "@vision2code/contracts";
import type { AIProvider } from "../../ai/ai-provider.js";
import type { AnalysisImageInput } from "../analysis-image-input.js";
import { ANALYSIS_TIMEOUT_MS } from "../analysis.constants.js";
import { InvalidAnalysisOutputError } from "../invalid-analysis-output.error.js";
import { ProviderFailureError } from "../provider-failure.error.js";
import { ANALYZER_SYSTEM_PROMPT } from "../prompts/analyzer-system.v1.js";
import { OPENAI_IMAGE_DETAIL, OPENAI_MAX_OUTPUT_TOKENS, OPENAI_REASONING_EFFORT } from "./openai.configuration.js";

export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI;
  private readonly format = zodTextFormat(UISchemaSchema, "ui_schema_v1");

  constructor(private readonly configuration: { apiKey: string; model: string }, client?: OpenAI) {
    if (!configuration.apiKey.trim()) throw new Error("OPENAI_API_KEY is required to construct the analysis provider.");
    this.client = client ?? new OpenAI({
      apiKey: configuration.apiKey,
      baseURL: "https://api.openai.com/v1",
      maxRetries: 0,
      timeout: ANALYSIS_TIMEOUT_MS,
      logLevel: "off",
    });
  }

  async analyze(input: AnalysisImageInput, signal?: AbortSignal): Promise<unknown> {
    try {
      const response = await this.client.responses.create({
        model: this.configuration.model,
        instructions: ANALYZER_SYSTEM_PROMPT,
        store: false,
        reasoning: { effort: OPENAI_REASONING_EFFORT },
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        text: { format: this.format },
        input: [{ role: "user", content: [
          { type: "input_text", text: `Analyze this screenshot. Source width: ${input.width}px; source height: ${input.height}px. Return UISchema v1 only.` },
          { type: "input_image", detail: OPENAI_IMAGE_DETAIL,
            image_url: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}` },
        ] }],
      }, { signal: signal ?? null, maxRetries: 0, timeout: ANALYSIS_TIMEOUT_MS });
      const hasParsedOutput = "output_parsed" in response && response.output_parsed != null;
      logAnalysisDiagnostic("provider_response", {
        status: safeDiagnosticValue(response.status, ["completed", "incomplete", "failed", "cancelled", "queued", "in_progress"]),
        completed: response.status === "completed",
        incomplete: response.status === "incomplete",
        incompleteDetails: response.incomplete_details == null ? null : {
          reason: safeDiagnosticValue(response.incomplete_details.reason, ["max_output_tokens", "content_filter"]),
        },
        hasParsedOutput,
        hasRefusal: response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal")),
        parser: "JSON.parse",
        hasOutputText: typeof response.output_text === "string" && response.output_text.length > 0,
        errorCode: safeDiagnosticValue(response.error?.code, ["server_error", "rate_limit_exceeded", "invalid_prompt", "vector_store_timeout"]),
      });
      if (response.status === "failed" || response.status === "cancelled") throw new ProviderFailureError("UNAVAILABLE");
      if (response.status !== "completed" || response.output.some((item) =>
        item.type === "message" && item.content.some((part) => part.type === "refusal"))) {
        throw new InvalidAnalysisOutputError();
      }
      try {
        const output: unknown = JSON.parse(response.output_text);
        return output;
      } catch {
        logAnalysisDiagnostic("output_parse_failed", {
          errorName: "SyntaxError", message: "Provider output text could not be parsed as JSON.",
        });
        throw new InvalidAnalysisOutputError();
      }
    } catch (error) {
      logAnalysisDiagnostic("provider_error", {
        errorName: error instanceof Error
          ? safeDiagnosticValue(error.constructor.name, ["APIError", "BadRequestError", "AuthenticationError", "PermissionDeniedError",
            "NotFoundError", "ConflictError", "UnprocessableEntityError", "RateLimitError", "InternalServerError",
            "APIConnectionError", "APIConnectionTimeoutError", "APIUserAbortError", "InvalidAnalysisOutputError", "ProviderFailureError", "SyntaxError", "Error", "TypeError"])
          : "UnknownError",
        message: error instanceof InvalidAnalysisOutputError ? "Provider output was incomplete, refused, or invalid."
          : "Analysis provider request failed.",
        httpStatus: error instanceof OpenAI.APIError && Number.isInteger(error.status)
          && error.status! >= 100 && error.status! <= 599 ? error.status : null,
        errorCode: error instanceof OpenAI.APIError
          ? safeDiagnosticValue(error.code, ["rate_limit_exceeded", "insufficient_quota", "invalid_api_key", "invalid_request_error",
            "server_error", "model_not_found", "context_length_exceeded", "invalid_image"]) : null,
      });
      if (error instanceof InvalidAnalysisOutputError || error instanceof ProviderFailureError) throw error;
      if (error instanceof OpenAI.APIError && error.status === 429) throw new ProviderFailureError("RATE_LIMITED");
      // Never attach an SDK exception as a cause: it can contain credentials or provider content.
      throw new ProviderFailureError("UNAVAILABLE");
    }
  }
}
