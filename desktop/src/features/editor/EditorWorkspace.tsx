import { Copy, RotateCcw } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { Component, lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import { activeFile, editorEmptyMessage, type EditorModel } from "./editorModel";
import { FileExplorer } from "./FileExplorer";

const CodeEditor = lazy(() => import("./CodeEditor"));
class EditorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <EditorFailure /> : this.props.children;
  }
}

export function EditorWorkspace({ model }: { model: EditorModel }) {
  const { t, message } = useLabels();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const file = activeFile(state);
  const empty = editorEmptyMessage(state);
  return <>
    <header className="workspace-heading">
      <div><p className="eyebrow">{t("editorEyebrow")}</p><h1>{t("editorTitle")}</h1>
        <p className="workspace-intro">{t("editorIntro")}</p></div>
      {state.project && <span className="workspace-badge">{t("projectMetadata", { count: state.files.length, version: state.project.generatorVersion })}</span>}
    </header>
    <div className="editor-grid">
      <FileExplorer files={state.files} activePath={state.activePath} onSelect={model.select} />
      <section className="code-panel raised-panel" aria-label={t("editorLabel")}>
        <header className="code-toolbar">
          <div><p className="eyebrow">{t("activeFile")}</p><p className="active-file-path">{file?.path ?? t("noFile")}</p></div>
          <div className="code-actions">
            <button className="action-button" disabled={!file} onClick={() => {
              void model.copy((content) => navigator.clipboard.writeText(content));
            }}><Copy aria-hidden="true" />{t("copy")}</button>
            <button className="action-button" disabled={!state.drafts.size} onClick={model.reset}><RotateCcw aria-hidden="true" />{t("reset")}</button>
          </div>
        </header>
        <p className="editor-feedback" role="status" aria-live="polite">{message(state.feedback) || (state.drafts.size ? t("unsaved") : state.project ? t("originalCode") : "")}</p>
        {empty ? <div className="editor-empty">{message(empty)}</div> : file && <EditorBoundary>
          <Suspense fallback={<p role="status">{t("editorLoading")}</p>}>
            <CodeEditor key={file.path} path={file.path} content={file.content} language={file.language} onChange={model.edit} />
          </Suspense>
        </EditorBoundary>}
      </section>
    </div>
  </>;
}

function EditorFailure() { const { t } = useLabels(); return <p role="alert">{t("editorLoadError")}</p>; }
