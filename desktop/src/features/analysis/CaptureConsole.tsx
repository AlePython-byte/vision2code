import { ScanLine, Code2 } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import type { GeneratedProject } from "../generation/generatedProject";
import { useState } from "react";
import { OutputStackSchema } from "@vision2code/contracts";
import type { OutputStack } from "@vision2code/contracts";
import { ScreenshotInput } from "../screenshot/ScreenshotInput";
import { useScreenshot } from "../screenshot/useScreenshot";
import { canAnalyze } from "./analysisModel";
import { useAnalysis } from "./useAnalysis";

export function CaptureConsole({ onGenerated }: { onGenerated: (project: GeneratedProject) => void }) {
  const { t, message } = useLabels();
  const screenshot = useScreenshot();
  const { state, model } = useAnalysis(screenshot.screenshot, screenshot.status === "VALIDATING");
  const [outputStack, setOutputStack] = useState<OutputStack>("REACT_TAILWIND");
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
            data-current={index === currentStep} data-future={index === 4}>
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
            <select id="output-stack" value={outputStack} onChange={(event) => {
              const parsed = OutputStackSchema.safeParse(event.currentTarget.value);
              if (parsed.success) setOutputStack(parsed.data);
            }}>
              <option value="REACT_TAILWIND">React + Tailwind CSS</option>
              <option value="HTML_CSS">HTML + CSS</option>
            </select>
          </div>
          <dl className="profile-fields">
            <div><dt>Framework</dt><dd><span className="status-dot" />{outputStack === "REACT_TAILWIND" ? "React" : t("noFramework")}</dd></div>
            <div><dt>{t("styles")}</dt><dd><span className="status-dot cyan" />{outputStack === "REACT_TAILWIND" ? "Tailwind CSS" : "CSS"}</dd></div>
            <div><dt>{t("codeLanguage")}</dt><dd><span className="status-dot green" />{outputStack === "REACT_TAILWIND" ? "TypeScript" : "HTML"}</dd></div>
          </dl>
          <div className="fidelity-card">
            <div className="fidelity-dial" aria-hidden="true"><span /></div>
            <div><p className="eyebrow">{t("fidelity")}</p><h3>{t("structure")}</h3><p className="input-help">{t("structureHelp")}</p></div>
          </div>
          <div className="instructions-field">
            <label htmlFor="generation-instructions" className="eyebrow">{t("instructions")}</label>
            <textarea id="generation-instructions" disabled rows={2} placeholder={t("instructionsHelp")} />
          </div>
          <p className="input-help">{t("profileHelp")}</p>
          <div className="analysis-actions">
            <button className="action-button primary-action" type="button"
              disabled={!canAnalyze(state) || screenshot.status === "VALIDATING" || state.screenshot !== screenshot.screenshot}
              aria-describedby="analysis-help" onClick={() => { void model.analyze(); }}>
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
                disabled={outputStack !== "REACT_TAILWIND" || screenshot.status === "VALIDATING" || state.screenshot !== screenshot.screenshot}
                onClick={() => { const project = model.generateReactProject(); if (project) onGenerated(project); }}>
                <Code2 aria-hidden="true" />{t("generate")}</button>
              {outputStack === "HTML_CSS" && <p className="input-help">{t("htmlSoon")}</p>}
              <p className="input-help">{t("replaceProject")}</p>
            </>}
            {(state.result?.requestId || state.errorRequestId) && <p className="request-reference">{t("reference")}{state.result?.requestId ?? state.errorRequestId}</p>}
          </div>
        </section>
      </div>
    </>
  );
}
