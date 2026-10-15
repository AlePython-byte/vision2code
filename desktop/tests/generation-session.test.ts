import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AnalysisResponse, GenerationDetail } from "@vision2code/contracts";
import { createAnalysisModel } from "../src/features/analysis/analysisModel.ts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import {
  createGenerationArtifact, toFidelityMode, toSourceImageName, type CompletedGenerationArtifact,
} from "../src/features/generation/generationArtifact.ts";
import { createGenerationSessionModel } from "../src/features/generation/generationSessionModel.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import type { PreviewEngine } from "../src/features/preview/previewTypes.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import type { ProjectsClient } from "../src/features/projects/projectsClient.ts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import { screenshotMimeType } from "../src/features/screenshot/validation.ts";
import {
  analysisResult, deferred, detailFrom, fakeClient, generationOne, generationTwo, projectA, projectB,
  screenshot, storedGeneration, storedProject, summaryA, summaryB, uiSchemaFixture,
} from "./generation-fixtures.ts";

const engine: PreviewEngine = { kind: "placeholder", render: async () => ({ documentHtml: "<html></html>" }) };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function workspace() {
  const editor = createEditorModel();
  const preview = createPreviewModel(engine);
  const loads: string[] = [];
  return {
    editor, preview, loads,
    loadProject(project: CompletedGenerationArtifact["generatedProject"]) {
      loads.push(project.files.map((file) => file.path).join(","));
      editor.setProject(project);
      preview.setProject(project);
      void preview.render();
    },
  };
}

function setup(clientOverrides: Partial<ProjectsClient> = {}, onUnauthorized?: () => void) {
  const { client, calls } = fakeClient(clientOverrides);
  const projects = createProjectsModel(client);
  const space = workspace();
  const session = createGenerationSessionModel({ client, projects, loadProject: space.loadProject, ...(onUnauthorized ? { onUnauthorized } : {}) });
  return { client, calls, projects, session, ...space };
}

function artifact(overrides: Partial<CompletedGenerationArtifact> = {}): CompletedGenerationArtifact {
  return {
    ...createGenerationArtifact({
      uiSchema: uiSchemaFixture,
      generatedProject: generateReactProject(uiSchemaFixture),
      fidelity: "precise",
      screenshot: screenshot(),
      targetProjectId: projectA,
    }),
    ...overrides,
  };
}

/** Analysis model whose analyze transport and artifact generation are counted. */
function countedAnalysis(options: Parameters<typeof createAnalysisModel>[1] = {}) {
  const pending: ReturnType<typeof deferred<AnalysisResponse>>[] = [];
  const counts = { analyze: 0, generate: 0 };
  const model = createAnalysisModel(() => { counts.analyze++; const next = deferred<AnalysisResponse>(); pending.push(next); return next.promise; }, options);
  const generateArtifact = model.generateArtifact;
  model.generateArtifact = () => { counts.generate++; return generateArtifact(); };
  return { model, counts, pending };
}

// ---- Mappings --------------------------------------------------------------------------------

test("fidelity mapping table is explicit and total", () => {
  assert.deepEqual(
    (["fast", "balanced", "precise"] as const).map((value) => [value, toFidelityMode(value)]),
    [["fast", "FAST"], ["balanced", "BALANCED"], ["precise", "PRECISE"]],
  );
});

test("MIME type comes from the validated screenshot format table, never from File.type", () => {
  assert.deepEqual(
    (["PNG", "JPEG", "WEBP"] as const).map((format) => [format, screenshotMimeType(format)]),
    [["PNG", "image/png"], ["JPEG", "image/jpeg"], ["WEBP", "image/webp"]],
  );
  // The fixture file has an empty File.type; the artifact still carries the format's MIME type.
  const built = createGenerationArtifact({ uiSchema: uiSchemaFixture, generatedProject: generateReactProject(uiSchemaFixture), fidelity: "fast", screenshot: screenshot("shot.webp", "WEBP"), targetProjectId: null });
  assert.equal(built.sourceImageMimeType, "image/webp");
});

test("source image name is a trimmed basename capped at 255 characters", () => {
  assert.equal(toSourceImageName("  capture.png  "), "capture.png");
  assert.equal(toSourceImageName("C:\\Users\\someone\\Desktop\\capture.png"), "capture.png");
  assert.equal(toSourceImageName("/home/someone/capture.png"), "capture.png");
  assert.equal(toSourceImageName("   "), null);
  assert.equal(toSourceImageName("a".repeat(400) + ".png")!.length, 255);
});

// ---- Persistence -----------------------------------------------------------------------------

test("analysis captures the target project at start: A, switch to B, finish → saved under A", async () => {
  const s = setup();
  await s.projects.loadProjects();
  await s.projects.selectProject(projectA);
  const { model, pending } = countedAnalysis();
  model.setScreenshot(screenshot());
  const run = model.analyze({ targetProjectId: s.projects.getSnapshot().selectedProjectId, fidelity: "fast" });
  assert.equal(model.getSnapshot().context?.targetProjectId, projectA);
  await s.projects.selectProject(projectB);
  pending[0]!.resolve(analysisResult());
  await run;
  const built = model.generateArtifact()!;
  assert.equal(built.targetProjectId, projectA);
  await s.session.complete(built);
  const saves = s.calls.filter((call) => call.method === "createGeneration");
  assert.equal(saves.length, 1);
  assert.equal(saves[0]!.projectId, projectA);
  assert.equal(s.session.getSnapshot().projectId, projectA);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVED");
});

test("save happens only after a complete, valid generation and sends the exact safe body", async () => {
  const s = setup();
  const { model, pending } = countedAnalysis();
  model.setScreenshot(screenshot("C:\\Users\\private\\shot.png"));
  const run = model.analyze({ targetProjectId: projectA, fidelity: "balanced" });
  assert.equal(model.generateArtifact(), null, "nothing to persist while analyzing");
  assert.equal(s.calls.length, 0);
  pending[0]!.resolve(analysisResult());
  await run;
  await s.session.complete(model.generateArtifact()!);
  const [save] = s.calls.filter((call) => call.method === "createGeneration");
  const body = save!.body!;
  assert.deepEqual(Object.keys(body).sort(), ["fidelityMode", "generatedProject", "generationTarget", "sourceImageMimeType", "sourceImageName", "sourceImagePath", "uiSchema"].sort());
  assert.equal(body.sourceImagePath, null);
  assert.equal(body.sourceImageName, "shot.png");
  assert.equal(body.sourceImageMimeType, "image/png");
  assert.equal(body.fidelityMode, "BALANCED");
  assert.equal(body.generationTarget, "REACT_TAILWIND");
  assert.deepEqual(body.generatedProject, generateReactProject(uiSchemaFixture));
  assert.deepEqual(body.uiSchema, uiSchemaFixture);
  const serialized = JSON.stringify(body);
  assert.ok(!/userId|ownerId|base64|blob:|data:image|\\\\Users|private/.test(serialized), "no identity, binary, URL or path data");
});

test("code loads into the editor and preview immediately, before the save resolves", async () => {
  const pendingSave = deferred<GenerationDetail>();
  const s = setup({ createGeneration: () => pendingSave.promise });
  const run = s.session.complete(artifact());
  assert.equal(s.session.getSnapshot().saveStatus, "SAVING");
  assert.equal(s.editor.getSnapshot().activePath, "src/generated/GeneratedInterface.tsx");
  assert.equal(s.preview.getSnapshot().project?.files.length, 2);
  pendingSave.resolve(storedGeneration(projectA, generationOne, generateReactProject(uiSchemaFixture)));
  await run;
  assert.equal(s.session.getSnapshot().saveStatus, "SAVED");
  assert.equal(s.session.getSnapshot().generationId, generationOne);
});

test("invalid GeneratedProject → no API call and a distinct NOT_PERSISTABLE state", async () => {
  const s = setup();
  const broken = artifact({ generatedProject: { target: "react-tailwind", generatorVersion: "1", files: [] } });
  await s.session.complete(broken);
  assert.equal(s.calls.length, 0);
  assert.equal(s.session.getSnapshot().saveStatus, "NOT_PERSISTABLE");
  assert.equal(s.session.getSnapshot().saveError, null, "not disguised as a save error");
  assert.equal(s.loads.length, 0, "a contract-invalid project is not loaded");
});

test("invalid UISchema → no API call and NOT_PERSISTABLE, while valid code is still shown locally", async () => {
  const s = setup();
  const broken = artifact({ uiSchema: { ...uiSchemaFixture, schemaVersion: "9.9" } as unknown as CompletedGenerationArtifact["uiSchema"] });
  await s.session.complete(broken);
  assert.equal(s.calls.length, 0);
  assert.equal(s.session.getSnapshot().saveStatus, "NOT_PERSISTABLE");
  assert.equal(s.loads.length, 1);
});

test("no project at analysis start → PROJECT_REQUIRED, no API call, no auto-create, no late attach", async () => {
  let creates = 0;
  const s = setup({ createProject: async () => { creates++; throw new Error("must not be called"); } });
  await s.projects.loadProjects();
  const { model, pending } = countedAnalysis();
  model.setScreenshot(screenshot());
  const run = model.analyze({ targetProjectId: null, fidelity: "balanced" });
  await s.projects.selectProject(projectB);
  pending[0]!.resolve(analysisResult());
  await run;
  await s.session.complete(model.generateArtifact()!);
  assert.equal(s.session.getSnapshot().saveStatus, "PROJECT_REQUIRED");
  assert.equal(s.session.getSnapshot().projectId, null);
  assert.equal(s.calls.filter((call) => call.method === "createGeneration").length, 0);
  assert.equal(creates, 0);
  await s.session.retrySave();
  assert.equal(s.calls.filter((call) => call.method === "createGeneration").length, 0);
});

test("save failure keeps editor, preview and artifact; status SAVE_FAILED with a safe code", async () => {
  const s = setup({ createGeneration: async () => { throw new ProjectsClientError("SERVER_ERROR"); } });
  const input = artifact();
  await s.session.complete(input);
  const state = s.session.getSnapshot();
  assert.equal(state.saveStatus, "SAVE_FAILED");
  assert.equal(state.saveError, "SERVER_ERROR");
  assert.deepEqual(state.artifact, input);
  assert.ok(s.editor.getSnapshot().project);
  assert.ok(s.preview.getSnapshot().project);
  assert.equal(s.projects.getSnapshot().projects.length, 0, "projects model untouched");
});

test("retry reuses the same artifact and project without analysis or generation", async () => {
  let fail = true;
  const bodies: { projectId: string; body: unknown }[] = [];
  const s = setup({
    createGeneration: async (projectId, body) => {
      bodies.push({ projectId, body });
      if (fail) throw new ProjectsClientError("NETWORK_ERROR");
      return detailFrom(projectId, body);
    },
  });
  const { model, counts, pending } = countedAnalysis();
  model.setScreenshot(screenshot());
  const run = model.analyze({ targetProjectId: projectA, fidelity: "precise" });
  pending[0]!.resolve(analysisResult());
  await run;
  await s.session.complete(model.generateArtifact()!);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVE_FAILED");
  await s.projects.selectProject(projectB);
  fail = false;
  await s.session.retrySave();
  assert.equal(counts.analyze, 1, "no second analysis");
  assert.equal(counts.generate, 1, "no second generation");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1]!.projectId, projectA, "captured project, not the newly selected one");
  assert.deepEqual(bodies[1]!.body, bodies[0]!.body);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVED");
  const source = readFileSync(new URL("../src/features/generation/generationSessionModel.ts", import.meta.url), "utf8");
  assert.ok(!/generateReactProject|analysisClient|analysisModel/.test(source), "session cannot reach analysis or the generator");
});

test("parallel retry clicks issue a single request", async () => {
  let attempt = 0;
  const pendingRetry = deferred<GenerationDetail>();
  const s = setup({
    createGeneration: (projectId, body) => {
      attempt++;
      if (attempt === 1) return Promise.reject(new ProjectsClientError("SERVER_ERROR"));
      return pendingRetry.promise.then(() => detailFrom(projectId, body));
    },
  });
  await s.session.complete(artifact());
  const first = s.session.retrySave();
  const second = s.session.retrySave();
  const third = s.session.retrySave();
  assert.equal(s.session.getSnapshot().saveStatus, "SAVING");
  assert.equal(s.session.getSnapshot().saveAttempts, 2);
  pendingRetry.resolve(storedGeneration());
  await Promise.all([first, second, third]);
  assert.equal(attempt, 2);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVED");
});

test("generating the same analysis result twice never persists twice", async () => {
  const s = setup();
  const { model, pending } = countedAnalysis();
  model.setScreenshot(screenshot());
  const run = model.analyze({ targetProjectId: projectA, fidelity: "balanced" });
  pending[0]!.resolve(analysisResult());
  await run;
  await s.session.complete(model.generateArtifact()!);
  s.editor.edit("// local edit");
  await s.session.complete(model.generateArtifact()!);
  assert.equal(s.calls.filter((call) => call.method === "createGeneration").length, 1);
  assert.equal(s.editor.getSnapshot().drafts.size, 0, "original code reloaded");
  assert.equal(s.loads.length, 2);
});

test("stale save response for an older artifact is discarded by the session", async () => {
  const saves: ReturnType<typeof deferred<GenerationDetail>>[] = [];
  const s = setup({ createGeneration: () => { const next = deferred<GenerationDetail>(); saves.push(next); return next.promise; } });
  await s.projects.loadProjects();
  const older = s.session.complete(artifact());
  const newer = s.session.complete(artifact({ fidelityMode: "FAST" }));
  saves[1]!.resolve(storedGeneration(projectA, generationTwo));
  await newer;
  saves[0]!.resolve(storedGeneration(projectA, generationOne));
  await older;
  const state = s.session.getSnapshot();
  assert.equal(state.generationId, generationTwo);
  assert.equal(state.artifact?.fidelityMode, "FAST");
  assert.equal(state.saveStatus, "SAVED");
});

test("new analysis or screenshot change replaces the session; pending save results are dropped", async () => {
  const pendingSave = deferred<GenerationDetail>();
  const s = setup({ createGeneration: () => pendingSave.promise });
  const { model } = countedAnalysis({ onReplaced: () => s.session.clear() });
  const run = s.session.complete(artifact());
  model.setScreenshot(screenshot("other.png"));
  assert.equal(s.session.getSnapshot().artifact, null);
  pendingSave.resolve(storedGeneration());
  await run;
  assert.equal(s.session.getSnapshot().saveStatus, "IDLE");
  assert.equal(s.session.getSnapshot().generationId, null);
  assert.ok(s.editor.getSnapshot().project, "local editor work is kept");
});

test("ProjectsModel is updated locally after a save: order, updatedAt, count, generations", async () => {
  const s = setup({ createGeneration: async (projectId, body) => ({ ...detailFrom(projectId, body, generationTwo), createdAt: "2026-10-13T12:00:00.000Z" }) });
  await s.projects.loadProjects();
  await s.projects.selectProject(projectA);
  assert.deepEqual(s.projects.getSnapshot().projects.map((project) => project.id), [projectA, projectB]);
  await s.session.complete(artifact());
  const state = s.projects.getSnapshot();
  assert.deepEqual(state.projects.map((project) => project.id), [projectA, projectB]);
  const updated = state.projects[0]!;
  assert.equal(updated.updatedAt, "2026-10-13T12:00:00.000Z");
  assert.equal(updated.generationCount, 1);
  assert.equal(updated.latestGenerationId, generationTwo);
  assert.equal(state.selectedProject?.generations[0]?.id, generationTwo);
  assert.equal(state.selectedProject?.updatedAt, "2026-10-13T12:00:00.000Z");
  assert.equal(Object.hasOwn(state.selectedProject!.generations[0]!, "uiSchema"), false, "summary only");
});

test("recordGeneration reorders by updatedAt DESC and leaves projects without a count untouched", async () => {
  const { client } = fakeClient({ listProjects: async () => [summaryB, summaryA] });
  const projects = createProjectsModel(client);
  await projects.loadProjects();
  projects.recordGeneration(projectA, { ...storedGeneration(projectA, generationOne), createdAt: "2026-10-05T00:00:00.000Z" });
  assert.deepEqual(projects.getSnapshot().projects.map((project) => project.id), [projectA, projectB]);
  projects.recordGeneration(projectB, { ...storedGeneration(projectB, generationTwo), createdAt: "2026-10-06T00:00:00.000Z" });
  const beta = projects.getSnapshot().projects[0]!;
  assert.equal(beta.id, projectB);
  assert.equal(Object.hasOwn(beta, "generationCount"), false);
  projects.recordGeneration(projectA, storedGeneration(projectB, generationTwo));
  assert.equal(projects.getSnapshot().projects[0]!.id, projectB, "mismatched project id is ignored");
});

test("401 on save expires the session; 5xx and network failures do not", async () => {
  for (const [code, expected] of [["UNAUTHORIZED", 1], ["SERVER_ERROR", 0], ["NETWORK_ERROR", 0]] as const) {
    let expired = 0;
    const s = setup({ createGeneration: async () => { throw new ProjectsClientError(code); } }, () => { expired++; });
    await s.session.complete(artifact());
    assert.equal(expired, expected, code);
    assert.equal(s.session.getSnapshot().saveStatus, "SAVE_FAILED");
  }
});

// ---- Restoration -----------------------------------------------------------------------------

test("openGeneration restores exact files without analysis or generation", async () => {
  const s = setup();
  const { counts } = countedAnalysis();
  s.loadProject({ target: "react-tailwind", generatorVersion: "1", files: [{ path: "src/App.tsx", language: "typescript", content: "previous" }, { path: "src/old.tsx", language: "typescript", content: "old" }] });
  const opened = await s.session.openGeneration(projectA, generationOne);
  assert.equal(opened, true);
  assert.equal(counts.analyze + counts.generate, 0);
  const editor = s.editor.getSnapshot();
  assert.deepEqual(editor.files.map((file) => [file.path, file.content]).sort(), storedProject.files.map((file) => [file.path, file.content]).sort());
  assert.equal(editor.activePath, "src/generated/GeneratedInterface.tsx");
  assert.equal(editor.files.some((file) => file.path === "src/old.tsx"), false, "previous files cleared");
  assert.deepEqual(s.preview.getSnapshot().project?.files.map((file) => file.content).sort(), storedProject.files.map((file) => file.content).sort());
  const state = s.session.getSnapshot();
  assert.deepEqual(state.artifact?.uiSchema, uiSchemaFixture);
  assert.equal(state.artifact?.fidelityMode, "PRECISE");
  assert.equal(state.projectId, projectA);
  assert.equal(state.generationId, generationOne);
  assert.equal(state.saveStatus, "SAVED");
  assert.equal(state.origin, "RESTORED");
  assert.equal(s.calls.filter((call) => call.method === "createGeneration").length, 0, "restoring never re-saves");
});

test("editing after restore never mutates the stored GenerationDetail or the session artifact", async () => {
  const detail = storedGeneration();
  const snapshot = JSON.stringify(detail);
  const s = setup({ getGeneration: async () => detail });
  await s.session.openGeneration(projectA, generationOne);
  s.editor.edit("// edited in Monaco");
  assert.equal(JSON.stringify(detail), snapshot);
  assert.equal(s.session.getSnapshot().artifact?.generatedProject.files[0]?.content, storedProject.files[0]!.content);
  assert.ok(Object.isFrozen(s.session.getSnapshot().artifact?.generatedProject.files[0]));
});

test("404 and network errors keep the current work untouched and report a safe code", async () => {
  for (const code of ["NOT_FOUND", "NETWORK_ERROR", "SERVER_ERROR"] as const) {
    let expired = 0;
    const s = setup({ getGeneration: async () => { throw new ProjectsClientError(code); } }, () => { expired++; });
    const current = artifact();
    await s.session.complete(current);
    const editorBefore = s.editor.getSnapshot();
    const opened = await s.session.openGeneration(projectA, generationOne);
    assert.equal(opened, false);
    const state = s.session.getSnapshot();
    assert.equal(state.restoreStatus, "FAILED");
    assert.equal(state.restoreError, code);
    assert.deepEqual(state.artifact, current);
    assert.equal(state.saveStatus, "SAVED");
    assert.equal(s.editor.getSnapshot(), editorBefore);
    assert.equal(expired, 0, `${code} must not expire the session`);
  }
});

test("401 on restore triggers session expiration", async () => {
  let expired = 0;
  const s = setup({ getGeneration: async () => { throw new ProjectsClientError("UNAUTHORIZED"); } }, () => { expired++; });
  assert.equal(await s.session.openGeneration(projectA, generationOne), false);
  assert.equal(expired, 1);
});

test("concurrent openGeneration: the older response never wins", async () => {
  const responses = new Map<string, ReturnType<typeof deferred<GenerationDetail>>>();
  const s = setup({ getGeneration: (_projectId, generationId) => { const next = deferred<GenerationDetail>(); responses.set(generationId, next); return next.promise; } });
  const first = s.session.openGeneration(projectA, generationOne);
  const second = s.session.openGeneration(projectA, generationTwo);
  const newer = { ...storedProject, files: storedProject.files.map((file) => ({ ...file, content: file.content + "// newer\n" })) };
  responses.get(generationTwo)!.resolve(storedGeneration(projectA, generationTwo, newer));
  assert.equal(await second, true);
  responses.get(generationOne)!.resolve(storedGeneration(projectA, generationOne));
  assert.equal(await first, false);
  assert.equal(s.session.getSnapshot().generationId, generationTwo);
  assert.ok(s.editor.getSnapshot().files.every((file) => file.content.endsWith("// newer\n")));
});

test("a restore in flight is superseded by a newer generation", async () => {
  const pendingOpen = deferred<GenerationDetail>();
  const s = setup({ getGeneration: () => pendingOpen.promise });
  const opening = s.session.openGeneration(projectA, generationOne);
  await s.session.complete(artifact());
  pendingOpen.resolve(storedGeneration());
  assert.equal(await opening, false);
  assert.equal(s.session.getSnapshot().origin, "GENERATED");
  await flush();
});

test("reset discards in-flight save and restore responses", async () => {
  const pendingSave = deferred<GenerationDetail>();
  const pendingOpen = deferred<GenerationDetail>();
  let expired = 0;
  const s = setup({ createGeneration: () => pendingSave.promise, getGeneration: () => pendingOpen.promise }, () => { expired++; });
  await s.projects.loadProjects();
  const saving = s.session.complete(artifact());
  const opening = s.session.openGeneration(projectA, generationOne);
  s.session.reset();
  s.projects.reset();
  pendingSave.reject(new ProjectsClientError("UNAUTHORIZED"));
  pendingOpen.resolve(storedGeneration());
  await saving;
  assert.equal(await opening, false);
  const state = s.session.getSnapshot();
  assert.equal(state.artifact, null);
  assert.equal(state.saveStatus, "IDLE");
  assert.equal(expired, 0, "responses from a previous session cannot expire the next one");
});

// ---- Generating again after a restore (TASK 009F) -------------------------------------------

/** Analysis result A completed into the session, then generation one restored over it. */
async function analyzedThenRestored(save: ProjectsClient["createGeneration"] = async (projectId, body) => detailFrom(projectId, body, generationTwo)) {
  const s = setup({ createGeneration: (projectId, body) => { s.calls.push({ method: "createGeneration", projectId, body }); return save(projectId, body); } });
  const analysis = countedAnalysis();
  analysis.model.setScreenshot(screenshot());
  const run = analysis.model.analyze({ targetProjectId: projectA, fidelity: "balanced" });
  analysis.pending[0]!.resolve(analysisResult());
  await run;
  return { ...s, analysis, saving: s.session.complete(analysis.model.generateArtifact()!) };
}
const saveCount = (calls: { method: string }[]) => calls.filter((call) => call.method === "createGeneration").length;

test("restoring and then generating the same analysis result again never saves it twice", async () => {
  const s = await analyzedThenRestored();
  await s.saving;
  assert.equal(s.session.getSnapshot().generationId, generationTwo);
  assert.equal(await s.session.openGeneration(projectA, generationOne), true);
  assert.equal(s.session.getSnapshot().origin, "RESTORED");
  await s.session.complete(s.analysis.model.generateArtifact()!);
  assert.equal(saveCount(s.calls), 1, "the analysis result is persisted once");
  const state = s.session.getSnapshot();
  assert.equal(state.origin, "GENERATED");
  assert.equal(state.saveStatus, "SAVED");
  assert.equal(state.generationId, generationTwo, "returns to the generation it was saved as");
  assert.equal(state.projectId, projectA);
  assert.equal(s.analysis.counts.analyze, 1, "no new analysis");
  assert.equal(s.loads.length, 3, "generated, restored, then the generated code again");
});

test("a save still in flight when restoring finishes in the background and is never repeated", async () => {
  const save = deferred<GenerationDetail>();
  const s = await analyzedThenRestored(() => save.promise);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVING");
  await s.session.openGeneration(projectA, generationOne);
  save.resolve(storedGeneration(projectA, generationTwo));
  await s.saving;
  assert.equal(s.session.getSnapshot().origin, "RESTORED", "the late save never overwrites the restored result");
  assert.equal(s.session.getSnapshot().generationId, generationOne);
  await s.session.complete(s.analysis.model.generateArtifact()!);
  assert.equal(saveCount(s.calls), 1);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVED");
  assert.equal(s.session.getSnapshot().generationId, generationTwo);
});

test("returning to a result whose save is still pending waits for that same save", async () => {
  const save = deferred<GenerationDetail>();
  const s = await analyzedThenRestored(() => save.promise);
  await s.session.openGeneration(projectA, generationOne);
  await s.session.complete(s.analysis.model.generateArtifact()!);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVING");
  save.resolve(storedGeneration(projectA, generationTwo));
  await s.saving;
  assert.equal(saveCount(s.calls), 1);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVED");
  assert.equal(s.session.getSnapshot().generationId, generationTwo);
});

test("a failed save survives a restore: returning keeps SAVE_FAILED and retry reuses the stored artifact", async () => {
  let fail = true;
  const s = await analyzedThenRestored(async (projectId, body) => {
    if (fail) throw new ProjectsClientError("SERVER_ERROR");
    return detailFrom(projectId, body, generationTwo);
  });
  await s.saving;
  const failedArtifact = s.session.getSnapshot().artifact;
  await s.session.openGeneration(projectA, generationOne);
  await s.session.complete(s.analysis.model.generateArtifact()!);
  assert.equal(saveCount(s.calls), 1, "returning never re-sends on its own");
  assert.equal(s.session.getSnapshot().saveStatus, "SAVE_FAILED");
  assert.equal(s.session.getSnapshot().artifact, failedArtifact, "same stored artifact");
  fail = false;
  await s.session.retrySave();
  assert.equal(saveCount(s.calls), 2);
  assert.equal(s.session.getSnapshot().saveStatus, "SAVED");
  assert.equal(s.analysis.counts.analyze, 1);
});

test("a new analysis result after a restore is saved normally", async () => {
  const s = await analyzedThenRestored();
  await s.saving;
  await s.session.openGeneration(projectA, generationOne);
  await s.session.complete(artifact({ fidelityMode: "FAST" }));
  assert.equal(saveCount(s.calls), 2);
  assert.equal(s.session.getSnapshot().origin, "GENERATED");
});

test("generator stays pure: no projects, auth, api or persistence imports", () => {
  // v2 is split into pure sibling modules; each one may import only contract types and its pure siblings.
  const importsOf = (file: string) => [...readFileSync(new URL("../src/features/generation/" + file, import.meta.url), "utf8")
    .matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(importsOf("generateReactProject.ts"),
    ["@vision2code/contracts", "./emitSource.ts", "./generatedProject.ts", "./layoutInference.ts", "./textLayout.ts"]);
  assert.deepEqual(importsOf("layoutInference.ts"), ["@vision2code/contracts"]);
  assert.deepEqual(importsOf("textLayout.ts"), ["@vision2code/contracts"]);
  assert.deepEqual(importsOf("emitSource.ts"), ["@vision2code/contracts", "./generatedProject.ts"]);
  assert.deepEqual(importsOf("generateReactProjectV1.ts"), ["@vision2code/contracts", "./emitSource.ts", "./generatedProject.ts"]);
});
