import { z } from "zod";

export { ApiErrorCodeSchema, ApiErrorResponseSchema, RequestIdSchema } from "./api-error.js";
export type { ApiErrorCode, ApiErrorResponse } from "./api-error.js";
export { UINodeSchema, UISchemaSchema } from "./ui-schema.js";
export type { UINode, UISchema } from "./ui-schema.js";
export { AnalysisResponseSchema } from "./analysis-response.js";
export type { AnalysisResponse } from "./analysis-response.js";

export const OutputStackSchema = z.enum(["REACT_TAILWIND", "HTML_CSS"]);
export type OutputStack = z.infer<typeof OutputStackSchema>;

export {
  GENERATED_FILE_LANGUAGES,
  GeneratedFileLanguageSchema,
  GeneratedFileSchema,
  GeneratedProjectSchema,
} from "./generated-project.js";
export type {
  GeneratedFileLanguage,
  GeneratedFile,
  GeneratedProject,
} from "./generated-project.js";

export {
  FidelityModeSchema,
  GenerationTargetSchema,
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  CreateGenerationInputSchema,
  ProjectSummarySchema,
  ProjectDetailSchema,
  GenerationSummarySchema,
  GenerationDetailSchema,
} from "./project.js";
export type {
  FidelityMode,
  GenerationTarget,
  CreateProjectInput,
  UpdateProjectInput,
  CreateGenerationInput,
  ProjectSummary,
  ProjectDetail,
  GenerationSummary,
  GenerationDetail,
} from "./project.js";
