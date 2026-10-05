import type { AnalysisResponse } from "@vision2code/contracts";
import type { Screenshot } from "../screenshot/loadScreenshot.ts";
import { AnalysisClientError } from "./analysisClient.ts";
import type { AnalyzeScreenshot } from "./analysisClient.ts";

export type AnalysisStatus = "IDLE" | "READY" | "ANALYZING" | "SUCCESS" | "ERROR";
export interface AnalysisState {
  status: AnalysisStatus;
  screenshot: Screenshot | null;
  result: AnalysisResponse | null;
  error: string | null;
  errorRequestId: string | null;
}
export function canAnalyze(state: AnalysisState): boolean {
  return state.screenshot !== null && state.status !== "ANALYZING";
}

// A screen-scoped model independent of React. Task 005 can consume result.uiSchema directly.
export function createAnalysisModel(analyzeScreenshot: AnalyzeScreenshot) {
  let state: AnalysisState = { status: "IDLE", screenshot: null, result: null, error: null, errorRequestId: null };
  let active: AbortController | null = null;
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
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setScreenshot(screenshot: Screenshot | null) {
      if (state.screenshot === screenshot) return;
      stop();
      update({ status: screenshot ? "READY" : "IDLE", screenshot, result: null, error: null, errorRequestId: null });
    },
    async analyze() {
      if (!canAnalyze(state) || !state.screenshot) return;
      const screenshot = state.screenshot;
      const controller = new AbortController();
      active = controller;
      update({ ...state, status: "ANALYZING", result: null, error: null, errorRequestId: null });
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
      update({ status: "IDLE", screenshot: null, result: null, error: null, errorRequestId: null });
    },
  };
}
