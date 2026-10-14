import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectDetail } from "@vision2code/contracts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import { openVaultLatest, openVaultProject, VAULT_OPEN_TOAST_KEY } from "../src/features/projects/vaultActions.ts";
import { fakeClient, projectA, projectB, summaryA, summaryB, deferred } from "./generation-fixtures.ts";

function setup(overrides: Parameters<typeof fakeClient>[0] = {}, unauthorized = false) {
  const { client } = fakeClient(overrides);
  let expires = 0;
  let projects: ReturnType<typeof createProjectsModel>;
  projects = createProjectsModel(client, () => { expires++; if (unauthorized) projects.reset(); });
  const shown: string[] = [];
  const toasts = { show: (input: { key: string }) => { shown.push(input.key); return null; } };
  let navigations = 0;
  const navigate = () => { navigations++; };
  return { projects, toasts, shown, navigate, get navigations() { return navigations; }, get expires() { return expires; } };
}

test("superseded open neither navigates nor shows a toast", async () => {
  const pending = deferred<ProjectDetail>();
  const s = setup({ getProject: (id) => id === projectA ? pending.promise : Promise.resolve({ ...summaryB, generations: [] }) });
  const first = openVaultProject(s.projects, s.toasts, projectA, s.navigate);
  await s.projects.selectProject(projectB);
  pending.resolve({ ...summaryA, generations: [] });
  assert.equal(await first, "SUPERSEDED");
  assert.equal(s.navigations, 0);
  assert.deepEqual(s.shown, []);
});

test("401 and session reset cause no Vault toast or navigation", async () => {
  const s = setup({ getProject: async () => { throw new ProjectsClientError("UNAUTHORIZED"); } }, true);
  assert.equal(await openVaultProject(s.projects, s.toasts, projectA, s.navigate), "UNAUTHORIZED");
  assert.equal(s.expires, 1);
  assert.equal(s.navigations, 0);
  assert.deepEqual(s.shown, []);
});

test("a real selection failure shows one localized channel toast and stays", async () => {
  const s = setup({ getProject: async () => { throw new ProjectsClientError("NOT_FOUND"); } });
  assert.equal(await openVaultProject(s.projects, s.toasts, projectA, s.navigate), "FAILED");
  assert.equal(s.navigations, 0);
  assert.deepEqual(s.shown, [VAULT_OPEN_TOAST_KEY]);
});

test("a successful open navigates once even with an unrelated stale error", async () => {
  const s = setup();
  const stale = { ...s.projects, getSnapshot: () => ({ ...s.projects.getSnapshot(), error: "SERVER_ERROR" as const }) };
  assert.equal(await openVaultProject(stale, s.toasts, projectA, s.navigate), "OPENED");
  assert.equal(s.navigations, 1);
  assert.deepEqual(s.shown, []);
});

test("latest generation opens after selection and navigates once", async () => {
  const s = setup();
  let restored = 0;
  const session = { openGeneration: async (id: string, generationId: string) => {
    assert.equal(id, projectA);
    assert.equal(generationId, "223e4567-e89b-42d3-a456-426614174001");
    restored++;
    return true;
  } };
  assert.equal(await openVaultLatest(s.projects, session, s.toasts, projectA,
    "223e4567-e89b-42d3-a456-426614174001", s.navigate), "OPENED");
  assert.equal(restored, 1);
  assert.equal(s.navigations, 1);
  assert.deepEqual(s.shown, []);
});

test("latest restore failure stays in Vault and relies on the restore toast", async () => {
  const s = setup();
  assert.equal(await openVaultLatest(s.projects, { openGeneration: async () => false }, s.toasts,
    projectA, "223e4567-e89b-42d3-a456-426614174001", s.navigate), "FAILED");
  assert.equal(s.navigations, 0);
  assert.deepEqual(s.shown, []);
});

test("latest restore followed by session expiration stays silent", async () => {
  const s = setup();
  const outcome = await openVaultLatest(s.projects, { openGeneration: async () => {
    s.projects.reset();
    return false;
  } }, s.toasts, projectA, "223e4567-e89b-42d3-a456-426614174001", s.navigate);
  assert.equal(outcome, "UNAUTHORIZED");
  assert.equal(s.navigations, 0);
  assert.deepEqual(s.shown, []);
});

test("latest restore that is superseded after selection cannot navigate", async () => {
  const pending = deferred<boolean>();
  const s = setup();
  const run = openVaultLatest(s.projects, { openGeneration: () => pending.promise }, s.toasts,
    projectA, "223e4567-e89b-42d3-a456-426614174001", s.navigate);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await s.projects.selectProject(projectB);
  pending.resolve(true);
  assert.equal(await run, "SUPERSEDED");
  assert.equal(s.navigations, 0);
  assert.deepEqual(s.shown, []);
});
