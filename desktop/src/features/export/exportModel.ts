import type { ToastModel } from "../feedback/toastModel.ts";
import { workingCopyFiles, type ExportErrorCode, type ExportFileInput } from "./exportPlan.ts";
import { buildRunnableExportPlan } from "./exportScaffold.ts";

export const EXPORT_TOAST_KEY = "code-export";
export const EXPORT_SUCCESS_TOAST_MS = 6000;

export type NativeExportResult =
  | { readonly status: "EXPORTED"; readonly folderName: string; readonly fileCount: number }
  | { readonly status: "CANCELLED" }
  | { readonly status: "FAILED"; readonly code: ExportErrorCode };

export interface NativeExportRequest {
  readonly files: readonly ExportFileInput[];
  readonly suggestedName: string;
}

/** The only bridge to the native side; it never receives or returns a filesystem path. */
export type NativeExport = (request: NativeExportRequest) => Promise<NativeExportResult>;

export type ExportStatus = "IDLE" | "EXPORTING";
export interface ExportState {
  readonly status: ExportStatus;
  readonly revision: number;
}

/** STALE: the session ended (sign-out/expiry) while the native export ran; nothing is reported. */
export type ExportOutcome = NativeExportResult | { readonly status: "STALE" };

export interface ExportDependencies {
  /** Working copy source; only read, never changed. */
  readonly editor: { getSnapshot(): { readonly files: readonly { readonly path: string; readonly content: string }[]; readonly drafts: ReadonlyMap<string, string> } };
  /** Name of the project the shown result belongs to; null for a local-only result. */
  readonly projectName: () => string | null;
  readonly nativeExport: NativeExport;
  readonly toasts: Pick<ToastModel, "show" | "dismissByKey">;
}

/** Plain-language message per stable code; raw codes never reach the user. */
export function exportErrorMessage(code: ExportErrorCode): string {
  switch (code) {
    case "NO_FILES":
    case "INVALID_PATH":
    case "PATH_TOO_LONG":
    case "DUPLICATE_PATH":
    case "INVALID_CONTENT": return "exportFailedInvalid";
    case "TOO_MANY_FILES":
    case "TOO_LARGE": return "exportFailedTooLarge";
    case "DESTINATION_INVALID": return "exportFailedDestination";
    case "PERMISSION_DENIED": return "exportFailedPermission";
    case "UNAVAILABLE": return "exportFailedUnavailable";
    case "IO_ERROR": return "exportFailed";
  }
}

/**
 * Exports the editor's working copy (Monaco drafts included) through the native command.
 * It reads the editor once per click and never changes the editor, preview or generation session.
 * One export at a time; a reset (sign-out/expiry) drops the late answer and its toast.
 */
export function createExportModel(deps: ExportDependencies) {
  let state: ExportState = Object.freeze({ status: "IDLE", revision: 0 });
  let inFlight: Promise<ExportOutcome> | null = null;
  let epoch = 0;
  const listeners = new Set<() => void>();

  function update(status: ExportStatus) {
    state = Object.freeze({ status, revision: state.revision + 1 });
    listeners.forEach((listener) => listener());
  }

  function report(result: NativeExportResult) {
    if (result.status === "CANCELLED") return;
    if (result.status === "EXPORTED") {
      deps.toasts.show({ key: EXPORT_TOAST_KEY, tone: "success", eyebrow: "toastEyebrowExport", message: "exportDone",
        messageParams: { folder: result.folderName, count: result.fileCount }, persistent: false, durationMs: EXPORT_SUCCESS_TOAST_MS });
      return;
    }
    deps.toasts.show({ key: EXPORT_TOAST_KEY, tone: "error", eyebrow: "toastEyebrowError",
      message: exportErrorMessage(result.code), persistent: true });
  }

  function exportWorkingCopy(): Promise<ExportOutcome> {
    if (inFlight) return inFlight;
    // Working copy (drafts included) plus the exporter-owned scaffold; one validation for both.
    const plan = buildRunnableExportPlan(workingCopyFiles(deps.editor.getSnapshot()), deps.projectName());
    if (!plan.ok) {
      const failed: NativeExportResult = { status: "FAILED", code: plan.code };
      report(failed);
      return Promise.resolve(failed);
    }
    const current = epoch;
    deps.toasts.dismissByKey(EXPORT_TOAST_KEY);
    update("EXPORTING");
    const request = (async (): Promise<ExportOutcome> => {
      let result: NativeExportResult;
      try { result = await deps.nativeExport({ files: plan.plan.files, suggestedName: plan.plan.suggestedName }); }
      catch { result = { status: "FAILED", code: "IO_ERROR" }; }
      if (current !== epoch) return { status: "STALE" };
      update("IDLE");
      report(result);
      return result;
    })().finally(() => { if (inFlight === request) inFlight = null; });
    inFlight = request;
    return request;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    exportWorkingCopy,
    /** Session boundary: forget the running export; its answer produces no toast. */
    reset() {
      ++epoch;
      inFlight = null;
      if (state.status !== "IDLE") update("IDLE");
    },
  };
}
export type ExportModel = ReturnType<typeof createExportModel>;
