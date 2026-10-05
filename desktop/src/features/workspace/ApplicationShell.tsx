import { useState } from "react";
import { Workspace } from "./Workspace";
import { EditorWorkspace } from "../editor/EditorWorkspace";
import { createEditorModel } from "../editor/editorModel";
import type { GeneratedProject } from "../generation/generatedProject";

export function ApplicationShell() {
  const [view, setView] = useState<"capture" | "editor">("capture");
  const [editorModel] = useState(createEditorModel);
  function openProject(project: GeneratedProject) {
    editorModel.setProject(project);
    setView("editor");
  }
  return (
    <div className="application-shell">
      <a className="skip-link" href={view === "capture" ? "#workspace" : "#code-workspace"}>Saltar al espacio de trabajo</a>
      <nav className="navigation" aria-label="Navegación principal">
        <button type="button" className="brand-mark" aria-label="Espacio de trabajo de Vision2Code" onClick={() => setView("capture")}>V</button>
        <div className="navigation-links">
          <button className="navigation-item" onClick={() => setView("capture")} aria-current={view === "capture" ? "page" : undefined}><span aria-hidden="true">CA</span><small>Captura</small></button>
          <button className="navigation-item" onClick={() => setView("editor")} aria-current={view === "editor" ? "page" : undefined}><span aria-hidden="true">CO</span><small>Código</small></button>
          <button className="navigation-item" disabled aria-label="Proyectos, próximamente"><span aria-hidden="true">PR</span><small>Proyectos</small></button>
          <button className="navigation-item" disabled aria-label="Biblioteca, próximamente"><span aria-hidden="true">BI</span><small>Biblioteca</small></button>
        </div>
        <span className="navigation-note">V/2<br />0.1.0</span>
      </nav>
      <div className="shell-content">
        <div hidden={view !== "capture"}><Workspace onGenerated={openProject} /></div>
        {view === "editor" && <main id="code-workspace" className="workspace" tabIndex={-1}><EditorWorkspace model={editorModel} /></main>}
        <footer className="app-footer"><span>Vision2Code / Estudio de interfaces</span><span>Versión 0.1.0</span></footer>
      </div>
    </div>
  );
}
