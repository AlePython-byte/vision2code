import { z } from "zod";

export const GENERATED_FILE_LANGUAGES = [
  "typescript",
  "javascript",
  "css",
  "html",
  "json",
  "plaintext",
] as const;

export const GeneratedFileLanguageSchema = z.enum(GENERATED_FILE_LANGUAGES);
export type GeneratedFileLanguage = z.infer<typeof GeneratedFileLanguageSchema>;

export const GeneratedFileSchema = z.strictObject({
  path: z.string().trim().min(1),
  content: z.string(),
  language: GeneratedFileLanguageSchema,
});

export const GeneratedProjectSchema = z.strictObject({
  target: z.literal("react-tailwind"),
  // "1" and "2": stored by earlier generators (immutable, never regenerated). "3": current generator.
  generatorVersion: z.enum(["1", "2", "3"]),
  files: z.array(GeneratedFileSchema).min(1),
});

export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;
export type GeneratedProject = z.infer<typeof GeneratedProjectSchema>;
