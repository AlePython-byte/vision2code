import { ScanLine, Code2, Folder, Library, Settings, LogIn } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { useState, useEffect } from "react";
import { Workspace } from "./Workspace";
import { EditorWorkspace } from "../editor/EditorWorkspace";
import { SettingsScreen } from "../settings/SettingsScreen";
import { createEditorModel } from "../editor/editorModel";
import { createPreviewModel } from "../preview/previewModel";
import { PreviewPanel } from "../preview/PreviewPanel";
import { syncEditorToPreview } from "../preview/previewSync";
import type { GeneratedProject } from "../generation/generatedProject";

export function ApplicationShell({ onLogin }: { onLogin: () => void }) {
  const { t } = useLabels();
  const [view, setView] = useState<"capture" | "editor" | "settings">("capture");
  const [editorModel] = useState(createEditorModel);
  const [previewModel] = useState(() => createPreviewModel());

  useEffect(() => {
    const sync = syncEditorToPreview(editorModel, previewModel);
    return () => {
      sync.dispose();
    };
  }, [editorModel, previewModel]);

  function openProject(project: GeneratedProject) {
    editorModel.setProject(project);
    previewModel.setProject(project);
    void previewModel.render();
    setView("editor");
  }
  return (
    <div className="application-shell">
      <a className="skip-link" href={view === "capture" ? "#workspace" : view === "editor" ? "#code-workspace" : "#settings-workspace"}>{t("skip")}</a>
      <nav className="navigation" aria-label={t("navigation")}>
        <button type="button" className="brand-mark" aria-label={t("brandLabel")} onClick={() => setView("capture")}>V</button>
        <div className="navigation-links">
          <button className="navigation-item" onClick={() => setView("capture")} aria-current={view === "capture" ? "page" : undefined} aria-label={t("capture")} title={t("capture")}><ScanLine aria-hidden="true" /><small>{t("capture")}</small></button>
          <button className="navigation-item" onClick={() => setView("editor")} aria-current={view === "editor" ? "page" : undefined} aria-label={t("code")} title={t("code")}><Code2 aria-hidden="true" /><small>{t("code")}</small></button>
          <button className="navigation-item" disabled aria-label={t("projectsSoon")} title={t("projectsSoon")}><Folder aria-hidden="true" /><small>{t("projects")}</small></button>
          <button className="navigation-item" disabled aria-label={t("librarySoon")} title={t("librarySoon")}><Library aria-hidden="true" /><small>{t("library")}</small></button>
          <button className="navigation-item" onClick={() => setView("settings")} aria-current={view === "settings" ? "page" : undefined} aria-label={t("settings")} title={t("settings")}><Settings aria-hidden="true" /><small>{t("settings")}</small></button>
        </div>
        <button type="button" className="navigation-item" aria-label={t("loginScreen")} title={t("loginScreen")} onClick={onLogin}><LogIn aria-hidden="true" /><small>{t("login")}</small></button>
        <span className="navigation-note">V/2<br />0.1.0</span>
      </nav>
      <div className="shell-content">
        <div hidden={view !== "capture"}><Workspace onGenerated={openProject} /></div>
        {view === "editor" && <main id="code-workspace" className="workspace" tabIndex={-1}><EditorWorkspace model={editorModel} preview={<PreviewPanel model={previewModel} editorModel={editorModel} />} /></main>}
        {view === "settings" && <SettingsScreen />}
        <footer className="app-footer"><span>{t("footer")}</span><span>{t("version")}</span></footer>
      </div>
    </div>
  );
}
