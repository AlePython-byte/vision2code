import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { SupabaseAuthGuard } from "../auth/supabase-auth.guard.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import type { AuthenticatedUser } from "../auth/authenticated-user.js";
import { ProjectsService } from "./projects.service.js";
import { ZodValidationPipe } from "../http/zod-validation.pipe.js";
import {
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  CreateGenerationInputSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
  type CreateGenerationInput,
  type ProjectSummary,
  type ProjectDetail,
  type GenerationSummary,
  type GenerationDetail,
} from "@vision2code/contracts";

@Controller("projects")
@UseGuards(SupabaseAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  async createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateProjectInputSchema)) input: CreateProjectInput
  ): Promise<ProjectSummary> {
    return this.projectsService.createProject(user, input);
  }

  @Get()
  async listProjects(
    @CurrentUser() user: AuthenticatedUser
  ): Promise<ProjectSummary[]> {
    return this.projectsService.listProjects(user);
  }

  @Get(":projectId")
  async getProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string
  ): Promise<ProjectDetail> {
    return this.projectsService.getProject(user, projectId);
  }

  @Patch(":projectId")
  async renameProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(UpdateProjectInputSchema)) input: UpdateProjectInput
  ): Promise<ProjectSummary> {
    return this.projectsService.renameProject(user, projectId, input);
  }

  @Delete(":projectId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string
  ): Promise<void> {
    await this.projectsService.deleteProject(user, projectId);
  }

  @Post(":projectId/generations")
  async createGeneration(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body(new ZodValidationPipe(CreateGenerationInputSchema)) input: CreateGenerationInput
  ): Promise<GenerationDetail> {
    return this.projectsService.createGeneration(user, projectId, input);
  }

  @Get(":projectId/generations")
  async listGenerations(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string
  ): Promise<GenerationSummary[]> {
    return this.projectsService.listGenerations(user, projectId);
  }

  @Get(":projectId/generations/:generationId")
  async getGeneration(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("generationId") generationId: string
  ): Promise<GenerationDetail> {
    return this.projectsService.getGeneration(user, projectId, generationId);
  }

  @Delete(":projectId/generations/:generationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteGeneration(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Param("generationId") generationId: string
  ): Promise<void> {
    await this.projectsService.deleteGeneration(user, projectId, generationId);
  }
}

