import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { GenerationDetail } from "@vision2code/contracts";
import { createAuthModel } from "../src/features/auth/authModel.ts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import {
  bindGenerationToasts, PROJECT_REQUIRED_TOAST_MS, RESTORE_TOAST_KEY, RESTORED_TOAST_MS, SAVE_TOAST_KEY,
  SAVED_TOAST_MS, SAVING_TOAST_DELAY_MS, saveToastFor,
} from "../src/features/feedback/generationToasts.ts";
import { createToastModel } from "../src/features/feedback/toastModel.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createGenerationArtifact } from "../src/features/generation/generationArtifact.ts";
import { createGenerationSessionModel, type GenerationSessionState } from "../src/features/generation/generationSessionModel.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import type { ProjectsClient } from "../src/features/projects/projectsClient.ts";
import { bindWorkspaceToAuth, createWorkspaceServices } from "../src/features/workspace/workspaceServices.ts";
import { fakeScheduler } from "./fake-scheduler.ts";
import { deferred, fakeClient, generationOne, projectA, screenshot, storedGeneration, uiSchemaFixture } from "./generation-fixtures.ts";

function artifact(targetProjectId: string | null = projectA) {
  return createGenerationArtifact({ uiSchema: uiSchemaFixture, generatedProject: generateReactProject(uiSchemaFixture), fidelity: "balanced", screenshot: screenshot(), targetProjectId });
}

function setup(overrides: Partial<ProjectsClient> = {}) {
  const clock = fakeScheduler();
  const { client } = fakeClient(overrides);
  const session = createGenerationSessionModel({ client, loadProject: () => {} });
  let retries = 0;
  const source = { getSnapshot: session.getSnapshot, subscribe: session.subscribe, retrySave: () => { retries++; return session.retrySave(); } };
  const toasts = createToastModel(clock);
  const binding = bindGenerationToasts(source, toasts, clock);
  return { clock, session, toasts, binding, retries: () => retries };
}
const channel = (toasts: ReturnType<typeof createToastModel>, key = SAVE_TOAST_KEY) => toasts.getSnapshot().toasts.filter((toast) => toast.key === key);
const only = (toasts: ReturnType<typeof createToastModel>, key = SAVE_TOAST_KEY) => {
  const list = channel(toasts, key);
  assert.ok(list.length <= 1, "one toast per channel");
  return list[0] ?? null;
};

test("mapping table: every save status → tone, persistence, duration and action", () => {
  const base = { artifact: null, origin: "GENERATED", saveAttempts: 1, restoreStatus: "IDLE", restoreError: null, generationId: null } as const;
  const row = (saveStatus: GenerationSessionState["saveStatus"], origin: "GENERATED" | "RESTORED" = "GENERATED") => {
    const toast = saveToastFor({ ...base, origin, saveStatus }, () => {});
    return toast && [toast.tone, toast.persistent, toast.durationMs ?? null, toast.action?.label ?? null, toast.message];
  };
  assert.deepEqual(row("SAVED"), ["success", false, SAVED_TOAST_MS, null, "saveStatusSaved"]);
  assert.deepEqual(row("SAVE_FAILED"), ["error", true, null, "saveRetry", "saveStatusFailed"]);
  assert.deepEqual(row("SAVING"), ["progress", true, null, null, "toastSaving"]);
  assert.deepEqual(row("PROJECT_REQUIRED"), ["info", false, PROJECT_REQUIRED_TOAST_MS, null, "saveStatusProjectRequired"]);
  assert.deepEqual(row("NOT_PERSISTABLE"), ["error", true, null, null, "saveStatusNotPersistable"]);
  assert.equal(row("IDLE"), null);
  assert.equal(row("SAVED", "RESTORED"), null, "restored results use the restore channel");
  assert.equal(SAVED_TOAST_MS, 2500);
  assert.equal(PROJECT_REQUIRED_TOAST_MS, 4000);
  assert.equal(SAVING_TOAST_DELAY_MS, 700);
});

test("a save resolving before 700 ms never shows a progress toast", async () => {
  const pending = deferred<GenerationDetail>();
  const s = setup({ createGeneration: () => pending.promise });
  const run = s.session.complete(artifact());
  s.clock.advance(699);
  assert.equal(only(s.toasts), null);
  pending.resolve(storedGeneration());
  await run;
  assert.equal(only(s.toasts)?.tone, "success");
  s.clock.advance(5000);
  assert.equal(only(s.toasts), null);
  assert.equal(s.clock.pending(), 0, "delayed show was cancelled");
});

test("a save still running after 700 ms shows progress, then success replaces it in place", async () => {
  const pending = deferred<GenerationDetail>();
  const s = setup({ createGeneration: () => pending.promise });
  const run = s.session.complete(artifact());
  s.clock.advance(SAVING_TOAST_DELAY_MS);
  const progress = only(s.toasts)!;
  assert.equal(progress.tone, "progress");
  assert.equal(progress.persistent, true);
  pending.resolve(storedGeneration());
  await run;
  const saved = only(s.toasts)!;
  assert.equal(saved.id, progress.id, "same slot");
  assert.equal(saved.tone, "success");
  s.clock.advance(SAVED_TOAST_MS);
  assert.equal(only(s.toasts), null);
});

test("SAVE_FAILED → Retry → SAVING → SAVED ends as one toast that auto-dismisses", async () => {
  let attempt = 0;
  const retry = deferred<GenerationDetail>();
  const s = setup({ createGeneration: () => (++attempt === 1 ? Promise.reject(new ProjectsClientError("SERVER_ERROR")) : retry.promise) });
  await s.session.complete(artifact());
  const failed = only(s.toasts)!;
  assert.equal(failed.tone, "error");
  assert.equal(failed.persistent, true);
  s.clock.advance(60_000);
  assert.ok(only(s.toasts), "persistent error stays");
  failed.action!.run();
  const progress = only(s.toasts)!;
  assert.equal(progress.tone, "progress", "retry shows progress immediately");
  assert.equal(progress.id, failed.id, "replaced in place");
  retry.resolve(storedGeneration());
  await new Promise((resolve) => setImmediate(resolve));
  const saved = only(s.toasts)!;
  assert.equal(saved.id, failed.id);
  assert.equal(saved.tone, "success");
  assert.equal(s.toasts.getSnapshot().toasts.length, 1);
  s.clock.advance(SAVED_TOAST_MS);
  assert.equal(s.toasts.getSnapshot().toasts.length, 0);
});

test("the retry action calls the existing session retry once even on a double click", async () => {
  let requests = 0;
  const retry = deferred<GenerationDetail>();
  const s = setup({ createGeneration: () => (++requests === 1 ? Promise.reject(new ProjectsClientError("NETWORK_ERROR")) : retry.promise) });
  await s.session.complete(artifact());
  const action = only(s.toasts)!.action!;
  action.run();
  action.run();
  assert.equal(requests, 2, "one original save + one retry request");
  assert.equal(s.session.getSnapshot().saveStatus, "SAVING");
  retry.resolve(storedGeneration());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 2);
});

test("NOT_PERSISTABLE is a persistent error with no retry action", async () => {
  const s = setup();
  await s.session.complete({ ...artifact(), generatedProject: { target: "react-tailwind", generatorVersion: "1", files: [] } });
  const toast = only(s.toasts)!;
  assert.equal(toast.tone, "error");
  assert.equal(toast.persistent, true);
  assert.equal(toast.action, undefined);
});

test("PROJECT_REQUIRED is a discreet info toast that auto-dismisses after 4000 ms", async () => {
  const s = setup();
  await s.session.complete(artifact(null));
  assert.equal(only(s.toasts)?.tone, "info");
  s.clock.advance(PROJECT_REQUIRED_TOAST_MS - 1);
  assert.ok(only(s.toasts));
  s.clock.advance(1);
  assert.equal(only(s.toasts), null);
});

test("a stale delayed SAVING timer is cancelled when the status changes", async () => {
  const pending = deferred<GenerationDetail>();
  const s = setup({ createGeneration: () => pending.promise });
  void s.session.complete(artifact());
  assert.equal(s.clock.pending(), 1);
  s.session.clear();
  assert.equal(s.clock.pending(), 0);
  s.clock.advance(SAVING_TOAST_DELAY_MS * 2);
  assert.equal(only(s.toasts), null);
  pending.resolve(storedGeneration());
});

test("IDLE clears the save channel", async () => {
  const s = setup({ createGeneration: async () => { throw new ProjectsClientError("SERVER_ERROR"); } });
  await s.session.complete(artifact());
  assert.ok(only(s.toasts));
  s.session.clear();
  assert.equal(only(s.toasts), null);
});

test("restore success shows a 2500 ms success toast; failure a persistent error without retry", async () => {
  const s = setup();
  await s.session.openGeneration(projectA, generationOne);
  const restored = only(s.toasts, RESTORE_TOAST_KEY)!;
  assert.equal(restored.tone, "success");
  assert.equal(restored.message, "toastRestored");
  assert.equal(only(s.toasts), null, "no duplicate save toast for a restored result");
  s.clock.advance(RESTORED_TOAST_MS);
  assert.equal(only(s.toasts, RESTORE_TOAST_KEY), null);

  for (const [code, message] of [["NOT_FOUND", "restoreNotFound"], ["SERVER_ERROR", "restoreFailed"]] as const) {
    const f = setup({ getGeneration: async () => { throw new ProjectsClientError(code); } });
    await f.session.openGeneration(projectA, generationOne);
    const failed = only(f.toasts, RESTORE_TOAST_KEY)!;
    assert.equal(failed.tone, "error");
    assert.equal(failed.persistent, true);
    assert.equal(failed.message, message);
    assert.equal(failed.action, undefined);
    f.clock.advance(60_000);
    assert.ok(only(f.toasts, RESTORE_TOAST_KEY));
  }
});

test("opening again hides the previous restore error while loading", async () => {
  let fail = true;
  const s = setup({ getGeneration: async (projectId, generationId) => { if (fail) throw new ProjectsClientError("NETWORK_ERROR"); return storedGeneration(projectId, generationId); } });
  await s.session.openGeneration(projectA, generationOne);
  assert.equal(only(s.toasts, RESTORE_TOAST_KEY)?.tone, "error");
  fail = false;
  const opening = s.session.openGeneration(projectA, generationOne);
  assert.equal(only(s.toasts, RESTORE_TOAST_KEY), null);
  await opening;
  assert.equal(only(s.toasts, RESTORE_TOAST_KEY)?.tone, "success");
});

test("dismissing a toast never changes the session status or the stored artifact", async () => {
  const s = setup({ createGeneration: async () => { throw new ProjectsClientError("SERVER_ERROR"); } });
  await s.session.complete(artifact());
  const before = s.session.getSnapshot();
  s.toasts.dismiss(only(s.toasts)!.id);
  assert.equal(s.session.getSnapshot(), before);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVE_FAILED");
});

test("domain models and the generator never import toast code", () => {
  for (const file of ["generation/generationSessionModel.ts", "projects/projectsModel.ts", "generation/generateReactProject.ts"]) {
    const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /feedback|toast/i, file);
  }
});

// ---- Lifecycle through the real composition root --------------------------------------------

async function signedIn() {
  const clock = fakeScheduler();
  const auth = createAuthModel({
    restoreSession: async () => null,
    signIn: async () => ({ user: { id: "user-a", email: "a@example.com", emailVerified: true } }),
    signUp: async () => { throw new Error("unused"); },
    signOut: async () => {},
    getAccessToken: async () => "token",
  }, { autoRestore: false });
  const pendingSave = deferred<Response>();
  const services = createWorkspaceServices({
    getAccessToken: auth.getAccessToken,
    onUnauthorized: () => {},
    transport: ((_input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return pendingSave.promise;
      return Promise.resolve(Response.json([]));
    }) as typeof fetch,
    editorModel: createEditorModel(),
    previewModel: createPreviewModel({ kind: "placeholder", render: async () => ({ documentHtml: "" }) }),
    toastScheduler: clock,
  });
  const unbind = bindWorkspaceToAuth(auth, services);
  await auth.signIn({ email: "a@example.com", password: "correct-horse" });
  return { auth, services, clock, unbind };
}

test("sign-out clears toasts and cancels the delayed SAVING timer", async () => {
  const { auth, services, clock, unbind } = await signedIn();
  services.toasts.show({ key: RESTORE_TOAST_KEY, tone: "error", eyebrow: "e", message: "restoreFailed", persistent: true });
  void services.generationSession.complete(artifact());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(services.generationSession.getSnapshot().saveStatus, "SAVING");
  assert.ok(clock.pending() > 0);
  await auth.signOut();
  assert.deepEqual(services.toasts.getSnapshot().toasts, []);
  assert.equal(clock.pending(), 0);
  clock.advance(10_000);
  assert.deepEqual(services.toasts.getSnapshot().toasts, [], "nothing from user A appears later");
  unbind();
});

test("session expiration clears toasts and timers", async () => {
  const { auth, services, clock, unbind } = await signedIn();
  await services.generationSession.complete(artifact(null));
  assert.equal(services.toasts.getSnapshot().toasts.length, 1);
  await auth.expireSession("SESSION_EXPIRED");
  assert.deepEqual(services.toasts.getSnapshot().toasts, []);
  assert.equal(clock.pending(), 0);
  unbind();
});
