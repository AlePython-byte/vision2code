import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Screenshot } from "../screenshot/loadScreenshot";
import { createAnalysisClient } from "./analysisClient";
import { createAnalysisModel } from "./analysisModel";

export function useAnalysis(screenshot: Screenshot | null, validating: boolean, onReplaced?: () => void) {
  const replaced = useRef(onReplaced);
  replaced.current = onReplaced;
  const [model] = useState(() => createAnalysisModel(createAnalysisClient(import.meta.env.VITE_API_BASE_URL), {
    onReplaced: () => replaced.current?.(),
  }));
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  useEffect(() => {
    model.setScreenshot(validating ? null : screenshot);
  }, [model, screenshot, validating]);
  useEffect(() => () => model.dispose(), [model]);
  return { state, model };
}
