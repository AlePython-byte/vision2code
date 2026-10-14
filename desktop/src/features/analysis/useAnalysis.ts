import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Screenshot } from "../screenshot/loadScreenshot";
import { createAnalysisClient, type AnalyzeScreenshot } from "./analysisClient";
import { createAnalysisModel } from "./analysisModel";

/** `analyzeScreenshot` is the authenticated client from the workspace services; the fallback sends no token. */
export function useAnalysis(screenshot: Screenshot | null, validating: boolean, onReplaced?: () => void, analyzeScreenshot?: AnalyzeScreenshot) {
  const replaced = useRef(onReplaced);
  replaced.current = onReplaced;
  const [model] = useState(() => createAnalysisModel(analyzeScreenshot ?? createAnalysisClient(import.meta.env.VITE_API_BASE_URL), {
    onReplaced: () => replaced.current?.(),
  }));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    model.setScreenshot(validating ? null : screenshot);
  }, [model, screenshot, validating]);
  useEffect(() => () => model.dispose(), [model]);
  return { state, model };
}
