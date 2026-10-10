import { LoaderCircle, MonitorPlay, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useLabels } from "../preferences/useLabels";
import { PREVIEW_PLACEHOLDER_DOCUMENT, PREVIEW_SANDBOX } from "./previewDocument";
import { PREVIEW_ENTRY_PATH } from "./previewTypes";
import type { PreviewModel } from "./previewModel";

export function PreviewPanel({ model }: { model: PreviewModel }) {
  const { t } = useLabels();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
  const busy = state.status === "RENDERING";
  const canRender = state.project !== null && state.error !== "NO_ENTRY" && !busy;
  return (
    <section className="preview-panel raised-panel" aria-label={t("previewRegion")} data-status={state.status}>
      <header className="code-toolbar">
        <div>
          <p className="eyebrow">{t("previewEyebrow")}</p>
          <h2>{t("previewTitle")}</h2>
        </div>
        <div className="code-actions">
          <span className="preview-status" role="status" aria-live="polite">
            <span className="preview-status-dot" aria-hidden="true" />
            {t(`previewStatus${state.status}`)}
          </span>
          <button type="button" className="action-button" disabled={!canRender} onClick={() => { void model.render(); }}>
            <RefreshCw aria-hidden="true" />{state.status === "ERROR" ? t("previewRetry") : t("previewRender")}
          </button>
        </div>
      </header>
      <div className="preview-stage" aria-busy={busy}>
        {state.status === "SUCCESS" && (
          <iframe className="preview-frame" title={t("previewFrameTitle")} sandbox={PREVIEW_SANDBOX}
            referrerPolicy="no-referrer" srcDoc={PREVIEW_PLACEHOLDER_DOCUMENT} tabIndex={-1} />
        )}
        {state.status === "EMPTY" && (
          <div className="preview-card"><MonitorPlay aria-hidden="true" /><p>{t("previewEmpty")}</p></div>
        )}
        {state.status === "READY" && (
          <div className="preview-card"><MonitorPlay aria-hidden="true" /><p>{t("previewReadyText")}</p></div>
        )}
        {busy && (
          <div className="preview-card" role="status"><LoaderCircle className="preview-spinner" aria-hidden="true" /><p>{t("previewRendering")}</p></div>
        )}
        {state.status === "SUCCESS" && state.project && (
          <div className="preview-card">
            <h3>{t("previewPlaceholderTitle")}</h3>
            <p>{t("previewPlaceholderBody")}</p>
            <dl className="preview-meta">
              <div><dt>{t("previewEngine")}</dt><dd>{t("previewEnginePlaceholder")}</dd></div>
              <div><dt>{t("previewEntry")}</dt><dd>{PREVIEW_ENTRY_PATH}</dd></div>
              <div><dt>{t("previewFiles")}</dt><dd>{state.project.files.length}</dd></div>
            </dl>
          </div>
        )}
        {state.status === "ERROR" && (
          <div className="preview-card" role="alert">
            <TriangleAlert aria-hidden="true" />
            <p>{state.error === "NO_ENTRY" ? t("previewErrorNoEntry") : t("previewErrorEngine")}</p>
          </div>
        )}
      </div>
      <p className="input-help preview-isolation"><ShieldCheck aria-hidden="true" />{t("previewIsolation")}</p>
    </section>
  );
}

