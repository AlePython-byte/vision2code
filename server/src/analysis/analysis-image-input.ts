import { z } from "zod";

export const AnalysisImageMimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
export type AnalysisImageMimeType = z.infer<typeof AnalysisImageMimeTypeSchema>;

export const AnalysisImageInputSchema = z.strictObject({
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength > 0, "Image bytes must not be empty."),
  mimeType: AnalysisImageMimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type AnalysisImageInput = z.infer<typeof AnalysisImageInputSchema>;
