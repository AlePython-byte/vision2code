import type { Project, Generation } from "@prisma/client";
import type { FidelityMode, GenerationTarget } from "@vision2code/contracts";

export interface CreateGenerationData {
  sourceImagePath: string | null;
  sourceImageName: string | null;
  sourceImageMimeType: string | null;
  uiSchema: unknown;
  generatedProject: unknown;
  generationTarget: GenerationTarget;
  fidelityMode: FidelityMode;
}

export interface ProjectWithGenerations extends Project {
  generations: Generation[];
}

export interface ProjectSummaryRecord extends Project {
  generationCount?: number;
  latestGenerationId?: string | null;
}

export abstract class ProjectRepository {
  abstract createProject(userId: string, name: string): Promise<Project>;
  abstract findProjectById(id: string): Promise<ProjectWithGenerations | null>;
  abstract listProjectsByUserId(userId: string): Promise<ProjectSummaryRecord[]>;
  abstract updateProjectName(id: string, name: string): Promise<Project>;
  abstract deleteProject(id: string): Promise<void>;

  abstract createGeneration(projectId: string, data: CreateGenerationData): Promise<Generation>;
  abstract listGenerationsByProjectId(projectId: string): Promise<Generation[]>;
  abstract findGenerationById(id: string): Promise<Generation | null>;
  abstract deleteGeneration(id: string): Promise<void>;
}

export const PROJECT_REPOSITORY = Symbol("PROJECT_REPOSITORY");

