import type { GeneratedFile } from "../generation/generatedProject.ts";

/** Entry file the preview runtime will mount. Matches the deterministic generator output. */
export const PREVIEW_ENTRY_PATH = "src/App.tsx";

export type PreviewStatus = "EMPTY" | "READY" | "RENDERING" | "SUCCESS" | "ERROR";

/** Stable error codes only. Raw engine errors are never stored or shown. */
export type PreviewErrorCode = "NO_ENTRY" | "ENGINE_FAILURE";

/** Immutable, detached copy of the project the preview works on. */
export interface PreviewProject {
  readonly target: "react-tailwind";
  readonly generatorVersion: "1" | "2" | "3";
  readonly files: readonly Readonly<GeneratedFile>[];
}

/** Execution engines: placeholder (Task 007A) or local-isolated (Task 007B). */
export type PreviewEngineKind = "placeholder" | "local-isolated";

export interface PreviewRenderResult {
  readonly documentHtml: string;
}

export interface PreviewEngine {
  readonly kind: PreviewEngineKind;
  render(project: PreviewProject, signal: AbortSignal): Promise<PreviewRenderResult | void>;
}

export interface PreviewState {
  readonly status: PreviewStatus;
  readonly project: PreviewProject | null;
  /** Increments on every transition that supersedes in-flight work. */
  readonly revision: number;
  readonly engine: PreviewEngineKind;
  readonly error: PreviewErrorCode | null;
  /** Generated standalone HTML document containing the isolated rendered project. */
  readonly documentHtml: string | null;
}
