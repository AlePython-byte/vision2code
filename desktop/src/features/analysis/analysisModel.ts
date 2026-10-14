import { generateReactProject } from "../generation/generateReactProject.ts";
import { createGenerationArtifact, type CompletedGenerationArtifact } from "../generation/generationArtifact.ts";
import { DEFAULT_VISUAL_FIDELITY, type VisualFidelity } from "./generationProfileModel.ts";
import type { AnalysisResponse } from "@vision2code/contracts";
import type { Screenshot } from "../screenshot/loadScreenshot.ts";
import { AnalysisClientError } from "./analysisClient.ts";
import type { AnalyzeScreenshot } from "./analysisClient.ts";

export type AnalysisStatus = "IDLE" | "READY" | "ANALYZING" | "SUCCESS" | "ERROR";
/** Snapshot taken when analyze() starts; later selection or profile changes never alter it. */
export interface AnalysisContext {
  readonly targetProjectId: string | null;
  readonly fidelity: VisualFidelity;
}
export interface AnalysisState {
  status: AnalysisStatus;
  screenshot: Screenshot | null;
  result: AnalysisResponse | null;
  error: string | null;
  errorRequestId: string | null;
  context?: AnalysisContext | null;
}
export interface AnalysisModelOptions {
  /** Called when a new analysis starts or the screenshot changes, invalidating the previous result. */
  onReplaced?: () => void;
}
export function canAnalyze(state: AnalysisState): boolean {
  return state.screenshot !== null && state.status !== "ANALYZING";
}

// A screen-scoped model independent of React; generation consumes only successful analysis.
export function createAnalysisModel(analyzeScreenshot: AnalyzeScreenshot, options: AnalysisModelOptions = {}) {
  let state: AnalysisState = { status: "IDLE", screenshot: null, result: null, error: null, errorRequestId: null };
  let active: AbortController | null = null;
  // One artifact per successful analysis, so generating twice hands the session the same identity.
  let artifactCache: { result: AnalysisResponse; artifact: CompletedGenerationArtifact } | null = null;
  const listeners = new Set<() => void>();
  function update(next: AnalysisState) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  function stop() {
    const previous = active;
    active = null;
    previous?.abort();
  }
  return {
    getSnapshot: () => state,
    generateReactProject: () => state.status === "SUCCESS" && state.result !== null
      ? generateReactProject(state.result.uiSchema) : null,
    /** Builds the persistable artifact from the successful analysis and the context captured at its start. */
    generateArtifact(): CompletedGenerationArtifact | null {
      if (state.status !== "SUCCESS" || state.result === null) return null;
      if (artifactCache?.result === state.result) return artifactCache.artifact;
      const uiSchema = state.result.uiSchema;
      const artifact = createGenerationArtifact({
        uiSchema,
        generatedProject: generateReactProject(uiSchema),
        fidelity: state.context?.fidelity ?? DEFAULT_VISUAL_FIDELITY,
        screenshot: state.screenshot,
        targetProjectId: state.context?.targetProjectId ?? null,
      });
      artifactCache = { result: state.result, artifact };
      return artifact;
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setScreenshot(screenshot: Screenshot | null) {
      if (state.screenshot === screenshot) return;
      stop();
      update({ status: screenshot ? "READY" : "IDLE", screenshot, result: null, error: null, errorRequestId: null, context: null });
      options.onReplaced?.();
    },
    async analyze(context: Partial<AnalysisContext> = {}) {
      if (!canAnalyze(state) || !state.screenshot) return;
      const screenshot = state.screenshot;
      const controller = new AbortController();
      active = controller;
      const captured: AnalysisContext = Object.freeze({
        targetProjectId: context.targetProjectId ?? null,
        fidelity: context.fidelity ?? DEFAULT_VISUAL_FIDELITY,
      });
      update({ ...state, status: "ANALYZING", result: null, error: null, errorRequestId: null, context: captured });
      options.onReplaced?.();
      try {
        const result = await analyzeScreenshot(screenshot, controller.signal);
        if (active !== controller || controller.signal.aborted) return;
        update({ ...state, status: "SUCCESS", result });
      } catch (error) {
        if (active !== controller || controller.signal.aborted) return;
        update({ ...state, status: "ERROR",
          error: error instanceof AnalysisClientError ? error.message : "No se pudo completar el análisis. Inténtalo de nuevo.",
          errorRequestId: error instanceof AnalysisClientError ? error.requestId : null });
      } finally {
        if (active === controller) active = null;
      }
    },
    cancel() {
      if (!active) return;
      stop();
      update({ ...state, status: "ERROR", result: null, error: "Análisis cancelado. Puedes volver a intentarlo.", errorRequestId: null });
    },
    dispose() {
      stop();
      update({ status: "IDLE", screenshot: null, result: null, error: null, errorRequestId: null, context: null });
    },
  };
}
