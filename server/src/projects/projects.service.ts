import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import {
  PROJECT_REPOSITORY,
  ProjectRepository,
  type ProjectWithGenerations,
} from "./project.repository.js";
import type { AuthenticatedUser } from "../auth/authenticated-user.js";
import {
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  CreateGenerationInputSchema,
  UISchemaSchema,
  GeneratedProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
  type CreateGenerationInput,
  type ProjectSummary,
  type ProjectDetail,
  type GenerationSummary,
  type GenerationDetail,
  type FidelityMode,
  type GenerationTarget,
} from "@vision2code/contracts";

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly repository: ProjectRepository
  ) {}

  private async assertProjectOwnership(
    user: AuthenticatedUser,
    projectId: string
  ): Promise<ProjectWithGenerations> {
    const project = await this.repository.findProjectById(projectId);
    // Return 404 for both nonexistent projects and projects belonging to other users
    // to prevent cross-user resource enumeration.
    if (!project || project.userId !== user.id) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  async createProject(user: AuthenticatedUser, rawInput: CreateProjectInput): Promise<ProjectSummary> {
    const input = CreateProjectInputSchema.parse(rawInput);
    const project = await this.repository.createProject(user.id, input.name);

    return {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      generationCount: 0,
      latestGenerationId: null,
    };
  }

  async listProjects(user: AuthenticatedUser): Promise<ProjectSummary[]> {
    const records = await this.repository.listProjectsByUserId(user.id);
    return records.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      generationCount: r.generationCount ?? 0,
      latestGenerationId: r.latestGenerationId ?? null,
    }));
  }

  async getProject(user: AuthenticatedUser, projectId: string): Promise<ProjectDetail> {
    const project = await this.assertProjectOwnership(user, projectId);

    return {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      generations: project.generations.map((g) => ({
        id: g.id,
        projectId: g.projectId,
        sourceImagePath: g.sourceImagePath,
        sourceImageName: g.sourceImageName,
        sourceImageMimeType: g.sourceImageMimeType,
        generationTarget: g.generationTarget as GenerationTarget,
        fidelityMode: g.fidelityMode as FidelityMode,
        createdAt: g.createdAt.toISOString(),
      })),
    };
  }

  async renameProject(
    user: AuthenticatedUser,
    projectId: string,
    rawInput: UpdateProjectInput
  ): Promise<ProjectSummary> {
    await this.assertProjectOwnership(user, projectId);
    const input = UpdateProjectInputSchema.parse(rawInput);
    const updated = await this.repository.updateProjectName(projectId, input.name);

    return {
      id: updated.id,
      name: updated.name,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteProject(user: AuthenticatedUser, projectId: string): Promise<void> {
    await this.assertProjectOwnership(user, projectId);
    await this.repository.deleteProject(projectId);
  }

  async createGeneration(
    user: AuthenticatedUser,
    projectId: string,
    rawInput: CreateGenerationInput
  ): Promise<GenerationDetail> {
    await this.assertProjectOwnership(user, projectId);
    const input = CreateGenerationInputSchema.parse(rawInput);

    // Validate payload against canonical schemas
    const validatedUiSchema = UISchemaSchema.parse(input.uiSchema);
    const validatedGeneratedProject = GeneratedProjectSchema.parse(input.generatedProject);

    const generation = await this.repository.createGeneration(projectId, {
      sourceImagePath: input.sourceImagePath ?? null,
      sourceImageName: input.sourceImageName ?? null,
      sourceImageMimeType: input.sourceImageMimeType ?? null,
      uiSchema: validatedUiSchema,
      generatedProject: validatedGeneratedProject,
      generationTarget: input.generationTarget,
      fidelityMode: input.fidelityMode,
    });

    return {
      id: generation.id,
      projectId: generation.projectId,
      sourceImagePath: generation.sourceImagePath,
      sourceImageName: generation.sourceImageName,
      sourceImageMimeType: generation.sourceImageMimeType,
      generationTarget: generation.generationTarget as GenerationTarget,
      fidelityMode: generation.fidelityMode as FidelityMode,
      createdAt: generation.createdAt.toISOString(),
      uiSchema: UISchemaSchema.parse(generation.uiSchema),
      generatedProject: GeneratedProjectSchema.parse(generation.generatedProject),
    };
  }

  async listGenerations(user: AuthenticatedUser, projectId: string): Promise<GenerationSummary[]> {
    await this.assertProjectOwnership(user, projectId);
    const generations = await this.repository.listGenerationsByProjectId(projectId);

    return generations.map((g) => ({
      id: g.id,
      projectId: g.projectId,
      sourceImagePath: g.sourceImagePath,
      sourceImageName: g.sourceImageName,
      sourceImageMimeType: g.sourceImageMimeType,
      generationTarget: g.generationTarget as GenerationTarget,
      fidelityMode: g.fidelityMode as FidelityMode,
      createdAt: g.createdAt.toISOString(),
    }));
  }

  async getGeneration(
    user: AuthenticatedUser,
    projectId: string,
    generationId: string
  ): Promise<GenerationDetail> {
    await this.assertProjectOwnership(user, projectId);
    const generation = await this.repository.findGenerationById(generationId);

    if (!generation || generation.projectId !== projectId) {
      throw new NotFoundException("Generation not found");
    }

    return {
      id: generation.id,
      projectId: generation.projectId,
      sourceImagePath: generation.sourceImagePath,
      sourceImageName: generation.sourceImageName,
      sourceImageMimeType: generation.sourceImageMimeType,
      generationTarget: generation.generationTarget as GenerationTarget,
      fidelityMode: generation.fidelityMode as FidelityMode,
      createdAt: generation.createdAt.toISOString(),
      uiSchema: UISchemaSchema.parse(generation.uiSchema),
      generatedProject: GeneratedProjectSchema.parse(generation.generatedProject),
    };
  }

  async deleteGeneration(
    user: AuthenticatedUser,
    projectId: string,
    generationId: string
  ): Promise<void> {
    await this.assertProjectOwnership(user, projectId);
    const generation = await this.repository.findGenerationById(generationId);

    if (!generation || generation.projectId !== projectId) {
      throw new NotFoundException("Generation not found");
    }

    await this.repository.deleteGeneration(generationId);
  }
}
