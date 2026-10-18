import { ScanLine, Code2, Folder, Library, Settings, LogIn, LogOut, TriangleAlert } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { useState, useEffect, useSyncExternalStore, type ReactNode } from "react";
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
import { GeneratedAvatar } from "../account/GeneratedAvatar";
import type { WorkspaceServices } from "./workspaceServices";
const never = () => () => {};
const closed = () => false;

export function ApplicationShell({
  onLogin,
  user,
  services,
  codeContext,
  codeActions,
  libraryNav,
  libraryDialog,
  sessionPersistence,
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
  /** True once the session is known to live in memory only (keyring or vault unavailable); built at the app boundary. */
  sessionPersistence?: { subscribe: (listener: () => void) => () => void; getSnapshot: () => boolean } | undefined;
}) {
  const { t } = useLabels();
  const [view, setView] = useState<"projects" | "capture" | "editor" | "settings">(services ? "projects" : "capture");
  // The library dialog is modal: while it is open only "Library" is current, never the page behind it.
  const readLibraryOpen = services?.library ? () => services.library.getSnapshot().open : closed;
  const libraryOpen = useSyncExternalStore(services?.library?.subscribe ?? never, readLibraryOpen, readLibraryOpen);
  const sessionNotSaved = useSyncExternalStore(sessionPersistence?.subscribe ?? never, sessionPersistence?.getSnapshot ?? closed, sessionPersistence?.getSnapshot ?? closed);
  const current = (name: typeof view) => (view === name && !libraryOpen ? "page" : undefined);
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
          <button className="navigation-item" onClick={() => setView("capture")} aria-current={current("capture")} aria-label={t("capture")} title={t("capture")}><ScanLine aria-hidden="true" /><small>{t("capture")}</small></button>
          <button className="navigation-item" onClick={() => setView("editor")} aria-current={current("editor")} aria-label={t("code")} title={t("code")}><Code2 aria-hidden="true" /><small>{t("code")}</small></button>
          <button className="navigation-item" onClick={() => setView("projects")} aria-current={current("projects")} aria-label={t("projects")} title={t("projects")}><Folder aria-hidden="true" /><small>{t("projects")}</small></button>
          {libraryNav ?? <button className="navigation-item" disabled aria-label={t("librarySoon")} title={t("librarySoon")}><Library aria-hidden="true" /><small>{t("library")}</small></button>}
          <button className="navigation-item" onClick={() => setView("settings")} aria-current={current("settings")} aria-label={t("settings")} title={t("settings")}><Settings aria-hidden="true" /><small>{t("navSettings")}</small></button>
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
        {user?.email ? (
          <span className="navigation-note account" title={user.email}>
            <span className="account-avatar-wrap">
              {/* Seeded with the user id, never the address. */}
              <GeneratedAvatar seed={user.id} size="md" />
              {sessionNotSaved && (
                <span className="account-session-badge" role="status" title={t("sessionNotSaved")}>
                  <TriangleAlert aria-hidden="true" />
                  <span className="sr-only">{t("sessionNotSaved")}</span>
                </span>
              )}
            </span>
            {/* One short label; the address lives in the tooltip and in Settings. Compact rails keep only the avatar. */}
            <span className="account-name">{user.displayName ?? t("accountLabel")}</span>
            <span className="account-version">0.1.0</span>
          </span>
        ) : (
          <span className="navigation-note" title="Vision2Code">V/2<br />0.1.0</span>
        )}
      </nav>
      <div className="shell-content">
        {view === "projects" && services && <ProjectVault projects={services.projectsModel} session={services.generationSession} thumbnails={services.thumbnails}
          toasts={services.toasts} onCapture={() => setView("capture")} onEditor={() => setView("editor")}
          hasLocalEdits={() => editorModel.getSnapshot().drafts.size > 0}
          confirmDiscard={(trigger) => services.discardGuard.request(trigger)}
          onManageProject={(kind, projectId, trigger) => {
            if (kind === "RENAME") services.projectManager.requestRename(projectId, trigger);
            else services.projectManager.requestDelete(projectId, trigger);
          }} />}
        <div className="capture-view" hidden={view !== "capture"}><Workspace onGenerated={completeGeneration} projects={projects} analyzeScreenshot={services?.analyzeScreenshot} /></div>
        {view === "editor" && <main id="code-workspace" className="workspace" tabIndex={-1}><EditorWorkspace model={editorModel} aside={codeContext} actions={codeActions} preview={<PreviewPanel model={previewModel} editorModel={editorModel} />} /></main>}
        {view === "settings" && <SettingsScreen sessionNotSaved={sessionNotSaved} user={user ?? null} />}
        <footer className="app-footer"><span>{t("footer")}</span><span>{t("version")}</span></footer>
      </div>
      {libraryDialog?.({ openCode: () => setView("editor") })}
    </div>
  );
}
