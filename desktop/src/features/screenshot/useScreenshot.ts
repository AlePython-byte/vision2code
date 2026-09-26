import { useEffect, useRef, useState } from "react";
import { loadScreenshot } from "./loadScreenshot";
import type { Screenshot } from "./loadScreenshot";
import { ScreenshotValidationError } from "./validation";

export type ScreenshotStatus = "EMPTY" | "DRAGGING" | "VALIDATING" | "READY" | "ERROR";

interface ScreenshotState {
  status: Exclude<ScreenshotStatus, "DRAGGING">;
  screenshot: Screenshot | null;
  error: string | null;
}

export function useScreenshot() {
  const [state, setState] = useState<ScreenshotState>({ status: "EMPTY", screenshot: null, error: null });
  const [dragging, setDragging] = useState(false);
  const request = useRef<AbortController | null>(null);
  const currentUrl = useRef<string | null>(null);

  useEffect(() => () => {
    request.current?.abort();
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null;
  }, []);

  async function selectFiles(files: readonly File[]) {
    if (files.length === 0) return;
    request.current?.abort();
    setDragging(false);
    const controller = new AbortController();
    request.current = controller;
    if (files.length !== 1) {
      setState((previous) => ({ ...previous, status: "ERROR", error: "Selecciona una sola imagen a la vez." }));
      return;
    }
    const file = files[0];
    if (!file) return;
    setState((previous) => ({ ...previous, status: "VALIDATING", error: null }));
    try {
      const screenshot = await loadScreenshot(file, controller.signal);
      if (controller.signal.aborted) {
        URL.revokeObjectURL(screenshot.url);
        return;
      }
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = screenshot.url;
      setState({ status: "READY", screenshot, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState((previous) => ({
        ...previous,
        status: "ERROR",
        error: error instanceof ScreenshotValidationError
          ? error.message
          : "No se pudo leer la imagen. Intenta seleccionarla de nuevo.",
      }));
    }
  }

  function removeScreenshot() {
    request.current?.abort();
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null;
    setDragging(false);
    setState({ status: "EMPTY", screenshot: null, error: null });
  }

  return { ...state, status: dragging ? "DRAGGING" as const : state.status, setDragging, selectFiles, removeScreenshot };
}
