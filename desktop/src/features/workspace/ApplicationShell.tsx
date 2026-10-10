import { ScanLine, Code2, Folder, Library, Settings, LogIn } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { useState } from "react";
import { Workspace } from "./Workspace";
import { EditorWorkspace } from "../editor/EditorWorkspace";
import { SettingsScreen } from "../settings/SettingsScreen";
import { createEditorModel } from "../editor/editorModel";
import type { GeneratedProject } from "../generation/generatedProject";

export function ApplicationShell({ onLogin }: { onLogin: () => void }) {
  const { t } = useLabels();
  const [view, setView] = useState<"capture" | "editor" | "settings">("capture");
  const [editorModel] = useState(createEditorModel);
  function openProject(project: GeneratedProject) {
    editorModel.setProject(project);
    setView("editor");
  }
  return (
    <div className="application-shell">
      <a className="skip-link" href={view === "capture" ? "#workspace" : view === "editor" ? "#code-workspace" : "#settings-workspace"}>{t("skip")}</a>
      <nav className="navigation" aria-label={t("navigation")}>
        <button type="button" className="brand-mark" aria-label={t("brandLabel")} onClick={() => setView("capture")}>V</button>
        <div className="navigation-links">
          <button className="navigation-item" onClick={() => setView("capture")} aria-current={view === "capture" ? "page" : undefined}><ScanLine aria-hidden="true" /><small>{t("capture")}</small></button>
          <button className="navigation-item" onClick={() => setView("editor")} aria-current={view === "editor" ? "page" : undefined}><Code2 aria-hidden="true" /><small>{t("code")}</small></button>
          <button className="navigation-item" disabled aria-label={t("projectsSoon")}><Folder aria-hidden="true" /><small>{t("projects")}</small></button>
          <button className="navigation-item" disabled aria-label={t("librarySoon")}><Library aria-hidden="true" /><small>{t("library")}</small></button>
          <button className="navigation-item" onClick={() => setView("settings")} aria-current={view === "settings" ? "page" : undefined}><Settings aria-hidden="true" /><small>{t("settings")}</small></button>
        </div>
        <button type="button" className="navigation-item" aria-label={t("loginScreen")} onClick={onLogin}><LogIn aria-hidden="true" /><small>{t("login")}</small></button>
        <span className="navigation-note">V/2<br />0.1.0</span>
      </nav>
      <div className="shell-content">
        <div hidden={view !== "capture"}><Workspace onGenerated={openProject} /></div>
        {view === "editor" && <main id="code-workspace" className="workspace" tabIndex={-1}><EditorWorkspace model={editorModel} /></main>}
        {view === "settings" && <SettingsScreen />}
        <footer className="app-footer"><span>{t("footer")}</span><span>{t("version")}</span></footer>
      </div>
    </div>
  );
}
