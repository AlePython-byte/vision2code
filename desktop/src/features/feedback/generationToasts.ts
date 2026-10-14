import type { GenerationSessionState } from "../generation/generationSessionModel.ts";
import { defaultToastScheduler, type ToastInput, type ToastModel, type ToastScheduler } from "./toastModel.ts";

export const SAVE_TOAST_KEY = "generation-save";
export const RESTORE_TOAST_KEY = "generation-restore";
export const SAVED_TOAST_MS = 2500;
export const PROJECT_REQUIRED_TOAST_MS = 4000;
export const RESTORED_TOAST_MS = 2500;
/** A first save shorter than this never shows a progress toast. */
export const SAVING_TOAST_DELAY_MS = 700;

type SaveSession = Pick<GenerationSessionState, "artifact" | "origin" | "saveStatus" | "saveAttempts" | "restoreStatus" | "restoreError" | "generationId">;

export interface GenerationToastSource {
  getSnapshot(): SaveSession;
  subscribe(listener: () => void): () => void;
  /** Existing session retry; its own guard ignores calls unless the last save failed. */
  retrySave(): Promise<void>;
}

/** Pure mapping of a session snapshot to the save channel's toast; null means no toast. */
export function saveToastFor(state: SaveSession, retry: () => void): ToastInput | null {
  const key = SAVE_TOAST_KEY;
  switch (state.saveStatus) {
    case "SAVED":
      // A restored result reports through the restore channel instead.
      return state.origin === "RESTORED" ? null
        : { key, tone: "success", eyebrow: "toastEyebrowSaved", message: "saveStatusSaved", persistent: false, durationMs: SAVED_TOAST_MS };
    case "SAVE_FAILED":
      return { key, tone: "error", eyebrow: "toastEyebrowError", message: "saveStatusFailed", persistent: true, action: { label: "saveRetry", run: retry } };
    case "SAVING":
      return { key, tone: "progress", eyebrow: "toastEyebrowSaving", message: "toastSaving", persistent: true };
    case "PROJECT_REQUIRED":
      return { key, tone: "info", eyebrow: "toastEyebrowLocal", message: "saveStatusProjectRequired", persistent: false, durationMs: PROJECT_REQUIRED_TOAST_MS };
    case "NOT_PERSISTABLE":
      // No retry: sending the same artifact again cannot fix a generator or contract defect.
      return { key, tone: "error", eyebrow: "toastEyebrowError", message: "saveStatusNotPersistable", persistent: true };
    // The project deletion already reported its own outcome; a stale save toast must not linger.
    case "DETACHED":
    case "IDLE":
      return null;
  }
}

/**
 * Presents generation save/restore outcomes as toasts. Bound at the app boundary: the session model
 * knows nothing about toasts, and dismissing a toast never changes the session.
 */
export function bindGenerationToasts(
  session: GenerationToastSource,
  toasts: Pick<ToastModel, "show" | "dismissByKey" | "clear">,
  scheduler: Pick<ToastScheduler, "setTimeout" | "clearTimeout"> = defaultToastScheduler,
) {
  let previous = session.getSnapshot();
  let delayed: unknown | null = null;
  let disposed = false;

  function cancelDelayed() {
    if (delayed !== null) scheduler.clearTimeout(delayed);
    delayed = null;
  }

  const retry = () => { void session.retrySave(); };

  function present(state: SaveSession) {
    cancelDelayed();
    const toast = saveToastFor(state, retry);
    if (!toast) { toasts.dismissByKey(SAVE_TOAST_KEY); return; }
    // A retry replaces the failed toast at once; a first save only shows progress if it is slow.
    if (state.saveStatus === "SAVING" && state.saveAttempts <= 1) {
      toasts.dismissByKey(SAVE_TOAST_KEY);
      delayed = scheduler.setTimeout(() => {
        delayed = null;
        if (!disposed && session.getSnapshot().saveStatus === "SAVING") toasts.show(toast);
      }, SAVING_TOAST_DELAY_MS);
      return;
    }
    toasts.show(toast);
  }

  function presentRestore(before: SaveSession, state: SaveSession) {
    if (state.restoreStatus === "FAILED" && (before.restoreStatus !== "FAILED" || before.restoreError !== state.restoreError)) {
      toasts.show({ key: RESTORE_TOAST_KEY, tone: "error", eyebrow: "toastEyebrowHistory", persistent: true,
        message: state.restoreError === "NOT_FOUND" ? "restoreNotFound" : "restoreFailed" });
    } else if (state.restoreStatus === "LOADING") {
      toasts.dismissByKey(RESTORE_TOAST_KEY);
    } else if (before.restoreStatus === "LOADING" && state.restoreStatus === "IDLE" && state.origin === "RESTORED"
      && state.generationId !== null) {
      toasts.show({ key: RESTORE_TOAST_KEY, tone: "success", eyebrow: "toastEyebrowHistory", message: "toastRestored",
        persistent: false, durationMs: RESTORED_TOAST_MS });
    } else if (before.restoreStatus === "FAILED" && state.restoreStatus !== "FAILED") {
      toasts.dismissByKey(RESTORE_TOAST_KEY);
    }
  }

  const unsubscribe = session.subscribe(() => {
    if (disposed) return;
    const next = session.getSnapshot();
    const before = previous;
    previous = next;
    if (next.saveStatus !== before.saveStatus || next.saveAttempts !== before.saveAttempts || next.artifact !== before.artifact) {
      present(next);
    }
    presentRestore(before, next);
  });

  return {
    /** Sign-out or expiration: no pending timer and no toast survives for the next user. */
    reset() {
      cancelDelayed();
      previous = session.getSnapshot();
      toasts.clear();
    },
    dispose() {
      disposed = true;
      cancelDelayed();
      unsubscribe();
    },
  };
}
export type GenerationToastBinding = ReturnType<typeof bindGenerationToasts>;
