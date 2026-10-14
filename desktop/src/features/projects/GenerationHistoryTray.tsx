import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { History, RotateCw } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { i18n } from "../preferences/i18n";
import { toSourceImageName } from "../generation/generationArtifact";
import type { GenerationSessionModel } from "../generation/generationSessionModel";
import type { GenerationHistoryModel } from "./generationHistoryModel";
import { selectHistoryGeneration } from "./historyActions";
import { formatGenerationNumber, generationNumber, relativeTimeLabel } from "./historySelectors";

const fidelityKeys = { FAST: "fidelityFast", BALANCED: "fidelityBalanced", PRECISE: "fidelityPrecise" } as const;

/**
 * Popover "log tape" of the saved generations of the current project. It lists summaries only;
 * choosing an entry restores it through the session (never analysis, AI or the generator).
 */
export function GenerationHistoryTray({ history, session, hasLocalEdits, confirmDiscard, now = () => new Date() }: {
  history: GenerationHistoryModel;
  session: GenerationSessionModel;
  hasLocalEdits: () => boolean;
  confirmDiscard: (trigger: HTMLElement | null) => Promise<boolean>;
  now?: () => Date;
}) {
  const { t } = useLabels();
  const language = i18n.language.startsWith("en") ? "en" : "es";
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  const sessionState = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const root = useRef<HTMLDivElement>(null);
  const key = useRef<HTMLButtonElement>(null);
  // Synchronous guard: state captured by a render can lag a second click.
  const restoring = useRef(false);
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const hasProject = state.projectId !== null;
  const expanded = open && hasProject;

  useEffect(() => {
    if (!expanded) return;
    function outside(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [expanded]);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      setOpen(false);
      key.current?.focus();
    }
  }

  async function choose(generationId: string, trigger: HTMLElement) {
    if (restoring.current || state.projectId === null) return;
    restoring.current = true;
    setOpening(generationId);
    try {
      const outcome = await selectHistoryGeneration({
        session, projectId: state.projectId, generationId, currentGenerationId: sessionState.generationId,
        hasLocalEdits, confirmDiscard, trigger,
      });
      if (outcome === "CURRENT" || outcome === "OPENED") { setOpen(false); key.current?.focus(); }
    } finally { restoring.current = false; setOpening(null); }
  }

  const loading = state.status === "LOADING" && state.items.length === 0;
  const empty = state.status === "READY" && state.items.length === 0;
  return (
    <div ref={root} className="history" onKeyDown={keys}>
      <button ref={key} type="button" className="history-key action-button" aria-expanded={expanded}
        aria-controls="generation-history-tray" disabled={!hasProject}
        title={hasProject ? undefined : t("historyNoProject")}
        aria-label={hasProject ? t("historyKeyAria", { count: state.items.length }) : t("historyNoProject")}
        onClick={() => setOpen(!open)}>
        <History aria-hidden="true" /><span>{t("historyKey", { count: state.items.length })}</span>
      </button>
      {expanded && <div id="generation-history-tray" className="history-tray raised-panel" role="region" aria-label={t("historyTitle")}>
        <p className="eyebrow">{t("historyTitle")}</p>
        {loading && <ul className="history-log history-skeleton" aria-label={t("historyLoading")}>
          {[0, 1, 2].map((row) => <li key={row} className="history-entry" aria-hidden="true"><span className="history-led" /><span className="history-bar" /></li>)}
        </ul>}
        {empty && <p className="history-note">{t("historyEmpty")}</p>}
        {state.status === "ERROR" && <div className="history-error" role="alert">
          <p>{t("historyError")}</p>
          <button type="button" className="action-button secondary-button" onClick={() => { void history.retry(); }}>
            <RotateCw aria-hidden="true" />{t("historyRetry")}
          </button>
        </div>}
        {state.items.length > 0 && <ul className="history-log">
          {state.items.map((item, index) => {
            const current = item.id === sessionState.generationId;
            const source = item.sourceImageName ? toSourceImageName(item.sourceImageName) : null;
            return <li key={item.id} className="history-entry" data-current={current}>
              <button type="button" aria-current={current ? "true" : undefined} aria-busy={opening === item.id}
                disabled={opening !== null && opening !== item.id}
                onClick={(event) => { void choose(item.id, event.currentTarget); }}>
                <span className="history-led" aria-hidden="true" />
                <span className="history-entry-main">
                  <span className="history-entry-title">
                    {t("historyGeneration", { number: formatGenerationNumber(generationNumber(state.items, index)) })}
                    {current && <span className="history-current-tag">{t("historyCurrent")}</span>}
                  </span>
                  <time dateTime={item.createdAt}>{relativeTimeLabel(item.createdAt, language, now())}</time>
                  <span className="history-entry-meta">
                    {t("historyFidelity", { value: t(fidelityKeys[item.fidelityMode]) })}
                    {source && <> · <span className="history-source" title={source}>{source}</span></>}
                  </span>
                </span>
                {opening === item.id && <span className="history-busy">{t("openingGeneration")}</span>}
              </button>
            </li>;
          })}
        </ul>}
      </div>}
    </div>
  );
}
