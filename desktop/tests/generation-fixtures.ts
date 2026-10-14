import { readFileSync } from "node:fs";
import { AnalysisResponseSchema, GenerationDetailSchema } from "@vision2code/contracts";
import type { CreateGenerationInput, GenerationDetail, GenerationSummary, ProjectSummary, UISchema } from "@vision2code/contracts";
import type { ProjectsClient } from "../src/features/projects/projectsClient.ts";
import type { Screenshot } from "../src/features/screenshot/loadScreenshot.ts";
import type { GeneratedProject } from "../src/features/generation/generatedProject.ts";

export const uiSchemaFixture: UISchema = AnalysisResponseSchema.parse({
  requestId: "fixture",
  uiSchema: JSON.parse(readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8")),
}).uiSchema;

export const analysisResult = () => AnalysisResponseSchema.parse({ requestId: "session-test-001", uiSchema: uiSchemaFixture });

export const projectA = "123e4567-e89b-42d3-a456-426614174000";
export const projectB = "123e4567-e89b-42d3-a456-426614174001";
export const generationOne = "223e4567-e89b-42d3-a456-426614174000";
export const generationTwo = "223e4567-e89b-42d3-a456-426614174001";

export const summaryA: ProjectSummary = { id: projectA, name: "Alpha", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", generationCount: 0, latestGenerationId: null };
export const summaryB: ProjectSummary = { id: projectB, name: "Beta", createdAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z" };

export function summaryOf(id: string, createdAt: string, projectId = projectA, overrides: Partial<GenerationSummary> = {}): GenerationSummary {
  return {
    id, projectId, sourceImagePath: null, sourceImageName: "capture.png", sourceImageMimeType: "image/png",
    generationTarget: "REACT_TAILWIND", fidelityMode: "BALANCED", createdAt, ...overrides,
  };
}

export function screenshot(name = "capture.png", format: Screenshot["format"] = "PNG"): Screenshot {
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: "" });
  return { file, name, size: file.size, format, width: 640, height: 480, url: "blob:test-object-url" };
}

export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

let sequence = 0;
export function detailFrom(projectId: string, input: CreateGenerationInput, id?: string): GenerationDetail {
  sequence++;
  return GenerationDetailSchema.parse({
    id: id ?? `323e4567-e89b-42d3-a456-${String(426614174000 + sequence).padStart(12, "0")}`,
    projectId,
    sourceImagePath: input.sourceImagePath ?? null,
    sourceImageName: input.sourceImageName ?? null,
    sourceImageMimeType: input.sourceImageMimeType ?? null,
    generationTarget: input.generationTarget,
    fidelityMode: input.fidelityMode,
    createdAt: "2026-10-13T12:00:00.000Z",
    uiSchema: input.uiSchema,
    generatedProject: input.generatedProject,
  });
}

export const storedProject: GeneratedProject = {
  target: "react-tailwind",
  generatorVersion: "1",
  files: [
    { path: "src/generated/GeneratedInterface.tsx", language: "typescript", content: "export default function GeneratedInterface() { return <main>Stored</main>; }\n" },
    { path: "src/App.tsx", language: "typescript", content: "import GeneratedInterface from \"./generated/GeneratedInterface\";\nexport default function App() { return <GeneratedInterface />; }\n" },
  ],
};

export function storedGeneration(projectId = projectA, id = generationOne, project: GeneratedProject = storedProject): GenerationDetail {
  return GenerationDetailSchema.parse({
    id, projectId, sourceImagePath: null, sourceImageName: "stored.png", sourceImageMimeType: "image/png",
    generationTarget: "REACT_TAILWIND", fidelityMode: "PRECISE", createdAt: "2026-10-12T09:00:00.000Z",
    uiSchema: uiSchemaFixture, generatedProject: project,
  });
}

export interface ClientCall { method: string; projectId: string; body?: CreateGenerationInput; generationId?: string }

export function fakeClient(overrides: Partial<ProjectsClient> = {}) {
  const calls: ClientCall[] = [];
  const client: ProjectsClient = {
    listProjects: async () => { calls.push({ method: "listProjects", projectId: "" }); return [summaryA, summaryB]; },
    createProject: async (input) => ({ id: "423e4567-e89b-42d3-a456-426614174000", name: input.name, createdAt: "2026-10-13T08:00:00.000Z", updatedAt: "2026-10-13T08:00:00.000Z" }),
    getProject: async (id) => ({ id, name: id === projectA ? "Alpha" : "Beta", createdAt: summaryA.createdAt, updatedAt: summaryA.updatedAt, generations: [] }),
    renameProject: async () => { throw new Error("unused"); },
    deleteProject: async () => {},
    listGenerations: async () => [],
    getGeneration: async (projectId, generationId) => { calls.push({ method: "getGeneration", projectId, generationId }); return storedGeneration(projectId, generationId); },
    createGeneration: async (projectId, body) => { calls.push({ method: "createGeneration", projectId, body }); return detailFrom(projectId, body); },
    deleteGeneration: async () => {},
    ...overrides,
  };
  return { client, calls };
}
