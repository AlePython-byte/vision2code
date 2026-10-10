import type { PreviewEngine } from "./previewTypes.ts";

/**
 * Placeholder engine: validates nothing, executes nothing, performs no I/O.
 * It exists so the model lifecycle is real while the isolated runtime is built later.
 */
export function createPlaceholderPreviewEngine(): PreviewEngine {
  return {
    kind: "placeholder",
    async render(_project, signal) {
      signal.throwIfAborted();
    },
  };
}

