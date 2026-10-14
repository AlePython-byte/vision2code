import type { ToastModel } from "../feedback/toastModel.ts";
import type { ProjectsErrorCode } from "./projectsClient.ts";
import type { ProjectMutation, ProjectsModel } from "./projectsModel.ts";
import { validateProjectName } from "./projectTargetActions.ts";

export const PROJECT_MANAGE_TOAST_KEY = "project-manage";
export const PROJECT_MANAGE_TOAST_MS = 2500;

export type ProjectManageKind = "RENAME" | "DELETE";
/** DONE also covers deleting a project the server no longer has (404 is idempotent success). */
export type ProjectManageResult = "DONE" | "CANCELLED" | "FAILED" | "UNAUTHORIZED" | "NOT_FOUND";

export interface ProjectManageDialog {
  readonly kind: ProjectManageKind;
  readonly projectId: string;
  /** Name when the dialog opened (the rename field starts with it; delete names the project). */
  readonly name: string;
  /** Generations that a delete removes with the project; null when the list did not report a count. */
  readonly generationCount: number | null;
  /** Element that opened the dialog; focus returns to it when it is still in the document. */
  readonly trigger: HTMLElement | null;
  readonly status: "IDLE" | "PENDING" | "ERROR";
  readonly error: ProjectsErrorCode | null;
}

export interface ProjectManageState {
  readonly dialog: ProjectManageDialog | null;
  readonly revision: number;
}

export interface ProjectManageDependencies {
  readonly projects: Pick<ProjectsModel, "getSnapshot" | "renameProject" | "deleteProject">;
  /** Transient success / "no longer exists" notices on the existing toast channel. */
  readonly toasts: Pick<ToastModel, "show">;
  /**
   * The project is gone (deleted, or reported missing): the composition root detaches the current
   * result and clears the history and library caches for it. The projects model already removed it.
   */
  readonly onProjectRemoved: (projectId: string) => void;
}

function resultOf(mutation: ProjectMutation): ProjectManageResult {
  if (mutation.ok) return "DONE";
  if (mutation.code === "UNAUTHORIZED") return "UNAUTHORIZED";
  if (mutation.code === "NOT_FOUND") return "NOT_FOUND";
  return "FAILED";
}

/**
 * Rename and delete confirmations for one project at a time. Both are pessimistic: nothing changes
 * locally until the server confirms, and a failure keeps the dialog open with the error and a retry.
 * One request at a time: a double click or a second action while one runs never sends twice.
 * It never analyzes or generates, and it imports no UI, auth or toast implementation.
 */
export function createProjectManager(deps: ProjectManageDependencies) {
  let state: ProjectManageState = Object.freeze({ dialog: null, revision: 0 });
  let inFlight: Promise<ProjectManageResult> | null = null;
  let epoch = 0;
  const listeners = new Set<() => void>();

  function update(dialog: ProjectManageDialog | null) {
    state = Object.freeze({ dialog: dialog && Object.freeze(dialog), revision: state.revision + 1 });
    listeners.forEach((listener) => listener());
  }
  function patch(changes: Partial<ProjectManageDialog>) {
    if (state.dialog) update({ ...state.dialog, ...changes });
  }
  function notify(message: string, tone: "success" | "info") {
    deps.toasts.show({ key: PROJECT_MANAGE_TOAST_KEY, tone, eyebrow: "toastEyebrowProject",
      message, persistent: false, durationMs: PROJECT_MANAGE_TOAST_MS });
  }

  function open(kind: ProjectManageKind, projectId: string, trigger: HTMLElement | null): boolean {
    if (state.dialog || inFlight) return false;
    const project = deps.projects.getSnapshot().projects.find((item) => item.id === projectId);
    if (!project) return false;
    update({ kind, projectId, name: project.name, generationCount: project.generationCount ?? null,
      trigger, status: "IDLE", error: null });
    return true;
  }

  /** Runs one confirmed mutation for the open dialog; repeated calls share the same request. */
  function run(kind: ProjectManageKind, mutate: (projectId: string) => Promise<ProjectMutation | null>): Promise<ProjectManageResult> {
    const dialog = state.dialog;
    if (!dialog || dialog.kind !== kind) return Promise.resolve("CANCELLED");
    if (inFlight) return inFlight;
    const current = epoch;
    patch({ status: "PENDING", error: null });
    const request = (async (): Promise<ProjectManageResult> => {
      let mutation: ProjectMutation | null;
      try { mutation = await mutate(dialog.projectId); }
      catch { mutation = { ok: false, code: "UNKNOWN" }; }
      // Session ended (sign-out / expiry) meanwhile: its dialog is gone and nothing is reported.
      if (current !== epoch || mutation === null) return "CANCELLED";
      const result = resultOf(mutation);
      if (result === "DONE" || result === "NOT_FOUND") {
        if (kind === "DELETE" || result === "NOT_FOUND") deps.onProjectRemoved(dialog.projectId);
        update(null);
        notify(result === "NOT_FOUND" ? "projectManageGone" : kind === "DELETE" ? "projectDeleted" : "projectRenamed",
          result === "NOT_FOUND" ? "info" : "success");
      } else {
        patch({ status: "ERROR", error: mutation.ok ? null : mutation.code });
      }
      return result;
    })().finally(() => { if (inFlight === request) inFlight = null; });
    inFlight = request;
    return request;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Opens the rename dialog; ignored (false) while another dialog or request is active. */
    requestRename: (projectId: string, trigger: HTMLElement | null = null) => open("RENAME", projectId, trigger),
    requestDelete: (projectId: string, trigger: HTMLElement | null = null) => open("DELETE", projectId, trigger),
    /** Closes without changes; ignored while the request runs (its answer must land somewhere visible). */
    cancel(): ProjectManageResult {
      if (inFlight || !state.dialog) return "CANCELLED";
      update(null);
      return "CANCELLED";
    },
    /** Same validation as creating a project; an invalid name never reaches the server. */
    confirmRename(raw: string): Promise<ProjectManageResult> {
      const validation = validateProjectName(raw);
      if (!validation.ok) return Promise.resolve("FAILED");
      if (state.dialog?.kind === "RENAME" && !inFlight && validation.name === state.dialog.name) {
        update(null);
        return Promise.resolve("CANCELLED");
      }
      return run("RENAME", (projectId) => deps.projects.renameProject(projectId, validation.name));
    },
    confirmDelete(): Promise<ProjectManageResult> {
      return run("DELETE", (projectId) => deps.projects.deleteProject(projectId));
    },
    /** Session boundary: close any dialog and ignore the answer of a request still in flight. */
    reset() {
      ++epoch;
      inFlight = null;
      if (state.dialog) update(null);
    },
  };
}
export type ProjectManager = ReturnType<typeof createProjectManager>;
