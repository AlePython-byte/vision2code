import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createProjectsClient, ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import { DEFAULT_API_BASE_URL } from "../src/features/api/apiBaseUrl.ts";
import { UISchemaSchema, GeneratedProjectSchema } from "@vision2code/contracts";

const projectId = "123e4567-e89b-42d3-a456-426614174000";
const generationId = "123e4567-e89b-42d3-a456-426614174001";
const date = "2026-10-13T12:00:00.000Z";
const summary = { id: projectId, name: "Demo", createdAt: date, updatedAt: date, generationCount: 1, latestGenerationId: generationId };
const generation = {
  id: generationId, projectId, sourceImagePath: null, sourceImageName: "shot.png",
  sourceImageMimeType: "image/png", generationTarget: "REACT_TAILWIND", fidelityMode: "BALANCED", createdAt: date,
};
const uiSchema: unknown = JSON.parse(readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
const generatedProject = { target: "react-tailwind", generatorVersion: "1", files: [{ path: "src/App.tsx", content: "export default function App() {}", language: "typescript" }] };
const detail = { ...generation, uiSchema, generatedProject };

function client(payload: unknown, status = 200, capture?: (url: RequestInfo | URL, init?: RequestInit) => void) {
  return createProjectsClient(async () => "fresh-token", undefined, async (url, init) => {
    capture?.(url, init);
    return status === 204 ? new Response(null, { status }) : Response.json(payload, { status });
  });
}
async function code(promise: Promise<unknown>, expected: ProjectsClientError["code"]) {
  await assert.rejects(promise, (error: unknown) => error instanceof ProjectsClientError && error.code === expected);
}

test("list fetches a fresh bearer token and validates ordered summaries", async () => {
  let calls = 0;
  const api = createProjectsClient(async () => `token-${++calls}`, undefined, async (url, init) => {
    assert.equal(url, `${DEFAULT_API_BASE_URL}/projects`);
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer token-${calls}`);
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    return Response.json([summary]);
  });
  assert.deepEqual(await api.listProjects(), [summary]);
  await api.listProjects();
  assert.equal(calls, 2);
});

test("missing token never invokes fetch or sends a null bearer", async () => {
  for (const token of [null, "", "  "]) {
    let calls = 0;
    const api = createProjectsClient(async () => token, undefined, async () => { calls++; return Response.json([]); });
    await code(api.listProjects(), "UNAUTHORIZED");
    assert.equal(calls, 0);
  }
});

test("create validates input and response without sending ownership fields", async () => {
  const api = client(summary, 200, (_url, init) => {
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { name: "Demo" });
  });
  assert.deepEqual(await api.createProject({ name: "  Demo  " }), summary);
  await code(client({ ...summary, id: "bad" }).createProject({ name: "Demo" }), "UNKNOWN");
});

test("get and rename validate canonical project responses", async () => {
  const project = { id: projectId, name: "Demo", createdAt: date, updatedAt: date, generations: [generation] };
  assert.deepEqual(await client(project).getProject(projectId), project);
  await code(client({ ...project, generations: [{ ...generation, createdAt: "bad" }] }).getProject(projectId), "UNKNOWN");
  assert.deepEqual(await client({ ...summary, name: "New" }).renameProject(projectId, { name: "New" }), { ...summary, name: "New" });
  await code(client({ ...summary, name: 12 }).renameProject(projectId, { name: "New" }), "UNKNOWN");
});

test("delete project and generation require a successful 204", async () => {
  await client(null, 204).deleteProject(projectId);
  await client(null, 204).deleteGeneration(projectId, generationId);
  await code(client({}, 200).deleteProject(projectId), "UNKNOWN");
});

test("generation list and detail validate nested shared contracts", async () => {
  assert.deepEqual(await client([generation]).listGenerations(projectId), [generation]);
  await code(client([{ ...generation, fidelityMode: "invalid" }]).listGenerations(projectId), "UNKNOWN");
  assert.deepEqual(await client(detail).getGeneration(projectId, generationId), detail);
  await code(client({ ...detail, uiSchema: { invalid: true } }).getGeneration(projectId, generationId), "UNKNOWN");
  await code(client({ ...detail, generatedProject: { ...generatedProject, files: [] } }).getGeneration(projectId, generationId), "UNKNOWN");
  assert.deepEqual(await client(detail).createGeneration(projectId, { uiSchema: UISchemaSchema.parse(uiSchema), generatedProject: GeneratedProjectSchema.parse(generatedProject), generationTarget: "REACT_TAILWIND", fidelityMode: "BALANCED" }), detail);
});

test("HTTP, network, malformed success, and backend text map to safe codes", async () => {
  for (const [status, expected] of [[401, "UNAUTHORIZED"], [404, "NOT_FOUND"], [400, "VALIDATION_FAILED"], [500, "SERVER_ERROR"], [403, "UNKNOWN"]] as const) {
    await code(client({ error: { message: "PRIVATE_STACK_TRACE" } }, status).listProjects(), expected);
  }
  await code(createProjectsClient(async () => "token", undefined, async () => { throw new Error("PRIVATE_NETWORK_DETAIL"); }).listProjects(), "NETWORK_ERROR");
  await code(client({ private: "PRIVATE_PAYLOAD" }).listProjects(), "UNKNOWN");
  await code(createProjectsClient(async () => "token", undefined, async () => new Response("PRIVATE_HTML")).listProjects(), "UNKNOWN");
  try { await client({ error: { message: "PRIVATE_STACK_TRACE" } }, 500).listProjects(); }
  catch (error) { assert.doesNotMatch(String(error), /PRIVATE_STACK_TRACE/); }
});
