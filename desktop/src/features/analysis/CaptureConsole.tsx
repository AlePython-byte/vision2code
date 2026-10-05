import { useState } from "react";
import { OutputStackSchema } from "@vision2code/contracts";
import type { OutputStack } from "@vision2code/contracts";
import { ScreenshotInput } from "../screenshot/ScreenshotInput";
import { useScreenshot } from "../screenshot/useScreenshot";
import { canAnalyze } from "./analysisModel";
import { useAnalysis } from "./useAnalysis";

export function CaptureConsole() {
  const screenshot = useScreenshot();
  const { state, model } = useAnalysis(screenshot.screenshot, screenshot.status === "VALIDATING");
  const [outputStack, setOutputStack] = useState<OutputStack>("REACT_TAILWIND");
  const analyzing = state.status === "ANALYZING";
  const steps = ["Entrada", "Perfil", "Análisis", "Resultado", "Exportación"];
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
      <ol className="workflow-strip" aria-label="Etapas del flujo de trabajo">
        {steps.map((step, index) => (
          <li key={step} aria-current={index === currentStep ? "step" : undefined}
            data-current={index === currentStep} data-future={index === 4}>
            <span className="workflow-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span>{step}{index === 4 && <small>Próximamente</small>}</span>
          </li>
        ))}
      </ol>
      <div className="capture-grid">
        <ScreenshotInput controller={input} />
        <section className="profile-panel raised-panel" aria-labelledby="profile-title">
          <header className="panel-heading">
            <p className="eyebrow">Panel de configuración</p>
            <h2 id="profile-title">Perfil de generación</h2>
          </header>
          <div className="output-stack-control">
            <label htmlFor="output-stack" className="eyebrow">Tecnología de salida</label>
            <select id="output-stack" value={outputStack} onChange={(event) => {
              const parsed = OutputStackSchema.safeParse(event.currentTarget.value);
              if (parsed.success) setOutputStack(parsed.data);
            }}>
              <option value="REACT_TAILWIND">React + Tailwind CSS</option>
              <option value="HTML_CSS">HTML + CSS</option>
            </select>
          </div>
          <dl className="profile-fields">
            <div><dt>Framework</dt><dd><span className="status-dot" />{outputStack === "REACT_TAILWIND" ? "React" : "Sin framework"}</dd></div>
            <div><dt>Estilos</dt><dd><span className="status-dot cyan" />{outputStack === "REACT_TAILWIND" ? "Tailwind CSS" : "CSS"}</dd></div>
            <div><dt>Lenguaje</dt><dd><span className="status-dot green" />{outputStack === "REACT_TAILWIND" ? "TypeScript" : "HTML"}</dd></div>
          </dl>
          <div className="fidelity-card">
            <div className="fidelity-dial" aria-hidden="true"><span /></div>
            <div><p className="eyebrow">Fidelidad visual</p><h3>Estructura principal</h3><p className="input-help">Distribución, texto y controles.</p></div>
          </div>
          <div className="instructions-field">
            <label htmlFor="generation-instructions" className="eyebrow">Instrucciones · Próximamente</label>
            <textarea id="generation-instructions" disabled rows={2} placeholder="Las instrucciones de generación estarán disponibles en una próxima etapa." />
          </div>
          <p className="input-help">El perfil se reserva para la generación futura. El análisis actual utiliza solo tu captura.</p>
          <div className="analysis-actions">
            <button className="action-button primary-action" type="button"
              disabled={!canAnalyze(state) || screenshot.status === "VALIDATING" || state.screenshot !== screenshot.screenshot}
              aria-describedby="analysis-help" onClick={() => { void model.analyze(); }}>
              {analyzing ? "Analizando interfaz…" : state.status === "ERROR" ? "Reintentar análisis" : state.status === "SUCCESS" ? "Volver a analizar" : "Activar generador"}
              <span aria-hidden="true">↗</span>
            </button>
            {analyzing && <button className="action-button secondary-button" type="button" onClick={model.cancel}>Cancelar análisis</button>}
          </div>
          <p id="analysis-help" className="input-help">Por ahora, esta acción analiza la imagen. Todavía no genera código.</p>
          <div className="analysis-feedback" data-state={state.status} aria-busy={analyzing}>
            <p role="status" aria-live="polite" aria-atomic="true">
              {state.status === "IDLE" && "Selecciona una captura para empezar."}
              {state.status === "READY" && "Captura preparada para analizar."}
              {analyzing && "Analizando tu interfaz. Puede tardar hasta dos minutos."}
              {state.status === "SUCCESS" && "Interfaz analizada correctamente."}
            </p>
            {state.status === "ERROR" && <p role="alert" className="input-error">{state.error}</p>}
            {state.result && <p className="input-help">Estructura disponible para la siguiente etapa.</p>}
            {(state.result?.requestId || state.errorRequestId) && <p className="request-reference">Referencia: {state.result?.requestId ?? state.errorRequestId}</p>}
          </div>
        </section>
      </div>
    </>
  );
}
