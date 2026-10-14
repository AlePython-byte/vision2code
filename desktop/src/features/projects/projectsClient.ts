import {
  CreateGenerationInputSchema, CreateProjectInputSchema, GenerationDetailSchema,
  GenerationSummarySchema, ProjectDetailSchema, ProjectSummarySchema, UpdateProjectInputSchema,
} from "@vision2code/contracts";
import type {
  CreateGenerationInput, CreateProjectInput, GenerationDetail, GenerationSummary,
  ProjectDetail, ProjectSummary, UpdateProjectInput,
} from "@vision2code/contracts";
import { z } from "zod";
import { resolveApiBaseUrl } from "../api/apiBaseUrl.ts";

export type ProjectsErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "VALIDATION_FAILED" |
  "NETWORK_ERROR" | "SERVER_ERROR" | "UNKNOWN";

export class ProjectsClientError extends Error {
  readonly code: ProjectsErrorCode;
  constructor(code: ProjectsErrorCode) {
    super(code);
    this.name = "ProjectsClientError";
    this.code = code;
  }
}

export interface ProjectsClient {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: CreateProjectInput): Promise<ProjectSummary>;
  getProject(projectId: string): Promise<ProjectDetail>;
  renameProject(projectId: string, input: UpdateProjectInput): Promise<ProjectSummary>;
  deleteProject(projectId: string): Promise<void>;
  listGenerations(projectId: string): Promise<GenerationSummary[]>;
  getGeneration(projectId: string, generationId: string): Promise<GenerationDetail>;
  createGeneration(projectId: string, input: CreateGenerationInput): Promise<GenerationDetail>;
  deleteGeneration(projectId: string, generationId: string): Promise<void>;
}

const uuid = z.string().uuid();

function pathId(id: string): string {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) throw new ProjectsClientError("VALIDATION_FAILED");
  return encodeURIComponent(parsed.data);
}

function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProjectsClientError("VALIDATION_FAILED");
  return parsed.data;
}

function responseCode(status: number): ProjectsErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 400) return "VALIDATION_FAILED";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

export function createProjectsClient(
  getAccessToken: () => Promise<string | null>,
  baseUrl?: string,
  transport: typeof fetch = globalThis.fetch
): ProjectsClient {
  async function request<T>(path: string, schema: z.ZodType<T> | null, method = "GET", body?: unknown): Promise<T> {
    let endpoint: string;
    try { endpoint = resolveApiBaseUrl(baseUrl); }
    catch { throw new ProjectsClientError("UNKNOWN"); }

    let token: string | null;
    try { token = await getAccessToken(); }
    catch { throw new ProjectsClientError("UNAUTHORIZED"); }
    if (!token?.trim()) throw new ProjectsClientError("UNAUTHORIZED");

    let result: Response;
    try {
      result = await transport(`${endpoint}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit",
        redirect: "error",
      });
    } catch {
      throw new ProjectsClientError("NETWORK_ERROR");
    }
    if (!result.ok) throw new ProjectsClientError(responseCode(result.status));
    if (schema === null) {
      if (result.status !== 204) throw new ProjectsClientError("UNKNOWN");
      return undefined as T;
    }
    let payload: unknown;
    try { payload = await result.json(); }
    catch { throw new ProjectsClientError("UNKNOWN"); }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new ProjectsClientError("UNKNOWN");
    return parsed.data;
  }

  return {
    listProjects: () => request("/projects", z.array(ProjectSummarySchema)),
    createProject: (value) => request("/projects", ProjectSummarySchema, "POST", input(CreateProjectInputSchema, value)),
    getProject: (id) => request(`/projects/${pathId(id)}`, ProjectDetailSchema),
    renameProject: (id, value) => request(`/projects/${pathId(id)}`, ProjectSummarySchema, "PATCH", input(UpdateProjectInputSchema, value)),
    deleteProject: (id) => request(`/projects/${pathId(id)}`, null, "DELETE"),
    listGenerations: (id) => request(`/projects/${pathId(id)}/generations`, z.array(GenerationSummarySchema)),
    getGeneration: (id, generationId) => request(`/projects/${pathId(id)}/generations/${pathId(generationId)}`, GenerationDetailSchema),
    createGeneration: (id, value) => request(`/projects/${pathId(id)}/generations`, GenerationDetailSchema, "POST", input(CreateGenerationInputSchema, value)),
    deleteGeneration: (id, generationId) => request(`/projects/${pathId(id)}/generations/${pathId(generationId)}`, null, "DELETE"),
  };
}
