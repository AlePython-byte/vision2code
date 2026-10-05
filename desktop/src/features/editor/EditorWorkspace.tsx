import { Component, lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import { activeFile, editorEmptyMessage, type EditorModel } from "./editorModel";
import { FileExplorer } from "./FileExplorer";

const CodeEditor = lazy(() => import("./CodeEditor"));
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="alert">No se pudo cargar el editor. Vuelve a abrir el espacio de código.</p> : this.props.children;
  }
}

export function EditorWorkspace({ model }: { model: EditorModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const file = activeFile(state);
  const empty = editorEmptyMessage(state);
  return <>
    <header className="workspace-heading">
      <div><p className="eyebrow">Estudio / Código</p><h1>Espacio de código</h1>
        <p className="workspace-intro">Explora y ajusta tu interfaz. Los cambios duran solo esta sesión.</p></div>
      {state.project && <span className="workspace-badge">React + Tailwind CSS · {state.files.length} archivos · Generador {state.project.generatorVersion}</span>}
    </header>
    <div className="editor-grid">
      <FileExplorer files={state.files} activePath={state.activePath} onSelect={model.select} />
      <section className="code-panel raised-panel" aria-label="Editor de código">
        <header className="code-toolbar">
          <div><p className="eyebrow">Archivo activo</p><p className="active-file-path">{file?.path ?? "Ningún archivo seleccionado"}</p></div>
          <div className="code-actions">
            <button className="action-button" disabled={!file} onClick={() => {
              void model.copy((content) => navigator.clipboard.writeText(content));
            }}>Copiar código</button>
            <button className="action-button" disabled={!state.drafts.size} onClick={model.reset}>Restaurar proyecto</button>
          </div>
        </header>
        <p className="editor-feedback" role="status" aria-live="polite">{state.feedback || (state.drafts.size ? "Cambios sin guardar en disco." : state.project ? "Código original generado." : "")}</p>
        {empty ? <div className="editor-empty">{empty}</div> : file && <EditorBoundary>
          <Suspense fallback={<p role="status">Cargando editor…</p>}>
            <CodeEditor key={file.path} path={file.path} content={file.content} language={file.language} onChange={model.edit} />
          </Suspense>
        </EditorBoundary>}
      </section>
    </div>
  </>;
}
