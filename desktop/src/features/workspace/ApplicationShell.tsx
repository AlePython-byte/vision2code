import { ScanLine, Code2, Folder, Library, Settings, LogIn, LogOut } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { useState, useEffect, type ReactNode } from "react";
import { Workspace } from "./Workspace";
import { EditorWorkspace } from "../editor/EditorWorkspace";
import { SettingsScreen } from "../settings/SettingsScreen";
import { createEditorModel } from "../editor/editorModel";
import { createPreviewModel } from "../preview/previewModel";
import { PreviewPanel } from "../preview/PreviewPanel";
import { ProjectVault } from "../projects/ProjectVault";
import { syncEditorToPreview } from "../preview/previewSync";
import type { GeneratedProject } from "../generation/generatedProject";
import type { CompletedGenerationArtifact } from "../generation/generationArtifact";
import type { AuthUser } from "../auth/authTypes.ts";
import type { WorkspaceServices } from "./workspaceServices";

export function ApplicationShell({
  onLogin,
  user,
  services,
  codeContext,
  codeActions,
  libraryNav,
  libraryDialog,
}: {
  onLogin: () => void;
  user?: AuthUser | null;
  /** User-scoped models owned by the app boundary; without them the shell keeps local, unsaved state only. */
  services?: WorkspaceServices | undefined;
  /** Project identity, status chip and history key for the Code view header (built at the app boundary). */
  codeContext?: ReactNode;
  /** Extra Code view toolbar actions (Export), built at the app boundary. */
  codeActions?: ReactNode;
  /** Enabled "Library" rail entry (opens the library dialog); disabled placeholder when omitted. */
  libraryNav?: ReactNode;
  /** Renders the library dialog host; receives the shell navigation it needs after picking a generation. */
  libraryDialog?: (navigation: { openCode: () => void }) => ReactNode;
}) {
  const { t } = useLabels();
  const [view, setView] = useState<"projects" | "capture" | "editor" | "settings">(services ? "projects" : "capture");
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
    onChangeProject: () => setView("projects"),
  });
  return (
    <div className="application-shell">
      <a className="skip-link" href={view === "projects" ? "#project-vault" : view === "capture" ? "#workspace" : view === "editor" ? "#code-workspace" : "#settings-workspace"}>{t("skip")}</a>
      <nav className="navigation" aria-label={t("navigation")}>
        <button type="button" className="brand-mark" aria-label={t("brandLabel")} onClick={() => setView("capture")}>V</button>
        <div className="navigation-links">
          <button className="navigation-item" onClick={() => setView("capture")} aria-current={view === "capture" ? "page" : undefined} aria-label={t("capture")} title={t("capture")}><ScanLine aria-hidden="true" /><small>{t("capture")}</small></button>
          <button className="navigation-item" onClick={() => setView("editor")} aria-current={view === "editor" ? "page" : undefined} aria-label={t("code")} title={t("code")}><Code2 aria-hidden="true" /><small>{t("code")}</small></button>
          <button className="navigation-item" onClick={() => setView("projects")} aria-current={view === "projects" ? "page" : undefined} aria-label={t("projects")} title={t("projects")}><Folder aria-hidden="true" /><small>{t("projects")}</small></button>
          {libraryNav ?? <button className="navigation-item" disabled aria-label={t("librarySoon")} title={t("librarySoon")}><Library aria-hidden="true" /><small>{t("library")}</small></button>}
          <button className="navigation-item" onClick={() => setView("settings")} aria-current={view === "settings" ? "page" : undefined} aria-label={t("settings")} title={t("settings")}><Settings aria-hidden="true" /><small>{t("navSettings")}</small></button>
        </div>
        <button
          type="button"
          className="navigation-item"
          aria-label={user ? t("signOut") : t("loginScreen")}
          title={user ? `${t("signOut")} (${user.email})` : t("loginScreen")}
          onClick={onLogin}
        >
          {user ? <LogOut aria-hidden="true" /> : <LogIn aria-hidden="true" />}
          <small>{user ? t("navSignOut") : t("login")}</small>
        </button>
        <span className="navigation-note" title={user?.email || "Vision2Code"}>
          {user?.email ? (
            <>
              <span className="navigation-note-email" title={user.email}>
                {user.email}
              </span>
            </>
          ) : (
            <>V/2<br /></>
          )}
          0.1.0
        </span>
      </nav>
      <div className="shell-content">
        {view === "projects" && services && <ProjectVault projects={services.projectsModel} session={services.generationSession}
          toasts={services.toasts} onCapture={() => setView("capture")} onEditor={() => setView("editor")}
          hasLocalEdits={() => editorModel.getSnapshot().drafts.size > 0}
          confirmDiscard={(trigger) => services.discardGuard.request(trigger)}
          onManageProject={(kind, projectId, trigger) => {
            if (kind === "RENAME") services.projectManager.requestRename(projectId, trigger);
            else services.projectManager.requestDelete(projectId, trigger);
          }} />}
        <div className="capture-view" hidden={view !== "capture"}><Workspace onGenerated={completeGeneration} projects={projects} analyzeScreenshot={services?.analyzeScreenshot} /></div>
        {view === "editor" && <main id="code-workspace" className="workspace" tabIndex={-1}><EditorWorkspace model={editorModel} aside={codeContext} actions={codeActions} preview={<PreviewPanel model={previewModel} editorModel={editorModel} />} /></main>}
        {view === "settings" && <SettingsScreen />}
        <footer className="app-footer"><span>{t("footer")}</span><span>{t("version")}</span></footer>
      </div>
      {libraryDialog?.({ openCode: () => setView("editor") })}
    </div>
  );
}
