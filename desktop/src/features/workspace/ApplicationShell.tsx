import { ScanLine, Code2, Folder, Library, Settings, LogIn, LogOut } from "lucide-react";
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
import type { CompletedGenerationArtifact } from "../generation/generationArtifact";
import type { AuthUser } from "../auth/authTypes.ts";
import type { WorkspaceServices } from "./workspaceServices";

export function ApplicationShell({
  onLogin,
  user,
  services,
}: {
  onLogin: () => void;
  user?: AuthUser | null;
  /** User-scoped models owned by the app boundary; without them the shell keeps local, unsaved state only. */
  services?: WorkspaceServices | undefined;
}) {
  const { t } = useLabels();
  const [view, setView] = useState<"capture" | "editor" | "settings">("capture");
  const [editorModel] = useState(() => services?.editorModel ?? createEditorModel());
  const [previewModel] = useState(() => services?.previewModel ?? createPreviewModel());

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

  function completeGeneration(artifact: CompletedGenerationArtifact) {
    // The session loads the code immediately and persists in the background.
    if (services) void services.generationSession.complete(artifact);
    else openProject(artifact.generatedProject);
    setView("editor");
  }

  const [projects] = useState(() => services && {
    projectsModel: services.projectsModel,
    generationSession: services.generationSession,
    onOpenGeneration: (projectId: string, generationId: string) => {
      void services.generationSession.openGeneration(projectId, generationId).then((opened) => {
        if (opened) setView("editor");
      });
    },
  });
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
        <button
          type="button"
          className="navigation-item"
          aria-label={user ? t("signOut") : t("loginScreen")}
          title={user ? `${t("signOut")} (${user.email})` : t("loginScreen")}
          onClick={onLogin}
        >
          {user ? <LogOut aria-hidden="true" /> : <LogIn aria-hidden="true" />}
          <small>{user ? t("signOut") : t("login")}</small>
        </button>
        <span className="navigation-note" title={user?.email || "Vision2Code"}>
          {user?.email ? (
            <>
              <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", display: "inline-block", verticalAlign: "bottom" }}>
                {user.email}
              </span>
              <br />
            </>
          ) : (
            <>V/2<br /></>
          )}
          0.1.0
        </span>
      </nav>
      <div className="shell-content">
        <div hidden={view !== "capture"}><Workspace onGenerated={completeGeneration} projects={projects} /></div>
        {view === "editor" && <main id="code-workspace" className="workspace" tabIndex={-1}><EditorWorkspace model={editorModel} preview={<PreviewPanel model={previewModel} editorModel={editorModel} />} /></main>}
        {view === "settings" && <SettingsScreen />}
        <footer className="app-footer"><span>{t("footer")}</span><span>{t("version")}</span></footer>
      </div>
    </div>
  );
}
