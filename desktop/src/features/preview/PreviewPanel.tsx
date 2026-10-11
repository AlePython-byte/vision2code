import {
  LoaderCircle,
  Monitor,
  MonitorPlay,
  RotateCw,
  ShieldCheck,
  Smartphone,
  Tablet,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLabels } from "../preferences/useLabels";
import { PREVIEW_PLACEHOLDER_DOCUMENT, PREVIEW_SANDBOX } from "./previewDocument";
import { projectFromEditorState } from "./previewInput";
import {
  calculatePresentationScale,
  createPreviewPresentation,
  PREVIEW_VIEWPORT_PRESETS,
  PREVIEW_ZOOM_MODES,
  type PreviewPresentation,
} from "./previewPresentation";
import { PREVIEW_ENTRY_PATH } from "./previewTypes";
import type { EditorModel } from "../editor/editorModel";
import type { PreviewModel } from "./previewModel";

export interface PreviewPanelProps {
  readonly model: PreviewModel;
  readonly editorModel?: EditorModel;
  readonly presentation?: PreviewPresentation;
  readonly onRefresh?: () => void | Promise<void>;
}

export function PreviewPanel({ model, editorModel, presentation: controlledPresentation, onRefresh }: PreviewPanelProps) {
  const { t } = useLabels();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);

  const [localPresentation] = useState(() => createPreviewPresentation());
  const presentation = controlledPresentation ?? localPresentation;
  const presState = useSyncExternalStore(presentation.subscribe, presentation.getSnapshot, presentation.getSnapshot);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageDimensions, setStageDimensions] = useState({ width: 800, height: 600 });
  const [lastGoodHtml, setLastGoodHtml] = useState<string | null>(null);

  // Retain last successful preview document for seamless live editing recovery
  useEffect(() => {
    if (state.status === "SUCCESS" && state.documentHtml) {
      setLastGoodHtml(state.documentHtml);
    } else if (state.status === "EMPTY") {
      setLastGoodHtml(null);
    }
  }, [state.status, state.documentHtml]);

  // Measure stage dimensions for responsive fit scaling
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateDims = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setStageDimensions({ width: el.clientWidth, height: el.clientHeight });
      }
    };
    updateDims();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(updateDims);
      ro.observe(el);
      return () => ro.disconnect();
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("resize", updateDims);
      return () => window.removeEventListener("resize", updateDims);
    }
  }, []);

  const busy = state.status === "RENDERING";
  const canRender = state.project !== null && state.error !== "NO_ENTRY" && !busy;

  const scaleResult = calculatePresentationScale({
    preset: presState.preset,
    zoomMode: presState.zoomMode,
    stageWidth: stageDimensions.width,
    stageHeight: stageDimensions.height,
  });

  const handleRefresh = () => {
    if (onRefresh) {
      void onRefresh();
      return;
    }
    if (editorModel) {
      const draft = projectFromEditorState(editorModel.getSnapshot());
      if (draft) {
        model.setProject(draft);
      }
    }
    void model.render();
  };

  const currentPresetConfig = PREVIEW_VIEWPORT_PRESETS[presState.preset] ?? PREVIEW_VIEWPORT_PRESETS.desktop;
  const showFrame = (state.status === "SUCCESS" && state.documentHtml) || (lastGoodHtml !== null && (busy || state.status === "ERROR"));
  const activeDocument = state.status === "SUCCESS" && state.documentHtml ? state.documentHtml : (lastGoodHtml ?? PREVIEW_PLACEHOLDER_DOCUMENT);

  return (
    <section className="preview-panel raised-panel" aria-label={t("previewRegion")} data-status={state.status}>
      <header className="code-toolbar preview-toolbar">
        <div>
          <p className="eyebrow">{t("previewEyebrow")}</p>
          <h2>{t("previewTitle")}</h2>
        </div>

        <div className="preview-controls-row">
          {/* Device Presets */}
          <div
            className="preview-control-group"
            role="radiogroup"
            aria-label={t("previewDeviceGroup")}
          >
            <button
              type="button"
              role="radio"
              className="preview-toggle-button"
              aria-checked={presState.preset === "desktop"}
              aria-label={t("previewDeviceDesktop")}
              title={t("previewDeviceDesktop")}
              onClick={() => presentation.setPreset("desktop")}
            >
              <Monitor aria-hidden="true" className="preview-control-icon" />
              <span className="preview-control-text">{t("previewDeviceDesktop")}</span>
            </button>
            <button
              type="button"
              role="radio"
              className="preview-toggle-button"
              aria-checked={presState.preset === "tablet"}
              aria-label={t("previewDeviceTablet")}
              title={t("previewDeviceTablet")}
              onClick={() => presentation.setPreset("tablet")}
            >
              <Tablet aria-hidden="true" className="preview-control-icon" />
              <span className="preview-control-text">{t("previewDeviceTablet")}</span>
            </button>
            <button
              type="button"
              role="radio"
              className="preview-toggle-button"
              aria-checked={presState.preset === "mobile"}
              aria-label={t("previewDeviceMobile")}
              title={t("previewDeviceMobile")}
              onClick={() => presentation.setPreset("mobile")}
            >
              <Smartphone aria-hidden="true" className="preview-control-icon" />
              <span className="preview-control-text">{t("previewDeviceMobile")}</span>
            </button>
          </div>

          {/* Zoom Controls */}
          <div
            className="preview-control-group"
            role="radiogroup"
            aria-label={t("previewZoomGroup")}
          >
            {PREVIEW_ZOOM_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                className="preview-toggle-button"
                aria-checked={presState.zoomMode === mode}
                aria-label={mode === "fit" ? t("previewZoomFit") : `${mode}%`}
                title={mode === "fit" ? t("previewZoomFit") : `${mode}%`}
                onClick={() => presentation.setZoomMode(mode)}
              >
                {mode === "fit" ? t("previewZoomFit") : `${mode}%`}
              </button>
            ))}
          </div>

          {/* Status and Refresh */}
          <div className="code-actions">
            <span className="preview-status" role="status" aria-live="polite">
              {busy ? (
                <>
                  <RotateCw className="preview-status-spinner preview-spinner" aria-hidden="true" />
                  <span>{t("previewUpdating")}</span>
                </>
              ) : (
                <>
                  <span className="preview-status-dot" aria-hidden="true" />
                  <span>{t(`previewStatus${state.status}`)}</span>
                </>
              )}
            </span>
            <button
              type="button"
              className="action-button preview-action-button"
              disabled={!canRender}
              onClick={handleRefresh}
              title={t("previewRefresh")}
              aria-label={t("previewRefresh")}
            >
              <RotateCw aria-hidden="true" className={busy ? "preview-spinner" : ""} />
              {state.status === "ERROR" ? t("previewRetry") : t("previewRender")}
            </button>
          </div>
        </div>
      </header>

      <div className="preview-stage" ref={stageRef} aria-busy={busy}>
        {showFrame && (
          <div
            className="preview-device-wrapper"
            data-preset={presState.preset}
            data-zoom={presState.zoomMode}
            style={{
              width: `${scaleResult.scaledWidth}px`,
              height: `${scaleResult.scaledHeight}px`,
            }}
          >
            <div
              className="preview-device-canvas"
              style={{
                width: `${scaleResult.contentWidth}px`,
                height: `${scaleResult.contentHeight}px`,
                transform: `scale(${scaleResult.scale})`,
                transformOrigin: "top left",
              }}
            >
              <iframe
                className="preview-frame"
                title={t("previewFrameTitle")}
                sandbox={PREVIEW_SANDBOX}
                referrerPolicy="no-referrer"
                srcDoc={activeDocument}
                tabIndex={0}
              />
            </div>
          </div>
        )}

        {state.status === "EMPTY" && (
          <div className="preview-card"><MonitorPlay aria-hidden="true" /><p>{t("previewEmpty")}</p></div>
        )}
        {state.status === "READY" && (
          <div className="preview-card"><MonitorPlay aria-hidden="true" /><p>{t("previewReadyText")}</p></div>
        )}
        {busy && !lastGoodHtml && (
          <div className="preview-card" role="status"><LoaderCircle className="preview-spinner" aria-hidden="true" /><p>{t("previewRendering")}</p></div>
        )}

        {state.status === "SUCCESS" && state.project && state.engine === "placeholder" && (
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

        {/* Improved ERROR UX: overlay when last-good-preview is retained */}
        {state.status === "ERROR" && lastGoodHtml && (
          <div className="preview-error-overlay" role="alert">
            <div className="preview-card preview-error-card">
              <TriangleAlert aria-hidden="true" />
              <div className="preview-error-body">
                <h3>{t("previewUpdateErrorTitle")}</h3>
                <p>{state.error === "NO_ENTRY" ? t("previewErrorNoEntry") : t("previewErrorEngine")}</p>
                <small className="preview-error-code">{state.error === "NO_ENTRY" ? "ERR_MISSING_ENTRY" : "ERR_COMPILATION_FAILED"}</small>
              </div>
              <button type="button" className="action-button preview-retry-button" onClick={handleRefresh}>
                <RotateCw aria-hidden="true" />{t("previewRetry")}
              </button>
            </div>
          </div>
        )}

        {/* Fallback ERROR UX: centered card when no prior good preview exists */}
        {state.status === "ERROR" && !lastGoodHtml && (
          <div className="preview-card preview-error-card" role="alert">
            <TriangleAlert aria-hidden="true" />
            <div className="preview-error-body">
              <h3>{t("previewErrorTitle")}</h3>
              <p>{state.error === "NO_ENTRY" ? t("previewErrorNoEntry") : t("previewErrorEngine")}</p>
              <small className="preview-error-code">{state.error === "NO_ENTRY" ? "ERR_MISSING_ENTRY" : "ERR_COMPILATION_FAILED"}</small>
            </div>
            {canRender && (
              <button type="button" className="action-button preview-retry-button" onClick={handleRefresh}>
                <RotateCw aria-hidden="true" />{t("previewRetry")}
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="preview-footer">
        <p className="input-help preview-isolation"><ShieldCheck aria-hidden="true" />{t("previewIsolation")}</p>
        {state.project && (
          <dl className="preview-meta">
            <div><dt>{t("previewEngine")}</dt><dd>{state.engine === "local-isolated" ? t("previewEngineLocal") : t("previewEnginePlaceholder")}</dd></div>
            <div><dt>{t("previewViewport")}</dt><dd>{t(currentPresetConfig.labelKey)} ({currentPresetConfig.width}×{currentPresetConfig.height})</dd></div>
            <div><dt>{t("previewMode")}</dt><dd>{presState.zoomMode === "fit" ? t("previewModeFit") : `${presState.zoomMode}%`}</dd></div>
            <div><dt>{t("previewEntry")}</dt><dd>{PREVIEW_ENTRY_PATH}</dd></div>
            <div><dt>{t("previewFiles")}</dt><dd>{state.project.files.length}</dd></div>
          </dl>
        )}
      </footer>
    </section>
  );
}
