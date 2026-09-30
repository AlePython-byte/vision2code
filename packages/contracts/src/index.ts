import { z } from "zod";

export { ApiErrorCodeSchema, ApiErrorResponseSchema, RequestIdSchema } from "./api-error.js";
export type { ApiErrorCode, ApiErrorResponse } from "./api-error.js";
export { UINodeSchema, UISchemaSchema } from "./ui-schema.js";
export type { UINode, UISchema } from "./ui-schema.js";

export const OutputStackSchema = z.enum(["REACT_TAILWIND", "HTML_CSS"]);
export type OutputStack = z.infer<typeof OutputStackSchema>;
