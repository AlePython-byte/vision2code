import type { GenerationSummary, ProjectDetail, ProjectSummary } from "@vision2code/contracts";
import { ProjectsClientError } from "./projectsClient.ts";
import type { ProjectsClient, ProjectsErrorCode } from "./projectsClient.ts";

export type ProjectsStatus = "IDLE" | "LOADING" | "READY" | "SAVING" | "ERROR";
export interface ProjectsState {
  readonly status: ProjectsStatus;
  readonly projects: readonly ProjectSummary[];
  readonly selectedProjectId: string | null;
  readonly selectedProject: ProjectDetail | null;
  readonly error: ProjectsErrorCode | null;
  readonly revision: number;
}

/** Outcome of a confirmed-by-server mutation; null when the session ended while it ran. */
export type ProjectMutation = { readonly ok: true } | { readonly ok: false; readonly code: ProjectsErrorCode };

function safeCode(error: unknown): ProjectsErrorCode {
  return error instanceof ProjectsClientError ? error.code : "UNKNOWN";
}

function byUpdatedAt(projects: readonly ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function latest(current: string, candidate: string): string {
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function toSummary(generation: GenerationSummary): GenerationSummary {
  return {
    id: generation.id, projectId: generation.projectId, sourceImagePath: generation.sourceImagePath,
    sourceImageName: generation.sourceImageName, sourceImageMimeType: generation.sourceImageMimeType,
    generationTarget: generation.generationTarget, fidelityMode: generation.fidelityMode, createdAt: generation.createdAt,
  };
}

export function createProjectsModel(client: ProjectsClient, onUnauthorized?: () => void) {
  let state: ProjectsState = Object.freeze({
    status: "IDLE", projects: Object.freeze([]), selectedProjectId: null,
    selectedProject: null, error: null, revision: 0,
  });
  let loaded = false;
  let listRequest: Promise<void> | null = null;
  let listEpoch = 0;
  let selectionEpoch = 0;
  let sessionEpoch = 0;
  const listeners = new Set<() => void>();

  function update(changes: Partial<Omit<ProjectsState, "revision">>) {
    state = Object.freeze({ ...state, ...changes, revision: state.revision + 1 });
    listeners.forEach((listener) => listener());
  }

  function fail(error: unknown) {
    const code = safeCode(error);
    update({ status: "ERROR", error: code });
    if (code === "UNAUTHORIZED") onUnauthorized?.();
  }

  function stableStatus(): ProjectsStatus { return loaded ? "READY" : "IDLE"; }

  /** A confirmed change wins over any list response requested before it. */
  function supersedeList() {
    ++listEpoch;
    listRequest = null;
    return state.status === "LOADING" ? stableStatus() : state.status;
  }

  /** Drops a project the server no longer has (deleted, or reported missing). */
  function removeLocal(id: string) {
    const status = supersedeList();
    const selected = state.selectedProjectId === id;
    if (selected) ++selectionEpoch;
    update({
      projects: Object.freeze(state.projects.filter((item) => item.id !== id)),
      ...(selected ? { selectedProjectId: null, selectedProject: null } : {}),
      status,
    });
  }

  function mutationFailure(error: unknown, id: string): ProjectMutation {
    const code = safeCode(error);
    if (code === "UNAUTHORIZED") onUnauthorized?.();
    if (code === "NOT_FOUND") removeLocal(id);
    return { ok: false, code };
  }

  return {
    getSnapshot: () => state,
    /** Operation counters let callers distinguish a replaced selection from session teardown. */
    getSelectionEpoch: () => selectionEpoch,
    getSessionEpoch: () => sessionEpoch,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    loadProjects(): Promise<void> {
      if (listRequest) return listRequest;
      const epoch = ++listEpoch;
      update({ status: "LOADING", error: null });
      const run = (async () => {
        try {
          const projects = await client.listProjects();
          if (epoch !== listEpoch) return;
          loaded = true;
          update({ projects: Object.freeze([...projects]), status: "READY", error: null });
        } catch (error) {
          if (epoch === listEpoch) fail(error);
        }
      })();
      listRequest = run.finally(() => { if (listRequest === wrapped) listRequest = null; });
      const wrapped = listRequest;
      return wrapped;
    },
    /** Resolves with the confirmed project, or null on failure; it never changes the selection. */
    async createProject(name: string): Promise<ProjectSummary | null> {
      ++listEpoch;
      listRequest = null;
      const session = sessionEpoch;
      update({ status: "SAVING", error: null });
      try {
        const project = await client.createProject({ name });
        if (session !== sessionEpoch) return null;
        loaded = true;
        update({ projects: Object.freeze([project, ...state.projects.filter((item) => item.id !== project.id)]), status: "READY" });
        return project;
      } catch (error) {
        if (session === sessionEpoch) fail(error);
        return null;
      }
    },
    /** Applies a confirmed generation locally so the list and detail stay current without a refetch. */
    recordGeneration(projectId: string, generation: GenerationSummary): void {
      if (generation.projectId !== projectId) return;
      const summary = toSummary(generation);
      const known = state.projects.some((item) => item.id === projectId);
      const selected = state.selectedProject?.id === projectId ? state.selectedProject : null;
      if (!known && !selected) return;
      const projects = state.projects.map((item) => item.id !== projectId ? item : {
        ...item,
        updatedAt: latest(item.updatedAt, summary.createdAt),
        ...(item.generationCount === undefined ? {} : { generationCount: item.generationCount + 1 }),
        latestGenerationId: summary.id,
      });
      update({
        projects: Object.freeze(byUpdatedAt(projects)),
        selectedProject: selected ? {
          ...selected,
          updatedAt: latest(selected.updatedAt, summary.createdAt),
          generations: [summary, ...selected.generations.filter((item) => item.id !== summary.id)],
        } : state.selectedProject,
      });
    },
    async selectProject(id: string | null): Promise<void> {
      const epoch = ++selectionEpoch;
      if (id === null) {
        update({ selectedProjectId: null, selectedProject: null, error: null, status: stableStatus() });
        return;
      }
      update({ selectedProjectId: id, selectedProject: null, status: "LOADING", error: null });
      try {
        const project = await client.getProject(id);
        if (epoch !== selectionEpoch) return;
        update({ selectedProject: project, status: "READY" });
      } catch (error) {
        if (epoch === selectionEpoch) fail(error);
      }
    },
    /**
     * Pessimistic rename: nothing changes until the server confirms. The list keeps its generation
     * counts (the rename response carries none) and re-sorts, because a rename bumps updatedAt.
     * NOT_FOUND removes the project locally; failures never touch the list-level status or error.
     */
    async renameProject(id: string, name: string): Promise<ProjectMutation | null> {
      const session = sessionEpoch;
      try {
        const project = await client.renameProject(id, { name });
        if (session !== sessionEpoch) return null;
        const status = supersedeList();
        const projects = state.projects.map((item) => item.id === id ? { ...item, ...project } : item);
        update({
          projects: Object.freeze(byUpdatedAt(projects)),
          selectedProject: state.selectedProjectId === id && state.selectedProject
            ? { ...state.selectedProject, name: project.name, updatedAt: project.updatedAt }
            : state.selectedProject,
          status,
        });
        return { ok: true };
      } catch (error) {
        return session === sessionEpoch ? mutationFailure(error, id) : null;
      }
    },
    /**
     * Pessimistic delete: the project leaves the list (and the selection) only after the server confirms.
     * NOT_FOUND means it is already gone, so it counts as success. Failures keep everything intact.
     */
    async deleteProject(id: string): Promise<ProjectMutation | null> {
      const session = sessionEpoch;
      try {
        await client.deleteProject(id);
        if (session !== sessionEpoch) return null;
        removeLocal(id);
        return { ok: true };
      } catch (error) {
        if (session !== sessionEpoch) return null;
        const failure = mutationFailure(error, id);
        return !failure.ok && failure.code === "NOT_FOUND" ? { ok: true } : failure;
      }
    },
    clearError() {
      if (state.error !== null) update({ error: null, status: stableStatus() });
    },
    reset() {
      ++sessionEpoch;
      ++listEpoch;
      ++selectionEpoch;
      listRequest = null;
      loaded = false;
      update({ status: "IDLE", projects: Object.freeze([]), selectedProjectId: null, selectedProject: null, error: null });
    },
  };
}
export type ProjectsModel = ReturnType<typeof createProjectsModel>;
