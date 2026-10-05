import { z } from "zod";
import { RequestIdSchema } from "./api-error.js";
import { UISchemaSchema } from "./ui-schema.js";

export const AnalysisResponseSchema = z.strictObject({
  requestId: RequestIdSchema,
  uiSchema: UISchemaSchema,
});
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;
