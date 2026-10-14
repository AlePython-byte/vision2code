import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  ProjectRepository,
  type CreateGenerationData,
  type ProjectWithGenerations,
  type ProjectSummaryRecord,
} from "./project.repository.js";
import type { Project, Generation, Prisma } from "@prisma/client";

@Injectable()
export class PrismaProjectRepository extends ProjectRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async createProject(userId: string, name: string): Promise<Project> {
    return this.prisma.project.create({
      data: {
        userId,
        name,
      },
    });
  }

  async findProjectById(id: string): Promise<ProjectWithGenerations | null> {
    return this.prisma.project.findUnique({
      where: { id },
      include: {
        generations: {
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  async listProjectsByUserId(userId: string): Promise<ProjectSummaryRecord[]> {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { generations: true },
        },
        generations: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { id: true },
        },
      },
    });

    return projects.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      generationCount: p._count.generations,
      latestGenerationId: p.generations[0]?.id ?? null,
    }));
  }

  async updateProjectName(id: string, name: string): Promise<Project> {
    return this.prisma.project.update({
      where: { id },
      data: { name },
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.prisma.project.delete({
      where: { id },
    });
  }

  async createGeneration(projectId: string, data: CreateGenerationData): Promise<Generation> {
    // Atomically create generation and bump project.updatedAt
    const [generation] = await this.prisma.$transaction([
      this.prisma.generation.create({
        data: {
          projectId,
          sourceImagePath: data.sourceImagePath,
          sourceImageName: data.sourceImageName,
          sourceImageMimeType: data.sourceImageMimeType,
          uiSchema: data.uiSchema as Prisma.InputJsonValue,
          generatedProject: data.generatedProject as Prisma.InputJsonValue,
          generationTarget: data.generationTarget,
          fidelityMode: data.fidelityMode,
        },
      }),
      this.prisma.project.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return generation;
  }

  async listGenerationsByProjectId(projectId: string): Promise<Generation[]> {
    return this.prisma.generation.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
  }

  async findGenerationById(id: string): Promise<Generation | null> {
    return this.prisma.generation.findUnique({
      where: { id },
    });
  }

  async deleteGeneration(id: string): Promise<void> {
    await this.prisma.generation.delete({
      where: { id },
    });
  }
}

