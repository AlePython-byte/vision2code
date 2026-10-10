import type { GeneratedFile } from "../generation/generatedProject.ts";

/** Entry file the preview runtime will mount. Matches the deterministic generator output. */
export const PREVIEW_ENTRY_PATH = "src/App.tsx";

export type PreviewStatus = "EMPTY" | "READY" | "RENDERING" | "SUCCESS" | "ERROR";

/** Stable error codes only. Raw engine errors are never stored or shown. */
export type PreviewErrorCode = "NO_ENTRY" | "ENGINE_FAILURE";

/** Immutable, detached copy of the project the preview works on. */
export interface PreviewProject {
  readonly target: "react-tailwind";
  readonly generatorVersion: "1";
  readonly files: readonly Readonly<GeneratedFile>[];
}

/**
 * Execution seam. The current engine is a placeholder that executes nothing.
 * A future engine must run code inside an isolated, credential-free origin.
 */
export type PreviewEngineKind = "placeholder";

export interface PreviewEngine {
  readonly kind: PreviewEngineKind;
  render(project: PreviewProject, signal: AbortSignal): Promise<void>;
}

export interface PreviewState {
  readonly status: PreviewStatus;
  readonly project: PreviewProject | null;
  /** Increments on every transition that supersedes in-flight work. */
  readonly revision: number;
  readonly engine: PreviewEngineKind;
  readonly error: PreviewErrorCode | null;
}

