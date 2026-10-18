import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { ChevronRight, RotateCw, X } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { i18n } from "../preferences/i18n";
import { toSourceImageName } from "../generation/generationArtifact";
import type { GenerationSessionModel } from "../generation/generationSessionModel";
import { chooseLibraryGeneration } from "./libraryActions";
import type { LibraryModel } from "./libraryModel";
import { formatGenerationNumber, generationNumber, relativeTimeLabel } from "./historySelectors";
import type { ProjectsModel } from "./projectsModel";
import { handleVaultDialogKey } from "./vaultKeyboard";
import { FidelityChip, SchemaThumbnail, ThumbnailSlot } from "./SchemaThumbnail";
import type { ThumbnailModel } from "./thumbnailModel";

interface SheetProps {
  library: LibraryModel;
  projects: ProjectsModel;
  session: GenerationSessionModel;
  hasLocalEdits: () => boolean;
  confirmDiscard: (trigger: HTMLElement | null) => Promise<boolean>;
  openCode: () => void;
  now: () => Date;
  trigger: HTMLElement | null;
  initialProjectId: string | null;
  thumbnails?: ThumbnailModel | undefined;
}

function LibrarySheet({ library, projects, session, hasLocalEdits, confirmDiscard, openCode, now, trigger, initialProjectId, thumbnails }: SheetProps) {
  const { t } = useLabels();
  const language = i18n.language.startsWith("en") ? "en" : "es";
  const libraryState = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
  const projectsState = useSyncExternalStore(projects.subscribe, projects.getSnapshot, projects.getSnapshot);
  const sessionState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const sheet = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  // Synchronous guard against a second pick before the first restore settles.
  const restoring = useRef(false);
  const [expanded, setExpanded] = useState<string | null>(initialProjectId);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    closeButton.current?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [trigger]);

  useEffect(() => {
    // Lazy: a project's generations are requested only when its panel is expanded.
    if (expanded) void library.loadProject(expanded);
  }, [expanded, library]);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    const focusable = Array.from(sheet.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
    handleVaultDialogKey(event, false, focusable, document.activeElement, library.closeDialog);
  }

  async function choose(projectId: string, generationId: string, button: HTMLElement) {
    if (restoring.current) return;
    restoring.current = true;
    setOpening(generationId);
    try {
      await chooseLibraryGeneration({
        session, library, projectId, generationId, currentGenerationId: sessionState.generationId,
        hasLocalEdits, confirmDiscard, trigger: button, openCode,
      });
    } finally { restoring.current = false; setOpening(null); }
  }

  const projectList = projectsState.projects;
  return (
    <div className="vault-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) library.closeDialog(); }}>
      <div ref={sheet} className="vault-dialog library-dialog raised-panel" role="dialog" aria-modal="true"
        aria-labelledby="library-dialog-title" onKeyDown={keys}>
        <header className="library-header">
          <div>
            <p className="eyebrow">{t("libraryEyebrow")}</p>
            <h2 id="library-dialog-title">{t("libraryTitle")}</h2>
          </div>
          <button ref={closeButton} type="button" className="action-button secondary-button library-close"
            aria-label={t("libraryClose")} title={t("libraryClose")} onClick={library.closeDialog}>
            <X aria-hidden="true" />
          </button>
        </header>
        {projectList.length === 0 && <p className="history-note">
          {projectsState.status === "LOADING" || projectsState.status === "IDLE" ? t("projectsLoading") : t("libraryEmpty")}
        </p>}
        {projectList.length > 0 && <ul className="library-projects">
          {projectList.map((project) => {
            const entry = libraryState.entries[project.id];
            const open = expanded === project.id;
            const count = entry?.status === "READY" ? entry.items.length : (project.generationCount ?? 0);
            const panelId = `library-panel-${project.id}`;
            return <li key={project.id} className="library-project" data-open={open}>
              <button type="button" className="library-project-toggle" aria-expanded={open} aria-controls={panelId}
                onClick={() => setExpanded(open ? null : project.id)}>
                <ChevronRight aria-hidden="true" />
                <span className="library-project-name" title={project.name}>{project.name}</span>
                <span className="library-project-count">{t("vaultGenerationCount", { count })}</span>
              </button>
              {open && <div id={panelId} className="library-panel" role="region" aria-label={t("libraryRegion", { name: project.name })}>
                {(!entry || (entry.status === "LOADING" && entry.items.length === 0)) && <ul className="library-generations library-skeleton" aria-label={t("libraryLoading")}>
                  {[0, 1, 2].map((row) => <li key={row} className="library-card" aria-hidden="true">
                    <SchemaThumbnail state="loading" size="md" /><span className="vault-skeleton-line" /><span className="vault-skeleton-line short" />
                  </li>)}
                </ul>}
                {entry?.status === "ERROR" && <div className="history-error" role="alert">
                  <p>{t(entry.items.length > 0 ? "libraryStale" : "libraryError")}</p>
                  <button type="button" className="action-button secondary-button" onClick={() => { void library.retry(project.id); }}>
                    <RotateCw aria-hidden="true" />{t("historyRetry")}
                  </button>
                </div>}
                {entry?.status === "READY" && entry.items.length === 0 && <p className="history-note">{t("libraryNoGenerations")}</p>}
                {entry && entry.items.length > 0 && <ul className="library-generations">
                  {entry.items.map((item, index) => {
                    const current = item.id === sessionState.generationId;
                    const source = item.sourceImageName ? toSourceImageName(item.sourceImageName) : null;
                    return <li key={item.id} className="library-card" data-current={current}>
                      <div className="library-card-media">
                        <ThumbnailSlot thumbnails={thumbnails} projectId={project.id} generationId={item.id}
                          emptyCaption={t("thumbNoGenerations")} unavailableCaption={t("thumbUnavailable")} />
                        <FidelityChip mode={item.fidelityMode} />
                      </div>
                      {/* The button's ::after covers the whole card, so the thumbnail is part of the click target. */}
                      <button type="button" className="library-card-open" aria-current={current ? "true" : undefined} aria-busy={opening === item.id}
                        disabled={opening !== null && opening !== item.id}
                        onClick={(event) => { void choose(project.id, item.id, event.currentTarget); }}>
                        <span className="library-card-title">
                          {t("historyGeneration", { number: formatGenerationNumber(generationNumber(entry.items, index)) })}
                          {current && <span className="history-current-tag">{t("historyCurrent")}</span>}
                        </span>
                        {opening === item.id && <span className="history-busy">{t("openingGeneration")}</span>}
                      </button>
                      <div className="library-card-meta">
                        <time dateTime={item.createdAt}>{relativeTimeLabel(item.createdAt, language, now())}</time>
                      </div>
                      {source && <span className="library-card-source" title={source}>{source}</span>}
                    </li>;
                  })}
                </ul>}
              </div>}
            </li>;
          })}
        </ul>}
      </div>
    </div>
  );
}

/** Modal library of projects and their generations, reachable from any view; hosted once at app level. */
export function LibraryDialog({ library, projects, session, hasLocalEdits, confirmDiscard, openCode, now = () => new Date(), thumbnails }: {
  library: LibraryModel;
  projects: ProjectsModel;
  session: GenerationSessionModel;
  hasLocalEdits: () => boolean;
  confirmDiscard: (trigger: HTMLElement | null) => Promise<boolean>;
  openCode: () => void;
  now?: () => Date;
  thumbnails?: ThumbnailModel | undefined;
}) {
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
  if (!state.open) return null;
  return <LibrarySheet library={library} projects={projects} session={session} hasLocalEdits={hasLocalEdits}
    confirmDiscard={confirmDiscard} openCode={openCode} now={now} trigger={state.trigger} initialProjectId={state.focusProjectId} thumbnails={thumbnails} />;
}
