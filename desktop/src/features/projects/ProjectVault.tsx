import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Search, Plus, ArrowUpRight, RotateCw } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { i18n } from "../preferences/i18n";
import type { ProjectsModel } from "./projectsModel";
import type { GenerationSessionModel } from "../generation/generationSessionModel";
import type { ToastModel } from "../feedback/toastModel";
import { openVaultLatest, openVaultProject } from "./vaultActions";
import { projectAccent, projectState, relativeProjectDate, vaultTotals, visibleProjects,
  type VaultSort, type VaultStateFilter } from "./vaultSelectors";
import { NewProjectDialog } from "./NewProjectDialog";
import { isVaultSearchShortcut } from "./vaultKeyboard";

export function ProjectVault({ projects, session, toasts, onCapture, onEditor, now = () => new Date(), initialFilters, hasLocalEdits, confirmDiscard }: {
  projects: ProjectsModel;
  session: GenerationSessionModel;
  toasts: ToastModel;
  onCapture: () => void;
  onEditor: () => void;
  now?: () => Date;
  initialFilters?: { query?: string; state?: VaultStateFilter; sort?: VaultSort };
  /** Opening a generation replaces the working copy; unsaved editor drafts must be confirmed first. */
  hasLocalEdits?: () => boolean;
  confirmDiscard?: (trigger: HTMLElement | null) => Promise<boolean>;
}) {
  const { t } = useLabels();
  const language = i18n.language.startsWith("en") ? "en" : "es";
  const state = useSyncExternalStore(projects.subscribe, projects.getSnapshot, projects.getSnapshot);
  const search = useRef<HTMLInputElement>(null);
  const dialogTrigger = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState(initialFilters?.query ?? "");
  const [filter, setFilter] = useState<VaultStateFilter>(initialFilters?.state ?? "ALL");
  const [sort, setSort] = useState<VaultSort>(initialFilters?.sort ?? "RECENT");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const shortcut = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  const visible = visibleProjects(state.projects, query, filter, sort, language);
  const totals = vaultTotals(visible);
  const firstLoad = (state.status === "IDLE" || state.status === "LOADING") && state.projects.length === 0;
  function showDialog(trigger: HTMLButtonElement) { dialogTrigger.current = trigger; setDialogOpen(true); }

  useEffect(() => {
    function shortcutKey(event: globalThis.KeyboardEvent) {
      if (isVaultSearchShortcut(event) && !dialogOpen) {
        event.preventDefault();
        search.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcutKey);
    return () => window.removeEventListener("keydown", shortcutKey);
  }, [dialogOpen]);

  async function open(projectId: string, latest?: string, trigger: HTMLElement | null = null) {
    if (opening) return;
    // Nothing (selection, drafts, session) changes until the user confirms discarding local edits.
    if (latest && hasLocalEdits?.() && !(confirmDiscard && await confirmDiscard(trigger))) return;
    setOpening(projectId);
    try {
      if (latest) await openVaultLatest(projects, session, toasts, projectId, latest, onEditor);
      else await openVaultProject(projects, toasts, projectId, onCapture);
    } finally { setOpening(null); }
  }

  return (
    <main id="project-vault" className="workspace vault" tabIndex={-1}>
      <header className="workspace-heading vault-heading">
        <div>
          <p className="eyebrow">{t("vaultEyebrow")}</p>
          <h1>{t("vaultTitle")}</h1>
          <p className="workspace-intro">{t("vaultIntro")}</p>
        </div>
        <button type="button" className="action-button primary-action" onClick={(event) => showDialog(event.currentTarget)}>
          <Plus aria-hidden="true" />{t("vaultNewProject")}
        </button>
      </header>

      <div className="vault-toolbar raised-panel" role="search">
        <div className="vault-search vault-well">
          <Search aria-hidden="true" />
          <label htmlFor="vault-search" className="eyebrow">{t("vaultSearch")}</label>
          <input ref={search} id="vault-search" type="search" value={query}
            onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("vaultSearchPlaceholder")} />
          <kbd aria-hidden="true">{shortcut}</kbd>
        </div>
        <div className="vault-select vault-well">
          <label htmlFor="vault-state" className="eyebrow">{t("vaultState")}</label>
          <select id="vault-state" value={filter} onChange={(event) => setFilter(event.currentTarget.value as VaultStateFilter)}>
            <option value="ALL">{t("vaultAll")}</option><option value="ACTIVE">{t("vaultActive")}</option>
            <option value="DRAFT">{t("vaultDraft")}</option>
          </select>
        </div>
        <div className="vault-select vault-well">
          <label htmlFor="vault-sort" className="eyebrow">{t("vaultSort")}</label>
          <select id="vault-sort" value={sort} onChange={(event) => setSort(event.currentTarget.value as VaultSort)}>
            <option value="RECENT">{t("vaultRecent")}</option><option value="NAME">{t("vaultName")}</option>
            <option value="GENERATIONS">{t("vaultGenerationsSort")}</option>
          </select>
        </div>
      </div>

      {!firstLoad && <div className="vault-results" aria-live="polite">
        <div><p className="eyebrow">{t("vaultMatching")}</p>
          <h2>{t("vaultProjectCount", { count: totals.projects })}</h2></div>
        <p className="eyebrow">{t("vaultGenerationCount", { count: totals.generations })}</p>
      </div>}

      {state.status === "ERROR" && !(state.selectedProjectId && !state.selectedProject) && !dialogOpen && <div className="vault-message vault-error" role="alert">
        <span className="status-dot" aria-hidden="true" />
        <div><p className="eyebrow">{t("vaultErrorCode")} · {state.error}</p><p>{t("projectsLoadFailed")}</p></div>
        <button type="button" className="action-button secondary-button" onClick={() => { void projects.loadProjects(); }}>
          <RotateCw aria-hidden="true" />{t("projectsRetryLoad")}
        </button>
      </div>}

      {firstLoad && <><p className="eyebrow">{t("projectsLoading")}</p>
        <ul className="vault-grid vault-skeletons" aria-label={t("projectsLoading")}>
          {Array.from({ length: 6 }, (_, index) => <li key={index} className="vault-card raised-panel" aria-hidden="true">
            <p className="eyebrow">{t("vaultLoadingModule")}</p><div className="vault-thumbnail"><span /><span /><span /></div>
          </li>)}
        </ul>
      </>}
      {!firstLoad && state.projects.length === 0 && state.status !== "ERROR" && <div className="vault-message vault-empty">
        <button type="button" className="upload-mark" aria-label={t("vaultCreateFirst")} onClick={(event) => showDialog(event.currentTarget)}><Plus aria-hidden="true" /></button>
        <h2>{t("vaultEmptyTitle")}</h2><p>{t("vaultEmptyHelp")}</p>
        <button type="button" className="action-button secondary-button" onClick={(event) => showDialog(event.currentTarget)}>{t("vaultCreateFirst")}</button>
      </div>}
      {!firstLoad && state.projects.length > 0 && visible.length === 0 && <div className="vault-message vault-no-results">
        <Search aria-hidden="true" /><h2>{t("vaultNoResults")}</h2><p>{t("vaultNoResultsHelp")}</p>
        <button type="button" className="action-button secondary-button" onClick={() => { setQuery(""); setFilter("ALL"); setSort("RECENT"); }}>
          {t("vaultClearFilters")}
        </button>
      </div>}
      {!firstLoad && visible.length > 0 && <ul className="vault-grid">
        {visible.map((project) => {
          const active = projectState(project) === "ACTIVE";
          const accent = projectAccent(project.id);
          return <li key={project.id} className="vault-card raised-panel" data-accent={accent}>
            <div className="vault-card-top"><span className={`vault-led ${active ? "active" : "draft"}`} aria-hidden="true" />
              <span className="eyebrow">{active ? t("vaultActive") : t("vaultDraft")}</span></div>
            <div className="vault-thumbnail" aria-hidden="true"><span /><span /><span /></div>
            <button type="button" className="vault-card-open" title={project.name} disabled={opening !== null}
              aria-label={t("vaultOpenProject", { name: project.name })} onClick={() => { void open(project.id); }}>
              <span>{project.name}</span><ArrowUpRight aria-hidden="true" />
            </button>
            <div className="vault-card-footer"><span>{t("vaultGenerationCount", { count: project.generationCount ?? 0 })}</span>
              <time dateTime={project.updatedAt}>{relativeProjectDate(project.updatedAt, language, now())}</time></div>
            {project.latestGenerationId && <button type="button" className="vault-latest" disabled={opening !== null}
              aria-label={t("vaultOpenLatestProject", { name: project.name })}
              onClick={(event) => { void open(project.id, project.latestGenerationId!, event.currentTarget); }}>
              {t("vaultOpenLatest")}<ArrowUpRight aria-hidden="true" />
            </button>}
          </li>;
        })}
      </ul>}
      {dialogOpen && <NewProjectDialog projects={projects} trigger={dialogTrigger} onClose={() => setDialogOpen(false)} onCreated={onCapture} />}
    </main>
  );
}
