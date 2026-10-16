import { z } from "zod";

export const RequestIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const ApiErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "NOT_FOUND", "INTERNAL_ERROR", "UNSUPPORTED_IMAGE", "IMAGE_TOO_LARGE",
  "AI_RATE_LIMITED", "AI_UNAVAILABLE", "AI_OUTPUT_INVALID", "UNAUTHORIZED",
  // The provider stopped before finishing (output budget reached) / rejected the mode's settings.
  "AI_OUTPUT_TRUNCATED", "AI_SETTINGS_UNSUPPORTED",
  // Our own per-user analysis limit (hourly budget or simultaneous analyses), not the provider's 429.
  "ANALYSIS_QUOTA_EXCEEDED",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    requestId: RequestIdSchema,
    /** Seconds to wait before retrying; sent with ANALYSIS_QUOTA_EXCEEDED (same value as the Retry-After header). */
    retryAfterSeconds: z.number().int().positive().max(86_400).optional(),
  }).strict(),
}).strict();

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
