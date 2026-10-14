import { useSyncExternalStore } from "react";
import { useLabels } from "../preferences/useLabels";
import type { EditorModel } from "../editor/editorModel";
import type { GenerationSessionModel } from "../generation/generationSessionModel";
import type { DiscardGuard } from "../projects/discardGuard";
import type { GenerationHistoryModel } from "../projects/generationHistoryModel";
import { GenerationHistoryTray } from "../projects/GenerationHistoryTray";
import { deriveResultChip, generationNumberOf, resolveHistoryProjectId } from "../projects/historySelectors";
import type { ProjectsModel } from "../projects/projectsModel";
import { projectName } from "../projects/projectTargetActions";

/** Project identity, result status chip and history key shown in the Code view header. */
export function CodeContext({ editor, session, projects, history, discardGuard, now }: {
  editor: EditorModel;
  session: GenerationSessionModel;
  projects: ProjectsModel;
  history: GenerationHistoryModel;
  discardGuard: DiscardGuard;
  now?: () => Date;
}) {
  const { t } = useLabels();
  const editorState = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const sessionState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const projectsState = useSyncExternalStore(projects.subscribe, projects.getSnapshot, projects.getSnapshot);
  const historyState = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  const projectId = resolveHistoryProjectId(sessionState, projectsState);
  const name = projectId ? (projectName(projectsState, projectId) ?? t("unknownProject")) : t("vaultNoProject");
  const chip = deriveResultChip({
    origin: sessionState.artifact ? sessionState.origin : null,
    saveStatus: sessionState.saveStatus,
    draftCount: editorState.drafts.size,
    generationNumber: generationNumberOf(historyState.items, sessionState.generationId),
  });
  const chipLabel = !chip ? "" : chip.label === "chipRestored"
    ? (chip.number === null ? t("chipRestoredPlain") : t("chipRestored", { number: String(chip.number).padStart(2, "0") }))
    : t(chip.label);
  return (
    <div className="code-context">
      <div className="code-identity" role="group" aria-label={t("vaultProjectEyebrow")}>
        <p className="eyebrow">{t("vaultProjectEyebrow")}</p>
        <p className="code-identity-name" title={name}>{name}</p>
      </div>
      <div className="code-chips">
        {chip && <span className="result-chip" data-tone={chip.tone}><span className="result-led" aria-hidden="true" />{chipLabel}</span>}
        {chip?.edited && <span className="result-chip" data-tone="edited"><span className="result-led" aria-hidden="true" />{t("chipEdited")}</span>}
      </div>
      <GenerationHistoryTray history={history} session={session} now={now ?? (() => new Date())}
        hasLocalEdits={() => editor.getSnapshot().drafts.size > 0}
        confirmDiscard={(trigger) => discardGuard.request(trigger)} />
    </div>
  );
}
