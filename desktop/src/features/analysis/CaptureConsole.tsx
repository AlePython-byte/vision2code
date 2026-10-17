import { ScanLine, Code2, Loader2 } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import type { CompletedGenerationArtifact } from "../generation/generationArtifact";
import type { AnalyzeScreenshot } from "./analysisClient";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ScreenshotInput } from "../screenshot/ScreenshotInput";
import { useScreenshot } from "../screenshot/useScreenshot";
import { canAnalyze } from "./analysisModel";
import { useAnalysis } from "./useAnalysis";
import { createGenerationProfileModel, type GenerationProfileModel } from "./generationProfileModel";
import { VisualFidelitySelector } from "./VisualFidelitySelector";

/** Project targeting supplied by the workspace; the console itself never depends on the projects feature. */
export interface CaptureProjectTarget {
  /** Read once when analysis starts; the captured value travels with the result. */
  getSelectedProjectId: () => string | null;
  /** A new analysis or screenshot replaces the previous generation session. */
  onAnalysisReplaced: () => void;
  /** undefined: no analysis started yet; null: the running/finished analysis has no project. */
  render: (analysisTargetProjectId: string | null | undefined) => ReactNode;
}

export function CaptureConsole({
  onGenerated,
  profileModel: externalProfileModel,
  projectTarget,
  analyzeScreenshot,
}: {
  onGenerated: (artifact: CompletedGenerationArtifact) => void;
  profileModel?: GenerationProfileModel;
  projectTarget?: CaptureProjectTarget | undefined;
  /** Authenticated analysis client from the workspace services. */
  analyzeScreenshot?: AnalyzeScreenshot | undefined;
}) {
  const { t, message } = useLabels();
  const screenshot = useScreenshot();
  const { state, model } = useAnalysis(screenshot.screenshot, screenshot.status === "VALIDATING", projectTarget?.onAnalysisReplaced, analyzeScreenshot);
  const [profileModel] = useState(() => externalProfileModel ?? createGenerationProfileModel());
  const profile = useSyncExternalStore(profileModel.subscribe, profileModel.getSnapshot, profileModel.getSnapshot);
  const analyzing = state.status === "ANALYZING";
  const succeeded = state.status === "SUCCESS" && state.result !== null;
  const screenshotChanging = screenshot.status === "VALIDATING" || state.screenshot !== screenshot.screenshot;
  const analyze = () => { void model.analyze({ targetProjectId: projectTarget?.getSelectedProjectId() ?? null, fidelity: profile.fidelity }); };
  const steps = [t("inputStage"), t("profileStage"), t("analysisStage"), t("resultStage"), t("exportStage")];
  const currentStep = state.status === "SUCCESS" ? 3 : analyzing ? 2 : screenshot.screenshot ? 1 : 0;
  const input = {
    ...screenshot,
    selectFiles: (files: readonly File[]) => {
      if (files.length) model.cancel();
      return screenshot.selectFiles(files);
    },
    removeScreenshot: () => { model.setScreenshot(null); screenshot.removeScreenshot(); },
  };
  return (
    <>
      <ol className="workflow-strip" aria-label={t("workflow")}>
        {steps.map((step, index) => (
          <li key={step} aria-current={index === currentStep ? "step" : undefined}
            data-current={index === currentStep} data-completed={index < currentStep}>
            <span className="workflow-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="capture-grid">
        <ScreenshotInput controller={input} />
        <section className="profile-panel raised-panel" aria-labelledby="profile-title">
          {/* Scrolls on its own when the window is short; the footer below never scrolls away. */}
          <div className="profile-body">
            <header className="panel-heading">
              <p className="eyebrow">{t("profileEyebrow")}</p>
              <h2 id="profile-title">{t("profileTitle")}</h2>
            </header>
            <p className="profile-stack"><span className="eyebrow">{t("outputStack")}</span><span>React · Tailwind CSS · TypeScript</span></p>
            <VisualFidelitySelector
              value={profile.fidelity}
              onChange={profileModel.setFidelity}
              onCycle={profileModel.cycleFidelity}
              disabled={analyzing}
            />
            <p className="input-help">{t("profileHelp")}</p>
            {projectTarget?.render(state.context ? state.context.targetProjectId : undefined)}
          </div>
          <div className="profile-footer">
            <div className="analysis-actions">
              {succeeded ? <>
                <button type="button" className="action-button primary-action"
                  disabled={profile.outputStack !== "REACT_TAILWIND" || screenshotChanging}
                  onClick={() => { const artifact = model.generateArtifact(); if (artifact) onGenerated(artifact); }}>
                  {t("generate")}<Code2 aria-hidden="true" /></button>
                <button type="button" className="action-button ghost-button"
                  disabled={!canAnalyze(state) || screenshotChanging} onClick={analyze}>
                  <ScanLine aria-hidden="true" />{t("reanalyze")}</button>
              </> : <>
                <button className="action-button primary-action" type="button"
                  disabled={!canAnalyze(state) || screenshotChanging} onClick={analyze}>
                  {analyzing ? t("analyzingButton") : state.status === "ERROR" ? t("retry") : t("analyze")}
                  {analyzing ? <Loader2 className="action-spinner" aria-hidden="true" /> : <ScanLine aria-hidden="true" />}
                </button>
                {analyzing && <button className="action-button secondary-button" type="button" onClick={model.cancel}>{t("cancelAnalysis")}</button>}
              </>}
            </div>
            <div className="analysis-feedback" data-state={state.status} aria-busy={analyzing}>
              <p role="status" aria-live="polite" aria-atomic="true">
                {state.status === "IDLE" && t("analysisIdle")}
                {state.status === "READY" && t("analysisReady")}
                {analyzing && state.context?.fidelity && t(
                  state.context.fidelity === "fast" ? "analysisBusyFast" :
                  state.context.fidelity === "balanced" ? "analysisBusyBalanced" :
                  "analysisBusyPrecise"
                )}
                {state.status === "SUCCESS" && t("analysisSuccess")}
              </p>
              {state.status === "ERROR" && <p role="alert" className="input-error">{typeof state.errorRetryAfterSeconds === "number"
                // Our own analysis limit: say how long to wait. Retrying stays a manual action.
                ? t("analysisQuotaWait", { wait: state.errorRetryAfterSeconds < 60
                  ? t("waitSeconds", { value: state.errorRetryAfterSeconds })
                  : t("waitMinutes", { value: Math.ceil(state.errorRetryAfterSeconds / 60) }) })
                : message(state.error ?? "")}</p>}
              {succeeded && <p className="input-help">{t("replaceProject")}</p>}
              {(state.result?.requestId || state.errorRequestId) && <p className="request-reference">{t("reference")} {state.result?.requestId ?? state.errorRequestId}</p>}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
