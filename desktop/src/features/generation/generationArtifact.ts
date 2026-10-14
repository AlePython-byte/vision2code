import type { FidelityMode, GeneratedProject, UISchema } from "@vision2code/contracts";
import type { VisualFidelity } from "../analysis/generationProfileModel.ts";
import { screenshotMimeType, type ScreenshotFormat } from "../screenshot/validation.ts";

export const SOURCE_IMAGE_NAME_MAX_LENGTH = 255;

/**
 * Everything required to persist one completed generation.
 * It never carries the File, Blob, base64 data, object URL or any local path of the screenshot.
 */
export interface CompletedGenerationArtifact {
  readonly uiSchema: UISchema;
  readonly generatedProject: GeneratedProject;
  readonly fidelityMode: FidelityMode;
  readonly generationTarget: "REACT_TAILWIND";
  readonly sourceImageName: string | null;
  readonly sourceImageMimeType: string | null;
  /** Project selected when the analysis started; null means the result is local only. */
  readonly targetProjectId: string | null;
}

const fidelityModes: Record<VisualFidelity, FidelityMode> = {
  fast: "FAST",
  balanced: "BALANCED",
  precise: "PRECISE",
};

/** Explicit desktop → contract mapping; does not rely on the contract's uppercase preprocess. */
export function toFidelityMode(fidelity: VisualFidelity): FidelityMode {
  return fidelityModes[fidelity];
}

/** Keeps only a trimmed basename so no directory structure can reach the backend. */
export function toSourceImageName(name: string): string | null {
  const basename = name.split(/[\\/]/).pop() ?? "";
  const cleaned = basename.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, SOURCE_IMAGE_NAME_MAX_LENGTH).trim() || null;
}

export interface GenerationArtifactSource {
  readonly uiSchema: UISchema;
  readonly generatedProject: GeneratedProject;
  readonly fidelity: VisualFidelity;
  readonly screenshot: { readonly name: string; readonly format: ScreenshotFormat } | null;
  readonly targetProjectId: string | null;
}

export function createGenerationArtifact(source: GenerationArtifactSource): CompletedGenerationArtifact {
  return {
    uiSchema: source.uiSchema,
    generatedProject: source.generatedProject,
    fidelityMode: toFidelityMode(source.fidelity),
    generationTarget: "REACT_TAILWIND",
    sourceImageName: source.screenshot ? toSourceImageName(source.screenshot.name) : null,
    sourceImageMimeType: source.screenshot ? screenshotMimeType(source.screenshot.format) : null,
    targetProjectId: source.targetProjectId,
  };
}
