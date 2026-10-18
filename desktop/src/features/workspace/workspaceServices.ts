import { createAnalysisClient, type AnalyzeScreenshot } from "../analysis/analysisClient.ts";
import type { AuthState } from "../auth/authTypes.ts";
import { createExportModel, type ExportModel, type NativeExport } from "../export/exportModel.ts";
import { createTauriExport } from "../export/tauriExport.ts";
import { createEditorModel, type EditorModel } from "../editor/editorModel.ts";
import { bindGenerationToasts } from "../feedback/generationToasts.ts";
import { createToastModel, type ToastModel, type ToastScheduler } from "../feedback/toastModel.ts";
import type { GeneratedProject } from "../generation/generatedProject.ts";
import { createGenerationSessionModel, type GenerationSessionModel } from "../generation/generationSessionModel.ts";
import { createPreviewModel, type PreviewModel } from "../preview/previewModel.ts";
import { createDiscardGuard, type DiscardGuard } from "../projects/discardGuard.ts";
import { createGenerationHistoryModel, type GenerationHistoryModel } from "../projects/generationHistoryModel.ts";
import { createLibraryModel, type LibraryModel } from "../projects/libraryModel.ts";
import { createThumbnailModel, type ThumbnailModel } from "../projects/thumbnailModel.ts";
import { createProjectManager, type ProjectManager } from "../projects/projectManageActions.ts";
import { createProjectsClient } from "../projects/projectsClient.ts";
import { createProjectsModel, type ProjectsModel } from "../projects/projectsModel.ts";
import { resolveHistoryProjectId } from "../projects/historySelectors.ts";
import { projectName } from "../projects/projectTargetActions.ts";

export interface WorkspaceServices {
  readonly editorModel: EditorModel;
  readonly previewModel: PreviewModel;
  readonly projectsModel: ProjectsModel;
  readonly generationSession: GenerationSessionModel;
  /** Saved generations of the project the Code view is about (summaries only). */
  readonly history: GenerationHistoryModel;
  /** Cross-project library dialog: lazily loaded generation summaries per project. */
  readonly library: LibraryModel;
  /** Thumbnails and fidelity chips of the Projects and Library cards (one generation detail each, cached, reset with the session). */
  readonly thumbnails: ThumbnailModel;
  /** Rename/delete confirmations; a removed project detaches the result and clears history and library caches. */
  readonly projectManager: ProjectManager;
  /** Exports the editor's working copy through the single native command (no paths from the webview). */
  readonly exporter: ExportModel;
  /** Confirmation before unsaved editor drafts are replaced by another generation. */
  readonly discardGuard: DiscardGuard;
  /** Floating feedback; generation save/restore outcomes are bound to it here, not in the domain models. */
  readonly toasts: ToastModel;
  /** Loads a project into the editor and the preview without touching persistence. */
  readonly loadProject: (project: GeneratedProject) => void;
  /** Screenshot analysis with the session's bearer token; a 401 calls onUnauthorized. */
  readonly analyzeScreenshot: AnalyzeScreenshot;
  /** Clears every user-scoped state: projects, selection, generation session, editor, preview and toasts. */
  readonly reset: () => void;
}

export interface WorkspaceServicesOptions {
  /** Token source owned by the auth feature; no model stores the token. */
  readonly getAccessToken: () => Promise<string | null>;
  /** Injected so projects, generation and analysis never import the auth feature. */
  readonly onUnauthorized: () => void;
  readonly baseUrl?: string;
  readonly transport?: typeof fetch;
  readonly editorModel?: EditorModel;
  readonly previewModel?: PreviewModel;
  /** Native export bridge; defaults to the Tauri command. Injected by tests. */
  readonly nativeExport?: NativeExport;
  /** Injected for deterministic tests; defaults to system timers. */
  readonly toastScheduler?: ToastScheduler;
}

export function createWorkspaceServices(options: WorkspaceServicesOptions): WorkspaceServices {
  const editorModel = options.editorModel ?? createEditorModel();
  const previewModel = options.previewModel ?? createPreviewModel();
  const client = createProjectsClient(options.getAccessToken, options.baseUrl, options.transport);
  const projectsModel = createProjectsModel(client, options.onUnauthorized);
  const analyzeScreenshot = createAnalysisClient(options.baseUrl, options.transport, {
    getAccessToken: options.getAccessToken, onUnauthorized: options.onUnauthorized,
  });
  function loadProject(project: GeneratedProject) {
    editorModel.setProject(project);
    previewModel.setProject(project);
    void previewModel.render();
  }
  const generationSession = createGenerationSessionModel({
    client, projects: projectsModel, loadProject, onUnauthorized: options.onUnauthorized,
  });
  const history = createGenerationHistoryModel({
    client, session: generationSession, projects: projectsModel, onUnauthorized: options.onUnauthorized,
  });
  const library = createLibraryModel({ client, onUnauthorized: options.onUnauthorized });
  const thumbnails = createThumbnailModel({ client, onUnauthorized: options.onUnauthorized });
  const discardGuard = createDiscardGuard();
  const toasts = createToastModel(options.toastScheduler);
  const generationToasts = bindGenerationToasts(generationSession, toasts, options.toastScheduler);
  const exporter = createExportModel({
    editor: editorModel,
    projectName: () => {
      const projects = projectsModel.getSnapshot();
      return projectName(projects, resolveHistoryProjectId(generationSession.getSnapshot(), projects));
    },
    nativeExport: options.nativeExport ?? createTauriExport(),
    toasts,
  });
  const projectManager = createProjectManager({
    projects: projectsModel,
    toasts,
    // The projects model already dropped the project and its selection (so the history follows);
    // the result keeps its code as local only and the library forgets the project's cache.
    onProjectRemoved(projectId) {
      generationSession.detachProject(projectId);
      library.forgetProject(projectId);
    },
  });
  return {
    editorModel, previewModel, projectsModel, generationSession, history, library, thumbnails, projectManager, exporter, discardGuard, toasts, loadProject, analyzeScreenshot,
    reset() {
      discardGuard.cancel();
      projectManager.reset();
      exporter.reset();
      generationSession.reset();
      projectsModel.reset();
      history.reset();
      library.reset();
      thumbnails.reset();
      editorModel.setProject(null);
      previewModel.clear();
      generationToasts.reset();
    },
  };
}

/**
 * Loads projects when a user becomes authenticated and resets every user-scoped state on any
 * transition away from AUTHENTICATED (sign-out or expiration) or to a different user.
 */
export function bindWorkspaceToAuth(
  auth: { getSnapshot(): AuthState; subscribe(listener: () => void): () => void },
  services: Pick<WorkspaceServices, "projectsModel" | "reset">,
): () => void {
  let previous = auth.getSnapshot();
  if (previous.status === "AUTHENTICATED") void services.projectsModel.loadProjects();
  return auth.subscribe(() => {
    const next = auth.getSnapshot();
    const wasAuthenticated = previous.status === "AUTHENTICATED";
    const isAuthenticated = next.status === "AUTHENTICATED";
    const userChanged = previous.user?.id !== next.user?.id;
    previous = next;
    if (wasAuthenticated && (!isAuthenticated || userChanged)) services.reset();
    if (isAuthenticated && (!wasAuthenticated || userChanged)) void services.projectsModel.loadProjects();
  });
}
