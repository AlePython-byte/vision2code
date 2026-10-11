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
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { useLabels } from "../preferences/useLabels";
import { PREVIEW_PLACEHOLDER_DOCUMENT, PREVIEW_SANDBOX } from "./previewDocument";
import { projectFromEditorState } from "./previewInput";
import {
  calculatePresentationScale,
  createPreviewPresentation,
  PREVIEW_VIEWPORT_PRESETS,
  PREVIEW_ZOOM_MODES,
  type PreviewPresentation,
  type PreviewViewportPreset,
  type PreviewZoomMode,
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

interface SegmentOption<T extends string> {
  readonly value: T;
  readonly text: string;
  readonly icon?: ReactNode;
  /** When true the text is visually collapsible on narrow widths and must be exposed through aria-label. */
  readonly collapsible?: boolean;
}

const DEVICE_ICONS: Record<PreviewViewportPreset, ReactNode> = {
  desktop: <Monitor aria-hidden="true" />,
  tablet: <Tablet aria-hidden="true" />,
  mobile: <Smartphone aria-hidden="true" />,
};
const DEVICE_PRESETS = Object.keys(PREVIEW_VIEWPORT_PRESETS) as PreviewViewportPreset[];

/**
 * Compact instrument-style radiogroup with roving tabindex and arrow-key navigation.
 * Purely presentational: it only reports the selected value.
 */
function SegmentedRadioGroup<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !backward && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const count = options.length;
    const current = Math.max(0, options.findIndex((option) => option.value === value));
    const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (current + (forward ? 1 : count - 1)) % count;
    const target = options[next];
    if (!target) return;
    onChange(target.value);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
  return (
    <div ref={ref} className="preview-segmented" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            className="preview-segment"
            aria-checked={checked}
            aria-label={option.collapsible ? option.text : undefined}
            title={option.collapsible ? option.text : undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            {option.collapsible ? <span className="preview-segment-text">{option.text}</span> : option.text}
          </button>
        );
      })}
    </div>
  );
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

  // Retain the last successful document so a transient compile error never blanks the canvas.
  useEffect(() => {
    if (state.status === "SUCCESS" && state.documentHtml) setLastGoodHtml(state.documentHtml);
    else if (state.status === "EMPTY") setLastGoodHtml(null);
  }, [state.status, state.documentHtml]);

  // Measure the scrollable stage so FIT can be recalculated on window resize without recompiling.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateDims = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setStageDimensions({ width: el.clientWidth, height: el.clientHeight });
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
      if (draft) model.setProject(draft);
    }
    void model.render();
  };

  const presetConfig = PREVIEW_VIEWPORT_PRESETS[presState.preset] ?? PREVIEW_VIEWPORT_PRESETS.desktop;
  const showFrame = (state.status === "SUCCESS" && state.documentHtml) || (lastGoodHtml !== null && (busy || state.status === "ERROR"));
  const activeDocument = state.status === "SUCCESS" && state.documentHtml ? state.documentHtml : (lastGoodHtml ?? PREVIEW_PLACEHOLDER_DOCUMENT);
  const refreshLabel = state.status === "ERROR" ? t("previewRetry") : state.status === "READY" ? t("previewRender") : t("previewRefresh");
  const errorReason = state.error === "NO_ENTRY" ? t("previewErrorNoEntry") : t("previewErrorEngine");
  const errorCode = state.error === "NO_ENTRY" ? "ERR_MISSING_ENTRY" : "ERR_COMPILATION_FAILED";

  const deviceOptions: SegmentOption<PreviewViewportPreset>[] = DEVICE_PRESETS.map((preset) => ({
    value: preset,
    text: t(PREVIEW_VIEWPORT_PRESETS[preset].labelKey),
    icon: DEVICE_ICONS[preset],
    collapsible: true,
  }));
  const zoomOptions: SegmentOption<PreviewZoomMode>[] = PREVIEW_ZOOM_MODES.map((mode) => ({
    value: mode,
    text: mode === "fit" ? t("previewZoomFit") : `${mode}%`,
  }));

  return (
    <section className="preview-panel raised-panel" aria-label={t("previewRegion")} data-status={state.status}>
      <header className="preview-header">
        <div className="preview-heading">
          <p className="eyebrow">{t("previewEyebrow")}</p>
          <h2>{t("previewTitle")}</h2>
        </div>
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
      </header>

      <div className="preview-toolbar" role="group" aria-label={t("previewControls")}>
        <SegmentedRadioGroup label={t("previewDeviceGroup")} value={presState.preset} options={deviceOptions} onChange={presentation.setPreset} />
        <SegmentedRadioGroup label={t("previewZoomGroup")} value={presState.zoomMode} options={zoomOptions} onChange={presentation.setZoomMode} />
        <button type="button" className="action-button preview-refresh" disabled={!canRender} onClick={handleRefresh} aria-label={refreshLabel} title={refreshLabel}>
          <RotateCw aria-hidden="true" className={busy ? "preview-spinner" : undefined} />
          <span className="preview-refresh-text">{refreshLabel}</span>
        </button>
      </div>

      <div className="preview-stage-shell">
        <div className="preview-stage" ref={stageRef} aria-busy={busy}>
          {showFrame && (
            <div
              className="preview-device-wrapper"
              data-preset={presState.preset}
              data-zoom={presState.zoomMode}
              style={{ width: `${scaleResult.scaledWidth}px`, height: `${scaleResult.scaledHeight}px` }}
            >
              <div
                className="preview-device-canvas"
                style={{
                  width: `${scaleResult.contentWidth}px`,
                  height: `${scaleResult.contentHeight}px`,
                  transform: `scale(${scaleResult.scale})`,
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
            <div className="preview-card preview-card-quiet"><MonitorPlay aria-hidden="true" /><p>{t("previewEmpty")}</p></div>
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

          {/* No previous good preview: a centered card is the only content. */}
          {state.status === "ERROR" && !lastGoodHtml && (
            <div className="preview-card preview-error-card" role="alert">
              <TriangleAlert aria-hidden="true" />
              <div className="preview-error-body">
                <h3>{t("previewErrorTitle")}</h3>
                <p>{errorReason}</p>
                <small className="preview-error-code">{errorCode}</small>
              </div>
              {canRender && (
                <button type="button" className="action-button" onClick={handleRefresh}>
                  <RotateCw aria-hidden="true" />{t("previewRetry")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Last good preview stays visible and untouched; a compact toast reports the failure. */}
        {state.status === "ERROR" && lastGoodHtml && (
          <div className="preview-error-toast" role="alert">
            <TriangleAlert aria-hidden="true" />
            <div className="preview-error-text">
              <p className="preview-error-title">{t("previewUpdateErrorTitle")}</p>
              <p className="preview-error-reason">{errorReason} <small className="preview-error-code">{errorCode}</small></p>
            </div>
            {canRender && (
              <button type="button" className="action-button" onClick={handleRefresh}>
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
            <div><dt>{t("previewViewport")}</dt><dd>{t(presetConfig.labelKey)} {presetConfig.width}×{presetConfig.height}</dd></div>
            <div><dt>{t("previewMode")}</dt><dd>{presState.zoomMode === "fit" ? t("previewModeFit") : `${presState.zoomMode}%`}</dd></div>
            <div><dt>{t("previewFiles")}</dt><dd>{state.project.files.length}</dd></div>
          </dl>
        )}
      </footer>
    </section>
  );
}
