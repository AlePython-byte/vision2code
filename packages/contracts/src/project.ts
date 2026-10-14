import { z } from "zod";
import { UISchemaSchema } from "./ui-schema.js";
import { GeneratedProjectSchema } from "./generated-project.js";

export const FidelityModeSchema = z.preprocess(
  (val) => (typeof val === "string" ? val.toUpperCase() : val),
  z.enum(["FAST", "BALANCED", "PRECISE"])
);
export type FidelityMode = z.infer<typeof FidelityModeSchema>;

export const GenerationTargetSchema = z.preprocess(
  (val) => (typeof val === "string" ? val.toUpperCase().replace("-", "_") : val),
  z.enum(["REACT_TAILWIND"])
);
export type GenerationTarget = z.infer<typeof GenerationTargetSchema>;

export const CreateProjectInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Project name cannot be empty").max(100, "Project name too long"),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Project name cannot be empty").max(100, "Project name too long"),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

export const CreateGenerationInputSchema = z.strictObject({
  sourceImagePath: z.string().trim().min(1).max(1024).nullable().optional(),
  sourceImageName: z.string().trim().min(1).max(255).nullable().optional(),
  sourceImageMimeType: z.string().trim().min(1).max(100).nullable().optional(),
  uiSchema: UISchemaSchema,
  generatedProject: GeneratedProjectSchema,
  generationTarget: GenerationTargetSchema.default("REACT_TAILWIND"),
  fidelityMode: FidelityModeSchema.default("BALANCED"),
});
export type CreateGenerationInput = z.infer<typeof CreateGenerationInputSchema>;

export const ProjectSummarySchema = z.strictObject({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  generationCount: z.number().int().nonnegative().optional(),
  latestGenerationId: z.string().uuid().nullable().optional(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectDetailSchema = z.strictObject({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  generations: z.array(z.lazy(() => GenerationSummarySchema)),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const GenerationSummarySchema = z.strictObject({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceImagePath: z.string().nullable(),
  sourceImageName: z.string().nullable(),
  sourceImageMimeType: z.string().nullable(),
  generationTarget: GenerationTargetSchema,
  fidelityMode: FidelityModeSchema,
  createdAt: z.string().datetime(),
});
export type GenerationSummary = z.infer<typeof GenerationSummarySchema>;

export const GenerationDetailSchema = z.strictObject({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceImagePath: z.string().nullable(),
  sourceImageName: z.string().nullable(),
  sourceImageMimeType: z.string().nullable(),
  generationTarget: GenerationTargetSchema,
  fidelityMode: FidelityModeSchema,
  createdAt: z.string().datetime(),
  uiSchema: UISchemaSchema,
  generatedProject: GeneratedProjectSchema,
});
export type GenerationDetail = z.infer<typeof GenerationDetailSchema>;

