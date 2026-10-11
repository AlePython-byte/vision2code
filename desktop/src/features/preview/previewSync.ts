import type { EditorModel, EditorState } from "../editor/editorModel.ts";
import type { GeneratedProject } from "../generation/generatedProject.ts";
import { projectFromEditorState } from "./previewInput.ts";
import type { PreviewModel } from "./previewModel.ts";

/** Default restrained debounce interval in milliseconds for Live Preview compilation. */
export const DEFAULT_PREVIEW_SYNC_DEBOUNCE_MS = 400;

export interface DebounceScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (timerId: unknown) => void;
}

const defaultScheduler: DebounceScheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface PreviewSyncOptions {
  /** Debounce delay in milliseconds. Defaults to 400ms. */
  readonly debounceMs?: number;
  /** Injected scheduler for deterministic test control. Defaults to system timers. */
  readonly scheduler?: DebounceScheduler;
  /** Whether to immediately render an already loaded editor project upon initialization. Defaults to true. */
  readonly immediateInitial?: boolean;
}

export interface PreviewSyncController {
  /** Disposes the editor subscription and cancels any pending debounce timers. */
  readonly dispose: () => void;
  /** Immediately executes any pending debounced compilation without waiting. */
  readonly flush: () => Promise<void>;
  /** Whether a debounced compilation is currently scheduled. */
  readonly isPending: () => boolean;
}

function getEffectiveFileContents(state: EditorState): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of state.files) {
    map.set(file.path, state.drafts.get(file.path) ?? file.content);
  }
  return map;
}

function hasContentChanged(prev: Map<string, string>, current: Map<string, string>): boolean {
  if (prev.size !== current.size) return true;
  for (const [path, content] of current) {
    if (prev.get(path) !== content) return true;
  }
  return false;
}

/**
 * Coordinates in-memory Monaco editor drafts with the sandboxed Live Preview.
 *
 * Responsibilities:
 * 1. Subscribes to editorModel state changes.
 * 2. Filters out non-source updates (active file selection, copy feedback).
 * 3. Immediately synchronizes project replacements and restores (reset).
 * 4. Debounces typing modifications with a restrained ~400ms interval.
 * 5. Uses projectFromEditorState to overlay unsaved drafts cleanly.
 * 6. Disposes cleanly without memory leaks or dangling timer references.
 */
export function syncEditorToPreview(
  editorModel: EditorModel,
  previewModel: PreviewModel,
  options: PreviewSyncOptions = {}
): PreviewSyncController {
  const debounceMs = options.debounceMs ?? DEFAULT_PREVIEW_SYNC_DEBOUNCE_MS;
  const scheduler = options.scheduler ?? defaultScheduler;
  const immediateInitial = options.immediateInitial ?? true;

  let activeTimer: unknown = null;
  let lastProjectRef: GeneratedProject | null = null;
  let lastEffectiveContents = new Map<string, string>();
  let disposed = false;

  function cancelPendingTimer() {
    if (activeTimer !== null) {
      scheduler.clearTimeout(activeTimer);
      activeTimer = null;
    }
  }

  // Initialize baseline from current editor state
  const initialState = editorModel.getSnapshot();
  if (initialState.project) {
    lastProjectRef = initialState.project;
    lastEffectiveContents = getEffectiveFileContents(initialState);
    if (immediateInitial && previewModel.getSnapshot().status === "EMPTY") {
      const initialProject = projectFromEditorState(initialState);
      previewModel.setProject(initialProject);
      void previewModel.render();
    }
  }

  function onEditorChange() {
    if (disposed) return;
    const state = editorModel.getSnapshot();

    // 1. Project cleared
    if (!state.project) {
      cancelPendingTimer();
      lastProjectRef = null;
      lastEffectiveContents.clear();
      previewModel.clear();
      return;
    }

    // 2. Project replaced with a new instance
    if (state.project !== lastProjectRef) {
      cancelPendingTimer();
      lastProjectRef = state.project;
      lastEffectiveContents = getEffectiveFileContents(state);
      const nextProject = projectFromEditorState(state);
      previewModel.setProject(nextProject);
      void previewModel.render();
      return;
    }

    // 3. Compare effective source file contents
    const currentContents = getEffectiveFileContents(state);
    if (!hasContentChanged(lastEffectiveContents, currentContents)) {
      // No source content modification (e.g. file selection change or clipboard feedback)
      return;
    }

    // 4. Project reset ("Restore project") - immediate update back to original
    if (state.drafts.size === 0 && lastEffectiveContents.size > 0) {
      cancelPendingTimer();
      lastEffectiveContents = currentContents;
      const nextProject = projectFromEditorState(state);
      previewModel.setProject(nextProject);
      void previewModel.render();
      return;
    }

    // 5. Source code modified (typing in Monaco) -> Debounce preview render
    cancelPendingTimer();
    activeTimer = scheduler.setTimeout(() => {
      activeTimer = null;
      if (disposed) return;
      const latestState = editorModel.getSnapshot();
      if (!latestState.project) return;
      lastEffectiveContents = getEffectiveFileContents(latestState);
      const nextProject = projectFromEditorState(latestState);
      previewModel.setProject(nextProject);
      void previewModel.render();
    }, debounceMs);
  }

  const unsubscribe = editorModel.subscribe(onEditorChange);

  async function flush(): Promise<void> {
    if (activeTimer !== null) {
      scheduler.clearTimeout(activeTimer);
      activeTimer = null;
      if (disposed) return;
      const latestState = editorModel.getSnapshot();
      if (!latestState.project) return;
      lastEffectiveContents = getEffectiveFileContents(latestState);
      const nextProject = projectFromEditorState(latestState);
      previewModel.setProject(nextProject);
      await previewModel.render();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelPendingTimer();
    unsubscribe();
  }

  return {
    dispose,
    flush,
    isPending: () => activeTimer !== null,
  };
}

