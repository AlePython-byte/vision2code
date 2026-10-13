import { ScanLine, Code2 } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import type { CompletedGenerationArtifact } from "../generation/generationArtifact";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { OutputStackSchema } from "@vision2code/contracts";
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
}: {
  onGenerated: (artifact: CompletedGenerationArtifact) => void;
  profileModel?: GenerationProfileModel;
  projectTarget?: CaptureProjectTarget | undefined;
}) {
  const { t, message } = useLabels();
  const screenshot = useScreenshot();
  const { state, model } = useAnalysis(screenshot.screenshot, screenshot.status === "VALIDATING", projectTarget?.onAnalysisReplaced);
  const [profileModel] = useState(() => externalProfileModel ?? createGenerationProfileModel());
  const profile = useSyncExternalStore(profileModel.subscribe, profileModel.getSnapshot, profileModel.getSnapshot);
  const analyzing = state.status === "ANALYZING";
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
            data-current={index === currentStep} data-completed={index < currentStep} data-future={index === 4}>
            <span className="workflow-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span>{step}{index === 4 && <small>{t("soon")}</small>}</span>
          </li>
        ))}
      </ol>
      <div className="capture-grid">
        <ScreenshotInput controller={input} />
        <section className="profile-panel raised-panel" aria-labelledby="profile-title">
          <header className="panel-heading">
            <p className="eyebrow">{t("profileEyebrow")}</p>
            <h2 id="profile-title">{t("profileTitle")}</h2>
          </header>
          <div className="output-stack-control">
            <label htmlFor="output-stack" className="eyebrow">{t("outputStack")}</label>
            <select id="output-stack" value={profile.outputStack} onChange={(event) => {
              const parsed = OutputStackSchema.safeParse(event.currentTarget.value);
              if (parsed.success) profileModel.setOutputStack(parsed.data);
            }}>
              <option value="REACT_TAILWIND">React + Tailwind CSS</option>
              <option value="HTML_CSS">HTML + CSS</option>
            </select>
          </div>
          <dl className="profile-fields">
            <div><dt>Framework</dt><dd><span className="status-dot" />{profile.outputStack === "REACT_TAILWIND" ? "React" : t("noFramework")}</dd></div>
            <div><dt>{t("styles")}</dt><dd><span className="status-dot cyan" />{profile.outputStack === "REACT_TAILWIND" ? "Tailwind CSS" : "CSS"}</dd></div>
            <div><dt>{t("codeLanguage")}</dt><dd><span className="status-dot green" />{profile.outputStack === "REACT_TAILWIND" ? "TypeScript" : "HTML"}</dd></div>
          </dl>
          <VisualFidelitySelector
            value={profile.fidelity}
            onChange={profileModel.setFidelity}
            onCycle={profileModel.cycleFidelity}
            disabled={analyzing}
          />
          <div className="instructions-field">
            <label htmlFor="generation-instructions" className="eyebrow">{t("instructions")}</label>
            <textarea id="generation-instructions" disabled rows={2} placeholder={t("instructionsHelp")} />
          </div>
          <p className="input-help">{t("profileHelp")}</p>
          {projectTarget?.render(state.context ? state.context.targetProjectId : undefined)}
          <div className="analysis-actions">
            <button className="action-button primary-action" type="button"
              disabled={!canAnalyze(state) || screenshot.status === "VALIDATING" || state.screenshot !== screenshot.screenshot}
              aria-describedby="analysis-help" onClick={() => { void model.analyze({ targetProjectId: projectTarget?.getSelectedProjectId() ?? null, fidelity: profile.fidelity }); }}>
              {analyzing ? t("analyzingButton") : state.status === "ERROR" ? t("retry") : state.status === "SUCCESS" ? t("reanalyze") : t("analyze")}
              <ScanLine aria-hidden="true" />
            </button>
            {analyzing && <button className="action-button secondary-button" type="button" onClick={model.cancel}>{t("cancelAnalysis")}</button>}
          </div>
          <p id="analysis-help" className="input-help">{t("analysisHelp")}</p>
          <div className="analysis-feedback" data-state={state.status} aria-busy={analyzing}>
            <p role="status" aria-live="polite" aria-atomic="true">
              {state.status === "IDLE" && t("analysisIdle")}
              {state.status === "READY" && t("analysisReady")}
              {analyzing && t("analysisBusy")}
              {state.status === "SUCCESS" && t("analysisSuccess")}
            </p>
            {state.status === "ERROR" && <p role="alert" className="input-error">{message(state.error ?? "")}</p>}
            {state.result && <>
              <button type="button" className="action-button primary-action"
                disabled={profile.outputStack !== "REACT_TAILWIND" || screenshot.status === "VALIDATING" || state.screenshot !== screenshot.screenshot}
                onClick={() => { const artifact = model.generateArtifact(); if (artifact) onGenerated(artifact); }}>
                <Code2 aria-hidden="true" />{t("generate")}</button>
              {profile.outputStack === "HTML_CSS" && <p className="input-help">{t("htmlSoon")}</p>}
              <p className="input-help">{t("replaceProject")}</p>
            </>}
            {(state.result?.requestId || state.errorRequestId) && <p className="request-reference">{t("reference")}{state.result?.requestId ?? state.errorRequestId}</p>}
          </div>
        </section>
      </div>
    </>
  );
}
