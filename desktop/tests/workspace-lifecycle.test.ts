import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary } from "@vision2code/contracts";
import { createAuthModel } from "../src/features/auth/authModel.ts";
import type { AuthProvider } from "../src/features/auth/authProvider.ts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createGenerationArtifact } from "../src/features/generation/generationArtifact.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import type { PreviewEngine } from "../src/features/preview/previewTypes.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import {
  createAndSelectProject, latestGenerationOf, validateProjectName,
} from "../src/features/projects/projectTargetActions.ts";
import { bindWorkspaceToAuth, createWorkspaceServices } from "../src/features/workspace/workspaceServices.ts";
import { fakeClient, projectA, projectB, screenshot, summaryA, summaryB, uiSchemaFixture } from "./generation-fixtures.ts";

const engine: PreviewEngine = { kind: "placeholder", render: async () => ({ documentHtml: "<html></html>" }) };
const user = { id: "user-1", email: "first@example.com", emailVerified: true };

function provider(): AuthProvider {
  return {
    restoreSession: async () => null,
    signIn: async () => ({ user }),
    signUp: async () => ({ user, session: { user }, requiresEmailConfirmation: false }),
    signOut: async () => {},
    getAccessToken: async () => "access-token",
  };
}

/** Transport for the real ProjectsClient; records requests and lets a test force a status. */
function transport(status: { list: number } = { list: 200 }) {
  const requests: { method: string; url: string; authorization: string | null }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    requests.push({ method, url, authorization: new Headers(init?.headers).get("Authorization") });
    if (method === "GET" && url.endsWith("/projects")) {
      return status.list === 200 ? Response.json([summaryA, summaryB]) : new Response(null, { status: status.list });
    }
    if (method === "GET" && url.includes(`/projects/${projectA}`)) {
      return Response.json({ id: projectA, name: "Alpha", createdAt: summaryA.createdAt, updatedAt: summaryA.updatedAt, generations: [] });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetcher, requests };
}

async function signedInWorkspace(status?: { list: number }) {
  const auth = createAuthModel(provider(), { autoRestore: false });
  const net = transport(status);
  const services = createWorkspaceServices({
    getAccessToken: auth.getAccessToken,
    onUnauthorized: () => { if (auth.getSnapshot().status === "AUTHENTICATED") void auth.expireSession("SESSION_EXPIRED"); },
    baseUrl: "http://localhost:3000/api/v1",
    transport: net.fetcher,
    editorModel: createEditorModel(),
    previewModel: createPreviewModel(engine),
  });
  const unbind = bindWorkspaceToAuth(auth, services);
  await auth.signIn({ email: user.email, password: "correct-horse" });
  await services.projectsModel.loadProjects();
  return { auth, services, net, unbind };
}

async function populate(services: Awaited<ReturnType<typeof signedInWorkspace>>["services"]) {
  await services.projectsModel.selectProject(projectA);
  const artifact = createGenerationArtifact({
    uiSchema: uiSchemaFixture, generatedProject: generateReactProject(uiSchemaFixture),
    fidelity: "balanced", screenshot: screenshot(), targetProjectId: null,
  });
  await services.generationSession.complete(artifact);
  assert.equal(services.projectsModel.getSnapshot().projects.length, 2);
  assert.equal(services.projectsModel.getSnapshot().selectedProjectId, projectA);
  assert.ok(services.generationSession.getSnapshot().artifact);
  assert.ok(services.editorModel.getSnapshot().project);
  assert.ok(services.previewModel.getSnapshot().project);
}

function assertCleared(services: Awaited<ReturnType<typeof signedInWorkspace>>["services"]) {
  const projects = services.projectsModel.getSnapshot();
  assert.deepEqual(projects.projects, []);
  assert.equal(projects.selectedProjectId, null);
  assert.equal(projects.selectedProject, null);
  const session = services.generationSession.getSnapshot();
  assert.equal(session.artifact, null);
  assert.equal(session.projectId, null);
  assert.equal(session.generationId, null);
  assert.equal(session.saveStatus, "IDLE");
  assert.equal(services.editorModel.getSnapshot().project, null);
  assert.deepEqual(services.editorModel.getSnapshot().files, []);
  assert.equal(services.previewModel.getSnapshot().status, "EMPTY");
  assert.equal(services.previewModel.getSnapshot().project, null);
}

test("projects load when auth becomes AUTHENTICATED, using the auth token without storing it", async () => {
  const { services, net, unbind } = await signedInWorkspace();
  const lists = net.requests.filter((request) => request.url.endsWith("/projects"));
  assert.equal(lists.length, 1, "deduplicated load on sign-in");
  assert.equal(lists[0]!.authorization, "Bearer access-token");
  assert.deepEqual(services.projectsModel.getSnapshot().projects.map((project) => project.id), [projectA, projectB]);
  assert.ok(!JSON.stringify(services.projectsModel.getSnapshot()).includes("access-token"));
  assert.ok(!JSON.stringify(services.generationSession.getSnapshot()).includes("access-token"));
  unbind();
});

test("sign-out clears projects, selection, generation session, editor and preview", async () => {
  const { auth, services, unbind } = await signedInWorkspace();
  await populate(services);
  await auth.signOut();
  assertCleared(services);
  unbind();
});

test("session expiration clears every user-scoped state", async () => {
  const { auth, services, unbind } = await signedInWorkspace();
  await populate(services);
  await auth.expireSession("SESSION_EXPIRED");
  assertCleared(services);
  unbind();
});

test("401 from the projects API expires the session through the injected callback", async () => {
  const status = { list: 200 };
  const { auth, services, unbind } = await signedInWorkspace(status);
  status.list = 401;
  services.projectsModel.reset();
  await services.projectsModel.loadProjects();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(auth.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(auth.getSnapshot().error, "SESSION_EXPIRED");
  assertCleared(services);
  unbind();
});

test("5xx and network failures from the projects API never expire the session", async () => {
  for (const code of [500, 503]) {
    const status = { list: 200 };
    const { auth, services, unbind } = await signedInWorkspace(status);
    status.list = code;
    services.projectsModel.reset();
    await services.projectsModel.loadProjects();
    assert.equal(auth.getSnapshot().status, "AUTHENTICATED");
    assert.equal(services.projectsModel.getSnapshot().error, "SERVER_ERROR");
    unbind();
  }
  let expired = 0;
  const model = createProjectsModel(fakeClient({ listProjects: async () => { throw new ProjectsClientError("NETWORK_ERROR"); } }).client, () => { expired++; });
  await model.loadProjects();
  assert.equal(expired, 0);
});

test("a different user signing in never sees the previous user's projects", async () => {
  const { auth, services, unbind } = await signedInWorkspace();
  await populate(services);
  await auth.signOut();
  await auth.signIn({ email: "second@example.com", password: "correct-horse" });
  assert.equal(services.generationSession.getSnapshot().artifact, null);
  assert.equal(services.editorModel.getSnapshot().project, null);
  assert.equal(services.projectsModel.getSnapshot().selectedProjectId, null);
  unbind();
});

// ---- Create-project semantics -----------------------------------------------------------------

test("project names are trimmed and limited to 1–100 characters", () => {
  assert.deepEqual(validateProjectName("  Landing  "), { ok: true, name: "Landing" });
  assert.deepEqual(validateProjectName("   "), { ok: false, error: "projectNameRequired" });
  assert.deepEqual(validateProjectName("x".repeat(101)), { ok: false, error: "projectNameTooLong" });
  assert.deepEqual(validateProjectName("x".repeat(100)), { ok: true, name: "x".repeat(100) });
});

test("create-project success selects the created project only after the backend confirms", async () => {
  const created: ProjectSummary = { id: "423e4567-e89b-42d3-a456-426614174000", name: "Landing", createdAt: "2026-10-13T08:00:00.000Z", updatedAt: "2026-10-13T08:00:00.000Z" };
  let confirm!: (project: ProjectSummary) => void;
  const { client } = fakeClient({ createProject: () => new Promise((resolve) => { confirm = resolve; }) });
  const model = createProjectsModel(client);
  await model.loadProjects();
  await model.selectProject(projectA);
  const run = createAndSelectProject(model, "  Landing ");
  assert.equal(model.getSnapshot().selectedProjectId, projectA, "no selection before confirmation");
  confirm(created);
  const result = await run;
  assert.deepEqual(result, { status: "CREATED", project: created });
  const state = model.getSnapshot();
  assert.equal(state.selectedProjectId, created.id);
  assert.equal(state.projects[0]!.id, created.id);
});

test("create-project failure keeps list, selection, and reports FAILED", async () => {
  const { client } = fakeClient({ createProject: async () => { throw new ProjectsClientError("SERVER_ERROR"); } });
  const model = createProjectsModel(client);
  await model.loadProjects();
  await model.selectProject(projectB);
  const before = model.getSnapshot().projects;
  const result = await createAndSelectProject(model, "Landing");
  assert.deepEqual(result, { status: "FAILED" });
  const state = model.getSnapshot();
  assert.deepEqual(state.projects, before);
  assert.equal(state.selectedProjectId, projectB);
  assert.equal(state.error, "SERVER_ERROR");
});

test("invalid project names never reach the API", async () => {
  let calls = 0;
  const { client } = fakeClient({ createProject: async () => { calls++; return summaryA; } });
  const model = createProjectsModel(client);
  assert.deepEqual(await createAndSelectProject(model, "  "), { status: "INVALID", error: "projectNameRequired" });
  assert.equal(calls, 0);
});

test("latest generation comes from latestGenerationId or the selected project's history", async () => {
  const generation = "223e4567-e89b-42d3-a456-426614174009";
  const { client } = fakeClient({
    listProjects: async () => [{ ...summaryA, latestGenerationId: null }, summaryB],
    getProject: async (id) => ({ id, name: "Beta", createdAt: summaryB.createdAt, updatedAt: summaryB.updatedAt,
      generations: [{ id: generation, projectId: id, sourceImagePath: null, sourceImageName: null, sourceImageMimeType: null, generationTarget: "REACT_TAILWIND", fidelityMode: "FAST", createdAt: summaryB.createdAt }] }),
  });
  const model = createProjectsModel(client);
  await model.loadProjects();
  assert.equal(latestGenerationOf(model.getSnapshot()), null);
  await model.selectProject(projectB);
  assert.equal(latestGenerationOf(model.getSnapshot()), generation);
});
