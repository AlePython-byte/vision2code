import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ProjectRepository,
  type CreateGenerationData,
  type ProjectWithGenerations,
  type ProjectSummaryRecord,
} from "./project.repository.js";
import type { Project, Generation } from "@prisma/client";

@Injectable()
export class InMemoryProjectRepository extends ProjectRepository {
  private readonly projects = new Map<string, Project>();
  private readonly generations = new Map<string, Generation>();

  async createProject(userId: string, name: string): Promise<Project> {
    const now = new Date();
    const project: Project = {
      id: randomUUID(),
      userId,
      name,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    return { ...project };
  }

  async findProjectById(id: string): Promise<ProjectWithGenerations | null> {
    const project = this.projects.get(id);
    if (!project) return null;

    const projectGenerations = Array.from(this.generations.values())
      .filter((g) => g.projectId === id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      ...project,
      generations: projectGenerations.map((g) => ({ ...g })),
    };
  }

  async listProjectsByUserId(userId: string): Promise<ProjectSummaryRecord[]> {
    return Array.from(this.projects.values())
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((p) => {
        const pGens = Array.from(this.generations.values())
          .filter((g) => g.projectId === p.id)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

        return {
          ...p,
          generationCount: pGens.length,
          latestGenerationId: pGens[0]?.id ?? null,
        };
      });
  }

  async updateProjectName(id: string, name: string): Promise<Project> {
    const existing = this.projects.get(id);
    if (!existing) {
      throw new Error(`Project ${id} not found`);
    }
    const updated: Project = {
      ...existing,
      name,
      updatedAt: new Date(),
    };
    this.projects.set(id, updated);
    return { ...updated };
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
    // Cascade delete generations
    for (const [genId, gen] of this.generations.entries()) {
      if (gen.projectId === id) {
        this.generations.delete(genId);
      }
    }
  }

  async createGeneration(projectId: string, data: CreateGenerationData): Promise<Generation> {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const now = new Date();
    const generation: Generation = {
      id: randomUUID(),
      projectId,
      sourceImagePath: data.sourceImagePath,
      sourceImageName: data.sourceImageName,
      sourceImageMimeType: data.sourceImageMimeType,
      uiSchema: structuredClone(data.uiSchema) as any,
      generatedProject: structuredClone(data.generatedProject) as any,
      generationTarget: data.generationTarget,
      fidelityMode: data.fidelityMode,
      createdAt: now,
    };
    this.generations.set(generation.id, generation);

    // Bump project.updatedAt
    this.projects.set(projectId, {
      ...project,
      updatedAt: now,
    });

    return { ...generation };
  }

  async listGenerationsByProjectId(projectId: string): Promise<Generation[]> {
    return Array.from(this.generations.values())
      .filter((g) => g.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((g) => ({ ...g }));
  }

  async findGenerationById(id: string): Promise<Generation | null> {
    const gen = this.generations.get(id);
    return gen ? { ...gen } : null;
  }

  async deleteGeneration(id: string): Promise<void> {
    this.generations.delete(id);
  }

  clear(): void {
    this.projects.clear();
    this.generations.clear();
  }
}

