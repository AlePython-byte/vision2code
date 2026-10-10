import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as lucide from "lucide-react";
import ts from "typescript";
import { useLabels } from "../src/features/preferences/useLabels.ts";
import { es, en } from "../src/features/preferences/resources.ts";
import * as editorModule from "../src/features/editor/editorModel.ts";
import { createEditorModel, type EditorModel } from "../src/features/editor/editorModel.ts";
import type { GeneratedProject } from "../src/features/generation/generatedProject.ts";
import { createPreviewModel, type PreviewModel } from "../src/features/preview/previewModel.ts";
import { projectFromEditorState } from "../src/features/preview/previewInput.ts";
import * as previewDocument from "../src/features/preview/previewDocument.ts";
import * as previewTypes from "../src/features/preview/previewTypes.ts";
import type { PreviewEngine, PreviewProject, PreviewStatus } from "../src/features/preview/previewTypes.ts";

function project(): GeneratedProject {
  return { target: "react-tailwind", generatorVersion: "1", files: [
    { path: "src/App.tsx", content: "export default function App() {}", language: "typescript" },
    { path: "src/generated/GeneratedInterface.tsx", content: "export default function GeneratedInterface() {}", language: "typescript" },
  ] };
}

function deferredEngine() {
  const calls: { project: PreviewProject; signal: AbortSignal; resolve: () => void; reject: (error: unknown) => void }[] = [];
  const engine: PreviewEngine = {
    kind: "placeholder",
    render(input, signal) {
      return new Promise<void>((resolve, reject) => { calls.push({ project: input, signal, resolve, reject }); });
    },
  };
  return { engine, calls };
}

const require = createRequire(import.meta.url);
function loadComponent<T>(file: string, name: string, shims: Record<string, unknown>): T {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(compiled, { exports, require: (id: string) => id in shims ? shims[id] : require(id) });
  return exports[name] as T;
}
const PreviewPanel = loadComponent<ComponentType<{ model: PreviewModel }>>("../src/features/preview/PreviewPanel.tsx", "PreviewPanel", {
  "lucide-react": lucide,
  "../preferences/useLabels": { useLabels },
  "./previewDocument": previewDocument,
  "./previewTypes": previewTypes,
});
const EditorWorkspace = loadComponent<ComponentType<{ model: EditorModel; preview?: ReactNode }>>("../src/features/editor/EditorWorkspace.tsx", "EditorWorkspace", {
  "lucide-react": lucide,
  "../preferences/useLabels": { useLabels },
  "./editorModel": editorModule,
  "./FileExplorer": { FileExplorer: () => createElement("aside", { className: "file-explorer" }) },
  "./CodeEditor": { default: () => null },
});

test("preview starts EMPTY with no project, no error and the placeholder engine", () => {
  const state = createPreviewModel().getSnapshot();
  assert.equal(state.status, "EMPTY");
  assert.equal(state.project, null);
  assert.equal(state.error, null);
  assert.equal(state.engine, "placeholder");
});

test("accepting a GeneratedProject moves EMPTY to READY with a detached frozen snapshot", () => {
  const model = createPreviewModel();
  const input = project();
  model.setProject(input);
  const state = model.getSnapshot();
  assert.equal(state.status, "READY");
  assert.deepEqual(state.project, input);
  assert.notEqual(state.project, input);
  assert.ok(Object.isFrozen(state.project));
  assert.ok(Object.isFrozen(state.project!.files));
  assert.ok(Object.isFrozen(state.project!.files[0]));
  input.files[0]!.content = "mutated afterwards";
  input.files.push({ path: "extra.tsx", content: "", language: "typescript" });
  assert.equal(model.getSnapshot().project!.files.length, 2);
  assert.equal(model.getSnapshot().project!.files[0]!.content, "export default function App() {}");
  assert.throws(() => { (state.project!.files[0] as { content: string }).content = "x"; }, TypeError);
});

test("render walks READY, RENDERING, SUCCESS deterministically and notifies once per transition", async () => {
  const { engine, calls } = deferredEngine();
  const model = createPreviewModel(engine);
  const seen: PreviewStatus[] = [];
  model.subscribe(() => seen.push(model.getSnapshot().status));
  model.setProject(project());
  const pending = model.render();
  assert.equal(model.getSnapshot().status, "RENDERING");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.project, model.getSnapshot().project);
  calls[0]!.resolve();
  await pending;
  assert.equal(model.getSnapshot().status, "SUCCESS");
  assert.deepEqual(seen, ["READY", "RENDERING", "SUCCESS"]);
});

test("the default placeholder engine reaches SUCCESS and can render again", async () => {
  const model = createPreviewModel();
  model.setProject(project());
  await model.render();
  assert.equal(model.getSnapshot().status, "SUCCESS");
  await model.render();
  assert.equal(model.getSnapshot().status, "SUCCESS");
});

test("engine failure becomes a stable ERROR code without leaking the raw error, and retry recovers", async () => {
  const { engine, calls } = deferredEngine();
  const model = createPreviewModel(engine);
  model.setProject(project());
  const first = model.render();
  calls[0]!.reject(new Error("PRIVATE C:\\secret\\path"));
  await first;
  const state = model.getSnapshot();
  assert.equal(state.status, "ERROR");
  assert.equal(state.error, "ENGINE_FAILURE");
  assert.doesNotMatch(JSON.stringify(state), /PRIVATE|secret/);
  const retry = model.render();
  assert.equal(model.getSnapshot().status, "RENDERING");
  assert.equal(model.getSnapshot().error, null);
  calls[1]!.resolve();
  await retry;
  assert.equal(model.getSnapshot().status, "SUCCESS");
});

test("a project without src/App.tsx is a NO_ENTRY error and render never calls the engine", async () => {
  const { engine, calls } = deferredEngine();
  const model = createPreviewModel(engine);
  const input = project();
  input.files = input.files.filter((file) => file.path !== "src/App.tsx");
  model.setProject(input);
  assert.equal(model.getSnapshot().status, "ERROR");
  assert.equal(model.getSnapshot().error, "NO_ENTRY");
  await model.render();
  assert.equal(calls.length, 0);
  assert.equal(model.getSnapshot().status, "ERROR");
});

test("render without a project is a no-op", async () => {
  const { engine, calls } = deferredEngine();
  const model = createPreviewModel(engine);
  await model.render();
  assert.equal(calls.length, 0);
  assert.equal(model.getSnapshot().status, "EMPTY");
});

test("replacing the project aborts in-flight work and ignores its late result", async () => {
  const { engine, calls } = deferredEngine();
  const model = createPreviewModel(engine);
  model.setProject(project());
  const stale = model.render();
  const next = project();
  next.files[0]!.content = "second project";
  model.setProject(next);
  assert.equal(calls[0]!.signal.aborted, true);
  assert.equal(model.getSnapshot().status, "READY");
  calls[0]!.resolve();
  await stale;
  assert.equal(model.getSnapshot().status, "READY");
  assert.equal(model.getSnapshot().project!.files[0]!.content, "second project");
});

test("a newer render supersedes an older one even if the older settles last", async () => {
  const { engine, calls } = deferredEngine();
  const model = createPreviewModel(engine);
  model.setProject(project());
  const older = model.render();
  const newer = model.render();
  assert.equal(calls[0]!.signal.aborted, true);
  calls[1]!.resolve();
  await newer;
  assert.equal(model.getSnapshot().status, "SUCCESS");
  calls[0]!.reject(new Error("late"));
  await older;
  assert.equal(model.getSnapshot().status, "SUCCESS");
  assert.equal(model.getSnapshot().error, null);
});

test("clearing returns to EMPTY, aborts rendering and ignores a late completion", async () => {
  const { engine, calls } = deferredEngine();
  const model = createPreviewModel(engine);
  model.setProject(project());
  const pending = model.render();
  model.clear();
  assert.equal(calls[0]!.signal.aborted, true);
  assert.equal(model.getSnapshot().status, "EMPTY");
  assert.equal(model.getSnapshot().project, null);
  calls[0]!.resolve();
  await pending;
  assert.equal(model.getSnapshot().status, "EMPTY");
  model.setProject(project());
  model.setProject(null);
  assert.equal(model.getSnapshot().status, "EMPTY");
});

test("unsubscribed and disposed listeners are no longer notified", () => {
  const model = createPreviewModel();
  let calls = 0;
  const unsubscribe = model.subscribe(() => { calls++; });
  model.setProject(project());
  unsubscribe();
  model.clear();
  assert.equal(calls, 1);
  model.subscribe(() => { calls++; });
  model.dispose();
  model.setProject(project());
  assert.equal(calls, 1);
});

test("the preview never mutates the input project or the editor state", async () => {
  const input = project();
  const before = structuredClone(input);
  const editor = createEditorModel();
  editor.setProject(input);
  editor.edit("draft code");
  const editorBefore = { ...editor.getSnapshot(), drafts: new Map(editor.getSnapshot().drafts) };
  const model = createPreviewModel();
  model.setProject(input);
  await model.render();
  model.clear();
  model.setProject(projectFromEditorState(editor.getSnapshot()));
  await model.render();
  assert.deepEqual(input, before);
  const editorAfter = editor.getSnapshot();
  assert.equal(editorAfter.project!.files[0]!.content, before.files[0]!.content);
  assert.deepEqual(editorAfter.files, editorBefore.files);
  assert.deepEqual([...editorAfter.drafts], [...editorBefore.drafts]);
  assert.equal(editorAfter.activePath, editorBefore.activePath);
});

test("projectFromEditorState overlays drafts, preserves the original and returns null when empty", () => {
  const editor = createEditorModel();
  assert.equal(projectFromEditorState(editor.getSnapshot()), null);
  editor.setProject(project());
  editor.select("src/App.tsx");
  editor.edit("edited app");
  const result = projectFromEditorState(editor.getSnapshot())!;
  assert.equal(result.files.find((file) => file.path === "src/App.tsx")!.content, "edited app");
  assert.equal(result.files.find((file) => file.path === "src/generated/GeneratedInterface.tsx")!.content, project().files[1]!.content);
  assert.equal(editor.getSnapshot().project!.files.find((file) => file.path === "src/App.tsx")!.content, project().files[0]!.content);
});

test("the preview model performs no network or AI calls", async () => {
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (() => { fetches++; return Promise.reject(new Error("network forbidden")); }) as typeof fetch;
  try {
    const model = createPreviewModel();
    model.setProject(project());
    await model.render();
    model.setProject(project());
    await model.render();
    model.clear();
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fetches, 0);
});

test("preview sources have no network, AI, Tauri or dynamic-evaluation dependencies", () => {
  const directory = new URL("../src/features/preview/", import.meta.url);
  const forbidden = /fetch\(|XMLHttpRequest|WebSocket|@tauri-apps|@vision2code\/contracts|analysisClient|useAnalysis|openai|\beval\(|new Function|dangerouslySetInnerHTML|allow-same-origin/i;
  const files = readdirSync(directory).filter((name) => /\.(ts|tsx)$/.test(name));
  assert.ok(files.length >= 5);
  for (const name of files) {
    const source = readFileSync(new URL(name, directory), "utf8");
    assert.doesNotMatch(source, forbidden, name);
  }
});

function render(model: PreviewModel) { return renderToStaticMarkup(createElement(PreviewPanel, { model })); }

test("the panel renders safe EMPTY and READY states in Spanish", () => {
  const model = createPreviewModel();
  const empty = render(model);
  assert.match(empty, /Vista previa en vivo/);
  assert.match(empty, /Todavía no hay vista previa/);
  assert.match(empty, /data-status="EMPTY"/);
  assert.doesNotMatch(empty, /<iframe/);
  assert.match(empty, /<button[^>]*disabled/);
  model.setProject(project());
  const ready = render(model);
  assert.match(ready, /data-status="READY"/);
  assert.match(ready, /Preparar vista previa/);
  assert.doesNotMatch(ready, /<button[^>]*disabled/);
});

test("the panel renders RENDERING with a busy stage and a disabled action", () => {
  const { engine } = deferredEngine();
  const model = createPreviewModel(engine);
  model.setProject(project());
  void model.render();
  const html = render(model);
  assert.match(html, /data-status="RENDERING"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Preparando la vista previa aislada/);
  assert.match(html, /<button[^>]*disabled/);
});

test("the SUCCESS surface is a fully sandboxed frame with static content only", async () => {
  const model = createPreviewModel();
  model.setProject(project());
  await model.render();
  const html = render(model);
  assert.match(html, /data-status="SUCCESS"/);
  assert.match(html, /<iframe[^>]*sandbox=""/);
  assert.doesNotMatch(html, /allow-scripts|allow-same-origin|allow-top-navigation|allow-popups|allow-forms/);
  assert.match(html, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i);
  assert.doesNotMatch(previewDocument.PREVIEW_PLACEHOLDER_DOCUMENT, /<script|on\w+=|src=|href=/i);
  assert.equal(previewDocument.PREVIEW_SANDBOX, "");
  assert.doesNotMatch(html, /export default function/);
  assert.match(html, /Superficie aislada reservada/);
});

test("the panel shows distinct accessible ERROR messages and only offers retry when possible", async () => {
  const failing: PreviewEngine = { kind: "placeholder", async render() { throw new Error("boom"); } };
  const model = createPreviewModel(failing);
  model.setProject(project());
  await model.render();
  const engineError = render(model);
  assert.match(engineError, /role="alert"/);
  assert.match(engineError, /No se pudo preparar la vista previa/);
  assert.match(engineError, /Reintentar/);
  assert.doesNotMatch(engineError, /boom/);
  const input = project();
  input.files = [];
  model.setProject(input);
  const noEntry = render(model);
  assert.match(noEntry, /src\/App\.tsx/);
  assert.match(noEntry, /<button[^>]*disabled/);
});

test("the code workspace hosts the preview beside the editor and still works without it", () => {
  const editor = createEditorModel();
  const preview = createElement("section", { className: "preview-marker" });
  const split = renderToStaticMarkup(createElement(EditorWorkspace, { model: editor, preview }));
  assert.match(split, /class="editor-split"/);
  assert.match(split, /preview-marker/);
  assert.match(split, /class="editor-grid"/);
  assert.match(split, /class="file-explorer"/);
  assert.ok(split.indexOf("preview-marker") < split.indexOf("editor-grid"));
  const solo = renderToStaticMarkup(createElement(EditorWorkspace, { model: editor }));
  assert.doesNotMatch(solo, /editor-split/);
  assert.match(solo, /class="editor-grid"/);
});

test("preview labels exist in both languages for every status", () => {
  const statuses: PreviewStatus[] = ["EMPTY", "READY", "RENDERING", "SUCCESS", "ERROR"];
  for (const status of statuses) {
    const key = `previewStatus${status}` as keyof typeof es;
    assert.ok(es[key], key);
    assert.ok(en[key], key);
  }
});

