import type { AuthState } from "../auth/authTypes.ts";
import { createEditorModel, type EditorModel } from "../editor/editorModel.ts";
import type { GeneratedProject } from "../generation/generatedProject.ts";
import { createGenerationSessionModel, type GenerationSessionModel } from "../generation/generationSessionModel.ts";
import { createPreviewModel, type PreviewModel } from "../preview/previewModel.ts";
import { createProjectsClient } from "../projects/projectsClient.ts";
import { createProjectsModel, type ProjectsModel } from "../projects/projectsModel.ts";

export interface WorkspaceServices {
  readonly editorModel: EditorModel;
  readonly previewModel: PreviewModel;
  readonly projectsModel: ProjectsModel;
  readonly generationSession: GenerationSessionModel;
  /** Loads a project into the editor and the preview without touching persistence. */
  readonly loadProject: (project: GeneratedProject) => void;
  /** Clears every user-scoped state: projects, selection, generation session, editor and preview. */
  readonly reset: () => void;
}

export interface WorkspaceServicesOptions {
  /** Token source owned by the auth feature; no model stores the token. */
  readonly getAccessToken: () => Promise<string | null>;
  /** Injected so projects and generation never import the auth feature. */
  readonly onUnauthorized: () => void;
  readonly baseUrl?: string;
  readonly transport?: typeof fetch;
  readonly editorModel?: EditorModel;
  readonly previewModel?: PreviewModel;
}

export function createWorkspaceServices(options: WorkspaceServicesOptions): WorkspaceServices {
  const editorModel = options.editorModel ?? createEditorModel();
  const previewModel = options.previewModel ?? createPreviewModel();
  const client = createProjectsClient(options.getAccessToken, options.baseUrl, options.transport);
  const projectsModel = createProjectsModel(client, options.onUnauthorized);
  function loadProject(project: GeneratedProject) {
    editorModel.setProject(project);
    previewModel.setProject(project);
    void previewModel.render();
  }
  const generationSession = createGenerationSessionModel({
    client, projects: projectsModel, loadProject, onUnauthorized: options.onUnauthorized,
  });
  return {
    editorModel, previewModel, projectsModel, generationSession, loadProject,
    reset() {
      generationSession.reset();
      projectsModel.reset();
      editorModel.setProject(null);
      previewModel.clear();
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
