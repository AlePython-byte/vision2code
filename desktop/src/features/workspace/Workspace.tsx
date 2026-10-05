import { CaptureConsole } from "../analysis/CaptureConsole";

export function Workspace() {
  return (
    <main id="workspace" className="workspace" tabIndex={-1}>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Generador / Consola 01</p>
          <h1>Consola de captura</h1>
          <p className="workspace-intro">De una referencia visual a una estructura de interfaz.</p>
        </div>
        <span className="workspace-badge"><span className="status-dot cyan" />Análisis de interfaces</span>
      </div>
      <CaptureConsole />
    </main>
  );
}
