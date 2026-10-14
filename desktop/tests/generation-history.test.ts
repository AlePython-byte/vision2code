import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { GenerationSummary } from "@vision2code/contracts";
import { createAuthModel } from "../src/features/auth/authModel.ts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createGenerationArtifact } from "../src/features/generation/generationArtifact.ts";
import { createGenerationSessionModel } from "../src/features/generation/generationSessionModel.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import { createDiscardGuard, mayReplaceWorkingCopy } from "../src/features/projects/discardGuard.ts";
import { createGenerationHistoryModel } from "../src/features/projects/generationHistoryModel.ts";
import { selectHistoryGeneration } from "../src/features/projects/historyActions.ts";
import {
  deriveResultChip, formatGenerationNumber, generationNumber, generationNumberOf, relativeTimeLabel,
  resolveHistoryProjectId,
} from "../src/features/projects/historySelectors.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import type { ProjectsClient } from "../src/features/projects/projectsClient.ts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import { bindWorkspaceToAuth, createWorkspaceServices } from "../src/features/workspace/workspaceServices.ts";
import {
  deferred, fakeClient, generationOne, generationTwo, projectA, projectB, screenshot, storedGeneration, summaryOf, uiSchemaFixture,
} from "./generation-fixtures.ts";

const g3 = "223e4567-e89b-42d3-a456-426614174003";
const old1 = summaryOf(generationOne, "2026-10-10T10:00:00.000Z");
const old2 = summaryOf(generationTwo, "2026-10-11T10:00:00.000Z");
const newest = summaryOf(g3, "2026-10-13T10:00:00.000Z");

function artifact(targetProjectId: string | null = projectA) {
  return createGenerationArtifact({ uiSchema: uiSchemaFixture, generatedProject: generateReactProject(uiSchemaFixture), fidelity: "balanced", screenshot: screenshot(), targetProjectId });
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---- Pure helpers -------------------------------------------------------------------------

test("history project resolution: result wins (even local-only), otherwise the selection", () => {
  const withResult = (projectId: string | null) => ({ artifact: {}, projectId });
  const none = { artifact: null, projectId: null };
  assert.equal(resolveHistoryProjectId(withResult(projectA), { selectedProjectId: projectB }), projectA);
  assert.equal(resolveHistoryProjectId(withResult(null), { selectedProjectId: projectB }), null, "local-only result has no history");
  assert.equal(resolveHistoryProjectId(none, { selectedProjectId: projectB }), projectB);
  assert.equal(resolveHistoryProjectId(none, { selectedProjectId: null }), null);
});

test("generation numbers: newest has the highest number; unknown ids have none", () => {
  const items = [newest, old2, old1];
  assert.deepEqual(items.map((_, index) => generationNumber(items, index)), [3, 2, 1]);
  assert.equal(generationNumberOf(items, generationTwo), 2);
  assert.equal(generationNumberOf(items, "missing"), null);
  assert.equal(generationNumberOf(items, null), null);
  assert.equal(formatGenerationNumber(4), "04");
  assert.equal(formatGenerationNumber(12), "12");
});

test("relativeTimeLabel: just now, minutes, hours, yesterday, days, then a short date (ES + EN)", () => {
  const now = new Date("2026-10-14T12:00:00.000Z");
  const at = (offsetMs: number) => new Date(now.getTime() - offsetMs).toISOString();
  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
  assert.equal(relativeTimeLabel(at(20_000), "en", now), "just now");
  assert.equal(relativeTimeLabel(at(20_000), "es", now), "justo ahora");
  assert.equal(relativeTimeLabel(at(-5_000), "en", now), "just now", "future timestamps clamp");
  assert.equal(relativeTimeLabel(at(MIN), "en", now), "1 minute ago");
  assert.equal(relativeTimeLabel(at(7 * MIN + 5_000), "en", now), "7 minutes ago");
  assert.equal(relativeTimeLabel(at(7 * MIN), "es", now), "hace 7 minutos");
  assert.equal(relativeTimeLabel(at(59 * MIN + 59_000), "en", now), "59 minutes ago");
  assert.equal(relativeTimeLabel(at(HOUR), "en", now), "1 hour ago");
  assert.equal(relativeTimeLabel(at(5 * HOUR), "es", now), "hace 5 horas");
  assert.equal(relativeTimeLabel(at(23 * HOUR + 30 * MIN), "en", now), "23 hours ago");
  assert.equal(relativeTimeLabel(at(DAY + 2 * HOUR), "en", now), "yesterday");
  assert.equal(relativeTimeLabel(at(DAY + 2 * HOUR), "es", now), "ayer");
  assert.equal(relativeTimeLabel(at(3 * DAY), "en", now), "3 days ago");
  assert.equal(relativeTimeLabel(at(3 * DAY), "es", now), "hace 3 días");
  assert.equal(relativeTimeLabel(at(29 * DAY), "en", now), "29 days ago");
  const dated = relativeTimeLabel(at(45 * DAY), "en", now);
  assert.match(dated, /Aug|Sep/);
  assert.match(dated, /2026/);
  assert.equal(relativeTimeLabel("not-a-date", "en", now), "");
});

test("result chip derivation table including the Edited marker", () => {
  const chip = (origin: "GENERATED" | "RESTORED" | null, saveStatus: Parameters<typeof deriveResultChip>[0]["saveStatus"], draftCount = 0, number: number | null = null) =>
    deriveResultChip({ origin, saveStatus, draftCount, generationNumber: number });
  assert.equal(chip(null, "IDLE"), null, "no result → no chip");
  assert.deepEqual(chip("GENERATED", "SAVED"), { tone: "success", label: "chipGenerated", number: null, edited: false });
  assert.deepEqual(chip("RESTORED", "SAVED", 0, 4), { tone: "info", label: "chipRestored", number: 4, edited: false });
  assert.deepEqual(chip("GENERATED", "SAVING"), { tone: "progress", label: "chipSaving", number: null, edited: false });
  assert.deepEqual(chip("GENERATED", "SAVE_FAILED"), { tone: "warning", label: "chipUnsaved", number: null, edited: false });
  assert.deepEqual(chip("GENERATED", "PROJECT_REQUIRED"), { tone: "neutral", label: "chipLocal", number: null, edited: false });
  assert.deepEqual(chip("GENERATED", "NOT_PERSISTABLE"), { tone: "error", label: "chipNotSaveable", number: null, edited: false });
  assert.equal(chip("GENERATED", "IDLE")?.label, "chipSaving");
  assert.equal(chip("GENERATED", "SAVED", 2)?.edited, true);
  assert.equal(chip("RESTORED", "SAVED", 1, 2)?.edited, true);
  assert.equal(chip("GENERATED", "SAVE_FAILED", 1)?.label, "chipUnsaved", "edited is an extra marker, not a status");
});

// ---- History model --------------------------------------------------------------------------

function historySetup(listGenerations: ProjectsClient["listGenerations"], onUnauthorized?: () => void) {
  const { client } = fakeClient({ listGenerations });
  const projects = createProjectsModel(client);
  const calls = { createGeneration: 0, getGeneration: 0 };
  const sessionClient = {
    createGeneration: async (id: string, body: Parameters<ProjectsClient["createGeneration"]>[1]) => {
      calls.createGeneration++;
      return storedGeneration(id, g3, body.generatedProject);
    },
    getGeneration: async (id: string, generationId: string) => { calls.getGeneration++; return storedGeneration(id, generationId); },
  };
  const editor = createEditorModel();
  const preview = createPreviewModel({ kind: "placeholder", render: async () => ({ documentHtml: "" }) });
  const session = createGenerationSessionModel({
    client: sessionClient, projects,
    loadProject: (project) => { editor.setProject(project); preview.setProject(project); },
  });
  const history = createGenerationHistoryModel({ client, session, projects, ...(onUnauthorized ? { onUnauthorized } : {}) });
  return { history, session, projects, editor, calls };
}

test("history loads when the resolved project changes and does nothing while there is no project", async () => {
  const requested: string[] = [];
  const s = historySetup(async (id) => { requested.push(id); return [old2, old1]; });
  assert.equal(s.history.getSnapshot().status, "IDLE");
  await s.projects.loadProjects();
  assert.deepEqual(requested, []);
  await s.projects.selectProject(projectA);
  await tick();
  assert.deepEqual(requested, [projectA]);
  const state = s.history.getSnapshot();
  assert.equal(state.status, "READY");
  assert.equal(state.projectId, projectA);
  assert.deepEqual(state.items.map((item) => item.id), [generationTwo, generationOne]);
  await s.projects.selectProject(null);
  assert.equal(s.history.getSnapshot().status, "IDLE");
  assert.deepEqual(s.history.getSnapshot().items, []);
});

test("items are summaries kept newest first even if the server order drifts", async () => {
  const s = historySetup(async () => [old1, newest, old2]);
  await s.projects.selectProject(projectA);
  await tick();
  assert.deepEqual(s.history.getSnapshot().items.map((item) => item.id), [g3, generationTwo, generationOne]);
  for (const item of s.history.getSnapshot().items) assert.equal(Object.hasOwn(item, "uiSchema"), false);
});

test("a NEW confirmed save reloads once; restoring an already listed generation does not", async () => {
  let loads = 0;
  let listing = [old2, old1];
  const s = historySetup(async () => { loads++; return listing; });
  await s.projects.selectProject(projectA);
  await tick();
  assert.equal(loads, 1);
  // Restore of a listed generation: no reload.
  await s.session.openGeneration(projectA, generationOne);
  await tick();
  assert.equal(loads, 1);
  assert.equal(s.session.getSnapshot().generationId, generationOne);
  // A new generation is saved (server now lists it): reload exactly once.
  listing = [newest, old2, old1];
  await s.session.complete(artifact(projectA));
  await tick();
  assert.equal(loads, 2);
  assert.deepEqual(s.history.getSnapshot().items.map((item) => item.id), [g3, generationTwo, generationOne]);
  // Unrelated session changes do not reload.
  s.editor.edit("// edit");
  await s.session.openGeneration(projectA, g3);
  await tick();
  assert.equal(loads, 2);
});

test("a result for another project shows that project's history and a local-only result shows none", async () => {
  const requested: string[] = [];
  const s = historySetup(async (id) => { requested.push(id); return id === projectA ? [old1] : []; });
  await s.projects.selectProject(projectB);
  await tick();
  assert.deepEqual(requested, [projectB]);
  await s.session.complete(artifact(projectA));
  await tick();
  // One load when the result claims project A, one more because its save created a generation the first list predates.
  assert.deepEqual(requested, [projectB, projectA, projectA]);
  assert.equal(s.history.getSnapshot().projectId, projectA);
  await s.session.complete({ ...artifact(null) });
  assert.equal(s.history.getSnapshot().projectId, null);
  assert.equal(s.history.getSnapshot().status, "IDLE");
});

test("stale responses are discarded and in-flight loads are deduplicated per project", async () => {
  const pending = new Map<string, ReturnType<typeof deferred<GenerationSummary[]>>>();
  let requests = 0;
  const s = historySetup((id) => { requests++; const next = deferred<GenerationSummary[]>(); pending.set(id, next); return next.promise; });
  await s.projects.selectProject(projectA);
  s.projects.recordGeneration(projectA, old1);
  await s.projects.selectProject(projectA);
  assert.equal(requests, 1, "same project while loading → one request");
  await s.projects.selectProject(projectB);
  assert.equal(requests, 2);
  pending.get(projectB)!.resolve([old2]);
  await tick();
  pending.get(projectA)!.resolve([old1]);
  await tick();
  const state = s.history.getSnapshot();
  assert.equal(state.projectId, projectB);
  assert.deepEqual(state.items.map((item) => item.id), [generationTwo], "the older response did not win");
});

test("errors keep previous items for the same project; retry reloads", async () => {
  let fail = false;
  const s = historySetup(async () => { if (fail) throw new ProjectsClientError("SERVER_ERROR"); return [old2, old1]; });
  await s.projects.selectProject(projectA);
  await tick();
  assert.equal(s.history.getSnapshot().items.length, 2);
  fail = true;
  await s.history.retry();
  const failed = s.history.getSnapshot();
  assert.equal(failed.status, "ERROR");
  assert.equal(failed.error, "SERVER_ERROR");
  assert.equal(failed.items.length, 2, "previous items stay visible");
  fail = false;
  await s.history.retry();
  assert.equal(s.history.getSnapshot().status, "READY");
  assert.equal(s.history.getSnapshot().error, null);
});

test("401 reaches onUnauthorized once; 5xx and network errors do not expire the session", async () => {
  for (const [code, expected] of [["UNAUTHORIZED", 1], ["SERVER_ERROR", 0], ["NETWORK_ERROR", 0]] as const) {
    let expired = 0;
    const s = historySetup(async () => { throw new ProjectsClientError(code); }, () => { expired++; });
    await s.projects.selectProject(projectA);
    await tick();
    assert.equal(expired, expected, code);
    assert.equal(s.history.getSnapshot().status, "ERROR");
  }
});

test("history never calls analysis, the generator or the session, and never mutates editor or preview", async () => {
  const s = historySetup(async () => [old2, old1]);
  await s.session.complete(artifact(projectA));
  const sessionBefore = s.session.getSnapshot();
  const editorBefore = s.editor.getSnapshot();
  const savesBefore = s.calls.createGeneration;
  await s.projects.selectProject(projectA);
  await tick();
  await s.history.retry();
  s.history.reset();
  assert.equal(s.session.getSnapshot(), sessionBefore);
  assert.equal(s.editor.getSnapshot(), editorBefore);
  assert.equal(s.calls.createGeneration, savesBefore);
  assert.equal(s.calls.getGeneration, 0);
  const source = readFileSync(new URL("../src/features/projects/generationHistoryModel.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /generateReactProject|analysisClient|analysisModel|features\/auth|feedback|toast/);
  assert.match(source, /Pick<ProjectsClient, "listGenerations">/, "the only network call it can make is the listing");
});

test("reset clears the history and ignores in-flight responses", async () => {
  const pending = deferred<GenerationSummary[]>();
  const s = historySetup(() => pending.promise);
  await s.projects.selectProject(projectA);
  assert.equal(s.history.getSnapshot().status, "LOADING");
  s.history.reset();
  assert.equal(s.history.getSnapshot().status, "IDLE");
  pending.resolve([old1]);
  await tick();
  assert.deepEqual(s.history.getSnapshot().items, []);
  assert.equal(s.history.getSnapshot().projectId, null);
});

// ---- Discard guard and selection flow -------------------------------------------------------

test("mayReplaceWorkingCopy: no edits proceeds silently; edits require confirmation", async () => {
  let asked = 0;
  const confirm = async () => { asked++; return false; };
  assert.equal(await mayReplaceWorkingCopy(() => false, confirm, null), true);
  assert.equal(asked, 0);
  assert.equal(await mayReplaceWorkingCopy(undefined, confirm, null), true);
  assert.equal(await mayReplaceWorkingCopy(() => true, confirm, null), false);
  assert.equal(asked, 1);
  assert.equal(await mayReplaceWorkingCopy(() => true, undefined, null), false, "edits without a guard never get replaced");
});

test("discard guard: confirm answers true, cancel false, one dialog at a time, reset cancels", async () => {
  const guard = createDiscardGuard();
  const first = guard.request(null);
  assert.equal(guard.getSnapshot().open, true);
  assert.equal(await guard.request(null), false, "second request is refused while open");
  guard.confirm();
  assert.equal(await first, true);
  assert.equal(guard.getSnapshot().open, false);
  const second = guard.request(null);
  guard.cancel();
  assert.equal(await second, false);
  const third = guard.request(null);
  guard.cancel();
  assert.equal(await third, false);
  guard.confirm();
  assert.equal(guard.getSnapshot().open, false, "confirm with nothing pending is harmless");
});

test("selecting the current generation is a no-op; others open once after the guard", async () => {
  const opened: string[] = [];
  const session = { openGeneration: async (_project: string, id: string) => { opened.push(id); return id !== "boom"; } };
  const base = { session, projectId: projectA, currentGenerationId: generationOne, trigger: null };
  let asked = 0;
  const confirm = async () => { asked++; return true; };
  assert.equal(await selectHistoryGeneration({ ...base, generationId: generationOne, hasLocalEdits: () => true, confirmDiscard: confirm }), "CURRENT");
  assert.deepEqual(opened, []);
  assert.equal(asked, 0);
  assert.equal(await selectHistoryGeneration({ ...base, generationId: generationTwo, hasLocalEdits: () => false, confirmDiscard: confirm }), "OPENED");
  assert.deepEqual(opened, [generationTwo]);
  assert.equal(asked, 0, "no drafts → no dialog");
  assert.equal(await selectHistoryGeneration({ ...base, generationId: "boom", hasLocalEdits: () => false, confirmDiscard: confirm }), "FAILED");
});

test("with drafts: cancel keeps everything and calls nothing; confirm proceeds like no drafts", async () => {
  let opened = 0;
  const session = { openGeneration: async () => { opened++; return true; } };
  const editor = createEditorModel();
  editor.setProject(generateReactProject(uiSchemaFixture));
  editor.edit("// local work");
  const guard = createDiscardGuard();
  const input = {
    session, projectId: projectA, generationId: generationTwo, currentGenerationId: generationOne,
    hasLocalEdits: () => editor.getSnapshot().drafts.size > 0,
    confirmDiscard: (trigger: HTMLElement | null) => guard.request(trigger), trigger: null,
  };
  const cancelled = selectHistoryGeneration(input);
  assert.equal(guard.getSnapshot().open, true);
  assert.equal(opened, 0);
  guard.cancel();
  assert.equal(await cancelled, "CANCELLED");
  assert.equal(opened, 0);
  assert.equal(editor.getSnapshot().drafts.size, 1, "drafts intact");
  const confirmed = selectHistoryGeneration(input);
  guard.confirm();
  assert.equal(await confirmed, "OPENED");
  assert.equal(opened, 1);
});

test("restore failure through the history flow keeps current work and drafts", async () => {
  const s = historySetup(async () => [old2, old1]);
  const failing = createGenerationSessionModel({
    client: { createGeneration: async () => { throw new Error("unused"); }, getGeneration: async () => { throw new ProjectsClientError("NOT_FOUND"); } },
    loadProject: (project) => s.editor.setProject(project),
  });
  s.editor.setProject(generateReactProject(uiSchemaFixture));
  s.editor.edit("// keep me");
  const before = s.editor.getSnapshot();
  const outcome = await selectHistoryGeneration({
    session: failing, projectId: projectA, generationId: generationTwo, currentGenerationId: null,
    hasLocalEdits: () => true, confirmDiscard: async () => true, trigger: null,
  });
  assert.equal(outcome, "FAILED");
  assert.equal(s.editor.getSnapshot(), before);
  assert.equal(failing.getSnapshot().restoreStatus, "FAILED");
});

// ---- Lifecycle through the composition root --------------------------------------------------

test("sign-out and session expiry clear the history and cancel the pending confirmation", async () => {
  for (const leave of ["signOut", "expireSession"] as const) {
    const auth = createAuthModel({
      restoreSession: async () => null,
      signIn: async () => ({ user: { id: "user-a", email: "a@example.com", emailVerified: true } }),
      signUp: async () => { throw new Error("unused"); },
      signOut: async () => {},
      getAccessToken: async () => "token",
    }, { autoRestore: false });
    const services = createWorkspaceServices({
      getAccessToken: auth.getAccessToken,
      onUnauthorized: () => {},
      transport: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/generations")) return Response.json([old1]);
        return Response.json([{ id: projectA, name: "Alpha", createdAt: old1.createdAt, updatedAt: old1.createdAt }]);
      }) as typeof fetch,
      editorModel: createEditorModel(),
      previewModel: createPreviewModel({ kind: "placeholder", render: async () => ({ documentHtml: "" }) }),
    });
    const unbind = bindWorkspaceToAuth(auth, services);
    await auth.signIn({ email: "a@example.com", password: "correct-horse" });
    await services.projectsModel.loadProjects();
    await services.projectsModel.selectProject(projectA);
    await tick();
    assert.equal(services.history.getSnapshot().items.length, 1);
    const pending = services.discardGuard.request(null);
    await auth[leave]();
    assert.equal(await pending, false, "pending confirmation is cancelled");
    assert.equal(services.discardGuard.getSnapshot().open, false);
    assert.equal(services.history.getSnapshot().projectId, null);
    assert.deepEqual(services.history.getSnapshot().items, []);
    assert.equal(services.history.getSnapshot().status, "IDLE");
    unbind();
  }
});
