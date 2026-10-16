import { z } from "zod";
import { AnalysisFidelitySchema, DEFAULT_ANALYSIS_FIDELITY } from "@vision2code/contracts";

export const AnalysisImageMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
export type AnalysisImageMimeType = z.infer<typeof AnalysisImageMimeTypeSchema>;

export const AnalysisImageInputSchema = z.strictObject({
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, "Image bytes must not be empty."),
  mimeType: AnalysisImageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Mode chosen by the client; only the mode crosses the boundary, never provider numbers. */
  fidelity: AnalysisFidelitySchema.default(DEFAULT_ANALYSIS_FIDELITY),
});

/** What callers hand to the use case (fidelity may be omitted: it defaults to "balanced"). */
export type AnalysisImageInput = z.input<typeof AnalysisImageInputSchema>;
