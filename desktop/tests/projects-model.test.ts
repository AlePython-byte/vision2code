import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectDetail, ProjectSummary } from "@vision2code/contracts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import type { ProjectsClient } from "../src/features/projects/projectsClient.ts";

const a = "123e4567-e89b-42d3-a456-426614174000";
const b = "123e4567-e89b-42d3-a456-426614174001";
const early = "2026-10-12T12:00:00.000Z";
const late = "2026-10-13T12:00:00.000Z";
const projectA: ProjectSummary = { id: a, name: "A", createdAt: early, updatedAt: early };
const projectB: ProjectSummary = { id: b, name: "B", createdAt: late, updatedAt: late };
const detail = (p: ProjectSummary): ProjectDetail => ({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, generations: [] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fake(overrides: Partial<ProjectsClient> = {}): ProjectsClient {
  return {
    listProjects: async () => [projectA, projectB],
    createProject: async () => projectB,
    getProject: async (id) => detail(id === a ? projectA : projectB),
    renameProject: async (_id, input) => ({ ...projectA, name: input.name, updatedAt: "2026-10-14T12:00:00.000Z" }),
    deleteProject: async () => {},
    listGenerations: async () => [],
    getGeneration: async () => { throw new Error("unused"); },
    createGeneration: async () => { throw new Error("unused"); },
    deleteGeneration: async () => {},
    ...overrides,
  };
}

test("initial IDLE, load transition, subscription, and deterministic revision", async () => {
  const pending = deferred<ProjectSummary[]>();
  const model = createProjectsModel(fake({ listProjects: () => pending.promise }));
  assert.deepEqual(model.getSnapshot(), { status: "IDLE", projects: [], selectedProjectId: null, selectedProject: null, error: null, revision: 0 });
  const states: string[] = [];
  const off = model.subscribe(() => states.push(`${model.getSnapshot().revision}:${model.getSnapshot().status}`));
  const run = model.loadProjects();
  assert.equal(model.getSnapshot().status, "LOADING");
  pending.resolve([projectA, projectB]);
  await run;
  assert.deepEqual(states, ["1:LOADING", "2:READY"]);
  assert.deepEqual(model.getSnapshot().projects, [projectA, projectB]);
  off();
  model.clearError();
  assert.equal(model.getSnapshot().revision, 2);
});

test("parallel list loads deduplicate and preserve backend order", async () => {
  const pending = deferred<ProjectSummary[]>();
  let calls = 0;
  const model = createProjectsModel(fake({ listProjects: () => { calls++; return pending.promise; } }));
  const first = model.loadProjects();
  const second = model.loadProjects();
  assert.equal(first, second);
  assert.equal(calls, 1);
  pending.resolve([projectA, projectB]);
  await first;
  assert.deepEqual(model.getSnapshot().projects.map((p) => p.id), [a, b]);
});

test("create inserts at top; rename follows updatedAt; delete clears selected project", async () => {
  const model = createProjectsModel(fake());
  await model.loadProjects();
  await model.createProject("B");
  assert.deepEqual(model.getSnapshot().projects.map((p) => p.id), [b, a]);
  await model.renameProject(a, "Renamed");
  assert.equal(model.getSnapshot().projects[0]?.name, "Renamed");
  await model.selectProject(a);
  assert.deepEqual(model.getSnapshot().selectedProject, detail(projectA));
  await model.deleteProject(a);
  assert.deepEqual(model.getSnapshot().projects.map((p) => p.id), [b]);
  assert.equal(model.getSnapshot().selectedProjectId, null);
  assert.equal(model.getSnapshot().selectedProject, null);
});

test("selection clears old detail and discards stale response", async () => {
  const pendingA = deferred<ProjectDetail>();
  const pendingB = deferred<ProjectDetail>();
  const model = createProjectsModel(fake({ getProject: (id) => id === a ? pendingA.promise : pendingB.promise }));
  const runA = model.selectProject(a);
  const runB = model.selectProject(b);
  assert.equal(model.getSnapshot().selectedProjectId, b);
  assert.equal(model.getSnapshot().selectedProject, null);
  pendingB.resolve(detail(projectB));
  await runB;
  pendingA.resolve(detail(projectA));
  await runA;
  assert.deepEqual(model.getSnapshot().selectedProject, detail(projectB));
});

test("list failure enters ERROR without replacing existing projects; clearError restores READY", async () => {
  let fail = false;
  const model = createProjectsModel(fake({ listProjects: async () => {
    if (fail) throw new ProjectsClientError("NETWORK_ERROR");
    return [projectA];
  } }));
  await model.loadProjects();
  fail = true;
  await model.loadProjects();
  assert.equal(model.getSnapshot().status, "ERROR");
  assert.equal(model.getSnapshot().error, "NETWORK_ERROR");
  assert.deepEqual(model.getSnapshot().projects, [projectA]);
  model.clearError();
  assert.equal(model.getSnapshot().status, "READY");
  assert.equal(model.getSnapshot().error, null);
});

test("initial list failure stays ERROR and clears to IDLE", async () => {
  const model = createProjectsModel(fake({ listProjects: async () => { throw new ProjectsClientError("SERVER_ERROR"); } }));
  await model.loadProjects();
  assert.equal(model.getSnapshot().status, "ERROR");
  model.clearError();
  assert.equal(model.getSnapshot().status, "IDLE");
});

test("failed create, rename, and delete preserve local data", async () => {
  const failure = async () => { throw new ProjectsClientError("SERVER_ERROR"); };
  const model = createProjectsModel(fake({ createProject: failure, renameProject: failure, deleteProject: failure }));
  await model.loadProjects();
  const before = model.getSnapshot().projects;
  await model.createProject("New");
  assert.deepEqual(model.getSnapshot().projects, before);
  await model.renameProject(a, "New");
  assert.deepEqual(model.getSnapshot().projects, before);
  await model.deleteProject(a);
  assert.deepEqual(model.getSnapshot().projects, before);
  assert.equal(model.getSnapshot().error, "SERVER_ERROR");
});

test("401 invokes integration hook; 500 leaves data and hook alone", async () => {
  let expires = 0;
  const model = createProjectsModel(fake({ getProject: async () => { throw new ProjectsClientError("UNAUTHORIZED"); } }), () => { expires++; });
  await model.loadProjects();
  await model.selectProject(a);
  assert.equal(model.getSnapshot().error, "UNAUTHORIZED");
  assert.equal(expires, 1);
  const separate = createProjectsModel(fake({ deleteProject: async () => { throw new ProjectsClientError("SERVER_ERROR"); } }), () => { expires++; });
  await separate.loadProjects();
  await separate.deleteProject(a);
  assert.equal(expires, 1);
  assert.deepEqual(separate.getSnapshot().projects, [projectA, projectB]);
});

test("stale list response after mutation and stale detail after deletion are ignored", async () => {
  const list = deferred<ProjectSummary[]>();
  const model = createProjectsModel(fake({ listProjects: () => list.promise }));
  const load = model.loadProjects();
  await model.createProject("B");
  list.resolve([projectA]);
  await load;
  assert.deepEqual(model.getSnapshot().projects, [projectB]);
  const selected = deferred<ProjectDetail>();
  const second = createProjectsModel(fake({ getProject: () => selected.promise }));
  await second.loadProjects();
  const selection = second.selectProject(a);
  await second.deleteProject(a);
  selected.resolve(detail(projectA));
  await selection;
  assert.equal(second.getSnapshot().selectedProject, null);
});

test("reset invalidates in-flight work and clears identity-bound data", async () => {
  const pending = deferred<ProjectSummary[]>();
  const model = createProjectsModel(fake({ listProjects: () => pending.promise }));
  const run = model.loadProjects();
  model.reset();
  pending.resolve([projectA]);
  await run;
  assert.equal(model.getSnapshot().status, "IDLE");
  assert.deepEqual(model.getSnapshot().projects, []);
});
