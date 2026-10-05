import { z } from "zod";

export const RequestIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const ApiErrorCodeSchema = z.enum([
  "INVALID_REQUEST", "NOT_FOUND", "INTERNAL_ERROR", "UNSUPPORTED_IMAGE", "IMAGE_TOO_LARGE",
  "AI_RATE_LIMITED", "AI_UNAVAILABLE", "AI_OUTPUT_INVALID",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    requestId: RequestIdSchema,
  }).strict(),
}).strict();

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
