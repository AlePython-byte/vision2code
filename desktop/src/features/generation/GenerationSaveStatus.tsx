import { useSyncExternalStore } from "react";
import { useLabels } from "../preferences/useLabels";
import type { ProjectsModel } from "../projects/projectsModel";
import { projectName } from "../projects/projectTargetActions";
import type { GenerationSessionModel, GenerationSessionState } from "./generationSessionModel";

// TEMPORARY (TASK 009C): minimal save/restore feedback; 009D absorbs it into the projects experience.

const statusKeys = {
  IDLE: null,
  PROJECT_REQUIRED: "saveStatusProjectRequired",
  NOT_PERSISTABLE: "saveStatusNotPersistable",
  SAVING: "saveStatusSaving",
  SAVED: "saveStatusSaved",
  SAVE_FAILED: "saveStatusFailed",
} as const satisfies Record<GenerationSessionState["saveStatus"], string | null>;

export function GenerationSaveStatus({ session, projects }: { session: GenerationSessionModel; projects: ProjectsModel }) {
  const { t } = useLabels();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const projectsState = useSyncExternalStore(projects.subscribe, projects.getSnapshot, projects.getSnapshot);
  if (state.artifact === null && state.restoreStatus === "IDLE") return null;
  const statusKey = state.saveStatus === "SAVED" && state.origin === "RESTORED" ? "restoredResult" : statusKeys[state.saveStatus];
  const retrying = state.saveStatus === "SAVING" && state.saveAttempts > 1;
  return (
    <div className="generation-save-status" data-state={state.saveStatus}>
      {state.artifact && (
        <p className="input-help">
          {state.projectId
            ? t("resultTargetProject", { name: projectName(projectsState, state.projectId) ?? t("unknownProject") })
            : t("resultTargetLocal")}
        </p>
      )}
      <p role="status" aria-live="polite" aria-atomic="true">
        {state.restoreStatus === "LOADING" ? t("openingGeneration") : statusKey ? t(statusKey) : ""}
      </p>
      {(state.saveStatus === "SAVE_FAILED" || retrying) && (
        <button type="button" className="action-button secondary-button" disabled={state.saveStatus === "SAVING"}
          onClick={() => { void session.retrySave(); }}>
          {t("saveRetry")}
        </button>
      )}
      {state.restoreError && (
        <p role="alert" className="input-error">{t(state.restoreError === "NOT_FOUND" ? "restoreNotFound" : "restoreFailed")}</p>
      )}
    </div>
  );
}
