import { useState, useSyncExternalStore, type FormEvent } from "react";
import { FolderPlus, History } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import type { GenerationSessionModel } from "../generation/generationSessionModel";
import type { ProjectsModel } from "./projectsModel";
import {
  createAndSelectProject, latestGenerationOf, projectName, validateProjectName, type ProjectNameError,
} from "./projectTargetActions";

/**
 * TEMPORARY (TASK 009C): minimal project selector inside the Capture Console.
 * It will be replaced/absorbed by the projects experience in TASK 009D; keep it intentionally small.
 */
export function ProjectTargetPanel({
  projects,
  session,
  analysisTargetProjectId,
  onOpenGeneration,
}: {
  projects: ProjectsModel;
  session: GenerationSessionModel;
  /** undefined: no analysis started; null: the current analysis has no project. */
  analysisTargetProjectId: string | null | undefined;
  onOpenGeneration: (projectId: string, generationId: string) => void;
}) {
  const { t } = useLabels();
  const state = useSyncExternalStore(projects.subscribe, projects.getSnapshot, projects.getSnapshot);
  const sessionState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<ProjectNameError | null>(null);
  const [createFailed, setCreateFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const latest = latestGenerationOf(state);
  // Shown while the save failed, and kept (disabled) during the retry so the line never jumps.
  const unsaved = sessionState.artifact !== null && (sessionState.saveStatus === "SAVE_FAILED"
    || (sessionState.saveStatus === "SAVING" && sessionState.saveAttempts > 1));
  const selectedId = state.selectedProjectId;
  const loadingList = state.status === "LOADING" && state.projects.length === 0;
  const selectionFailed = state.status === "ERROR" && selectedId !== null && state.selectedProject === null;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreateFailed(false);
    const validation = validateProjectName(name);
    if (!validation.ok) { setNameError(validation.error); return; }
    setNameError(null);
    setCreating(true);
    const result = await createAndSelectProject(projects, name);
    setCreating(false);
    if (result.status === "CREATED") setName("");
    else if (result.status === "INVALID") setNameError(result.error);
    else setCreateFailed(true);
  }

  return (
    <div className="project-target" role="group" aria-labelledby="project-target-title">
      <p id="project-target-title" className="eyebrow">{t("projectTargetTitle")}</p>
      <div className="output-stack-control">
        <label htmlFor="project-target-select" className="eyebrow">{t("projectSelectLabel")}</label>
        <select id="project-target-select" value={selectedId ?? ""} disabled={creating}
          aria-busy={state.status === "LOADING"}
          onChange={(event) => { setCreateFailed(false); void projects.selectProject(event.currentTarget.value || null); }}>
          <option value="">{loadingList ? t("projectsLoading") : t("projectNone")}</option>
          {state.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </div>
      <form className="project-create" onSubmit={(event) => { void create(event); }} noValidate>
        <label htmlFor="project-create-name" className="eyebrow">{t("projectNameLabel")}</label>
        <div className="project-create-row">
          <input id="project-create-name" type="text" value={name} placeholder={t("projectNamePlaceholder")}
            autoComplete="off" aria-invalid={nameError !== null}
            aria-describedby={nameError ? "project-create-error" : undefined}
            onChange={(event) => { setName(event.currentTarget.value); setNameError(null); }} />
          <button type="submit" className="action-button secondary-button" disabled={creating}>
            <FolderPlus aria-hidden="true" />{creating ? t("projectCreating") : t("projectCreate")}
          </button>
        </div>
        {nameError && <p id="project-create-error" role="alert" className="input-error">{t(nameError)}</p>}
        {createFailed && <p role="alert" className="input-error">{t("projectCreateFailed")}</p>}
      </form>
      {!createFailed && state.status === "ERROR" && (selectionFailed
        ? <p role="alert" className="input-error">{t("projectSelectFailed")}</p>
        : <p role="alert" className="input-error">
            {t("projectsLoadFailed")}{" "}
            <button type="button" className="text-button" onClick={() => { void projects.loadProjects(); }}>{t("projectsRetryLoad")}</button>
          </p>)}
      <button type="button" className="action-button secondary-button"
        disabled={!selectedId || !latest || sessionState.restoreStatus === "LOADING"}
        onClick={() => { if (selectedId && latest) onOpenGeneration(selectedId, latest); }}>
        <History aria-hidden="true" />{sessionState.restoreStatus === "LOADING" ? t("openingGeneration") : t("openLatestGeneration")}
      </button>
      {analysisTargetProjectId !== undefined && (
        <p className="input-help">
          {analysisTargetProjectId
            ? t("analysisTargetProject", { name: projectName(state, analysisTargetProjectId) ?? t("unknownProject") })
            : t("analysisTargetLocal")}
        </p>
      )}
      {/* Save/restore outcomes are floating toasts; this fixed-height line is the persistent fallback. */}
      <p className="project-result-line input-help" data-state={sessionState.saveStatus}>
        {sessionState.artifact && (sessionState.projectId
          ? t("resultLinked", { name: projectName(state, sessionState.projectId) ?? t("unknownProject") })
          : t("resultUnlinked"))}
        {unsaved && <>
          {" · "}{t("resultUnsaved")}{" · "}
          <button type="button" className="text-button" aria-label={t("saveRetry")}
            disabled={sessionState.saveStatus === "SAVING"} onClick={() => { void session.retrySave(); }}>
            {t("resultRetry")}
          </button>
        </>}
      </p>
    </div>
  );
}
