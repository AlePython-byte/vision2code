import type { ProjectSummary } from "@vision2code/contracts";
import type { ProjectsState } from "./projectsModel.ts";

// TEMPORARY (TASK 009C): logic behind the minimal Capture Console project selector; 009D replaces it.

export const PROJECT_NAME_MAX_LENGTH = 100;

export type ProjectNameError = "projectNameRequired" | "projectNameTooLong";

export function validateProjectName(raw: string): { ok: true; name: string } | { ok: false; error: ProjectNameError } {
  const name = raw.trim();
  if (!name) return { ok: false, error: "projectNameRequired" };
  if (name.length > PROJECT_NAME_MAX_LENGTH) return { ok: false, error: "projectNameTooLong" };
  return { ok: true, name };
}

export type CreateAndSelectResult =
  | { status: "CREATED"; project: ProjectSummary }
  | { status: "INVALID"; error: ProjectNameError }
  | { status: "FAILED" };

/**
 * Selects a project only after the backend confirmed it and the model holds it.
 * On failure nothing is selected: the previous list and selection stay intact.
 */
export async function createAndSelectProject(
  model: {
    createProject(name: string): Promise<ProjectSummary | null>;
    selectProject(id: string | null): Promise<void>;
  },
  raw: string,
): Promise<CreateAndSelectResult> {
  const validation = validateProjectName(raw);
  if (!validation.ok) return { status: "INVALID", error: validation.error };
  const project = await model.createProject(validation.name);
  if (!project) return { status: "FAILED" };
  await model.selectProject(project.id);
  return { status: "CREATED", project };
}

/** Latest stored generation of the selected project, if any is known locally. */
export function latestGenerationOf(state: ProjectsState): string | null {
  const id = state.selectedProjectId;
  if (!id) return null;
  const summary = state.projects.find((project) => project.id === id);
  const detail = state.selectedProject?.id === id ? state.selectedProject : null;
  return summary?.latestGenerationId ?? detail?.generations[0]?.id ?? null;
}

export function projectName(state: ProjectsState, id: string | null): string | null {
  if (!id) return null;
  return state.projects.find((project) => project.id === id)?.name
    ?? (state.selectedProject?.id === id ? state.selectedProject.name : null);
}
