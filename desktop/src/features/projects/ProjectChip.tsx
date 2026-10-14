import { useSyncExternalStore } from "react";
import { useLabels } from "../preferences/useLabels";
import type { GenerationSessionModel } from "../generation/generationSessionModel";
import type { ProjectsModel } from "./projectsModel";
import { projectName } from "./projectTargetActions";

export function ProjectChip({ projects, session, analysisTargetProjectId, onChange }: {
  projects: ProjectsModel;
  session: GenerationSessionModel;
  analysisTargetProjectId: string | null | undefined;
  onChange: () => void;
}) {
  const { t } = useLabels();
  const state = useSyncExternalStore(projects.subscribe, projects.getSnapshot, projects.getSnapshot);
  const sessionState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const selected = projectName(state, state.selectedProjectId);
  const unsaved = sessionState.artifact !== null && (sessionState.saveStatus === "SAVE_FAILED"
    || (sessionState.saveStatus === "SAVING" && sessionState.saveAttempts > 1));
  return (
    <div className="project-target" role="group" aria-label={t("vaultProjectEyebrow")}>
      <div className="project-chip">
        <div className="project-chip-name"><p className="eyebrow">{t("vaultProjectEyebrow")}</p>
          <p title={selected ?? undefined}>{selected ?? t("vaultNoProject")}</p></div>
        <button type="button" className="action-button secondary-button" onClick={onChange}>
          {selected ? t("vaultChangeProject") : t("vaultChooseProject")}
        </button>
      </div>
      {analysisTargetProjectId !== undefined && <p className="input-help">
        {analysisTargetProjectId
          ? t("analysisTargetProject", { name: projectName(state, analysisTargetProjectId) ?? t("unknownProject") })
          : t("analysisTargetLocal")}
      </p>}
      <p className="project-result-line input-help" data-state={sessionState.saveStatus}>
        {sessionState.artifact && (sessionState.projectId
          ? t("resultLinked", { name: projectName(state, sessionState.projectId) ?? t("unknownProject") })
          : t("resultUnlinked"))}
        {unsaved && <>{" · "}{t("resultUnsaved")}{" · "}
          <button type="button" className="text-button" aria-label={t("saveRetry")}
            disabled={sessionState.saveStatus === "SAVING"} onClick={() => { void session.retrySave(); }}>
            {t("resultRetry")}
          </button>
        </>}
      </p>
    </div>
  );
}
