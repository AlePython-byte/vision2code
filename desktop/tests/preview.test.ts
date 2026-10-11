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
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createPreviewModel, type PreviewModel } from "../src/features/preview/previewModel.ts";
import { createPlaceholderPreviewEngine, createLocalIsolatedPreviewEngine } from "../src/features/preview/previewEngine.ts";
import { projectFromEditorState } from "../src/features/preview/previewInput.ts";
import * as previewDocument from "../src/features/preview/previewDocument.ts";
import { PREVIEW_RUNTIME_SOURCE } from "../src/features/preview/runtime/previewRuntime.ts";
import * as previewTypes from "../src/features/preview/previewTypes.ts";
import type { PreviewEngine, PreviewProject, PreviewStatus } from "../src/features/preview/previewTypes.ts";
import type { UISchema } from "@vision2code/contracts";
import {
  normalizeModulePath,
  resolveRelativeSpecifier,
  getCandidateModuleIds,
  resolveModuleId,
} from "../src/features/preview/previewResolver.ts";
import { calculateFitScale } from "../src/features/preview/previewFit.ts";

function project(): GeneratedProject {
  return { target: "react-tailwind", generatorVersion: "1", files: [
    { path: "src/App.tsx", content: "import GeneratedInterface from './generated/GeneratedInterface';\nexport default function App() { return <GeneratedInterface />; }", language: "typescript" },
    { path: "src/generated/GeneratedInterface.tsx", content: "export default function GeneratedInterface() { return <div data-node-id=\"root\" className=\"box-border min-w-0 flex [padding:16px_24px] [background-color:#ffffff]\"><span className=\"text-xs [color:#0f172a]\">Interfaz de prueba</span></div>; }", language: "typescript" },
  ] };
}

const simpleInterfaceFixture = JSON.parse(
  readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8")
) as UISchema;

function deferredEngine() {
  const calls: { project: PreviewProject; signal: AbortSignal; resolve: (res?: any) => void; reject: (error: unknown) => void }[] = [];
  const engine: PreviewEngine = {
    kind: "placeholder",
    render(input, signal) {
      return new Promise((resolve, reject) => { calls.push({ project: input, signal, resolve, reject }); });
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

test("preview starts EMPTY with default local-isolated engine or injected placeholder engine", () => {
  const defaultState = createPreviewModel().getSnapshot();
  assert.equal(defaultState.status, "EMPTY");
  assert.equal(defaultState.project, null);
  assert.equal(defaultState.error, null);
  assert.equal(defaultState.engine, "local-isolated");
  assert.equal(defaultState.documentHtml, null);

  const placeholderState = createPreviewModel(createPlaceholderPreviewEngine()).getSnapshot();
  assert.equal(placeholderState.status, "EMPTY");
  assert.equal(placeholderState.engine, "placeholder");
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
  assert.match(model.getSnapshot().project!.files[0]!.content, /GeneratedInterface/);
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

test("the default local-isolated engine renders a valid deterministic project to SUCCESS", async () => {
  const model = createPreviewModel();
  const deterministicProject = generateReactProject(simpleInterfaceFixture);
  model.setProject(deterministicProject);
  assert.equal(model.getSnapshot().status, "READY");

  await model.render();
  const state = model.getSnapshot();
  assert.equal(state.status, "SUCCESS");
  assert.equal(state.error, null);
  assert.ok(state.documentHtml);
  assert.match(state.documentHtml, /Mi espacio/);
});

test("the rendered document contains local Tailwind utility CSS matching project classes", async () => {
  const model = createPreviewModel();
  const deterministicProject = generateReactProject(simpleInterfaceFixture);
  model.setProject(deterministicProject);
  await model.render();

  const doc = model.getSnapshot().documentHtml!;
  assert.ok(doc);
  // Contains preflight CSS
  assert.match(doc, /box-sizing:\s*border-box/);
  // Contains arbitrary Tailwind classes extracted from the project
  assert.match(doc, /background-color:\s*#f6f5f0/);
  assert.match(doc, /color:\s*#20211f/);
  assert.match(doc, /display:\s*flex/);
  assert.match(doc, /font-size:\s*24px/);
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

test("malformed TSX produces ERROR and does not crash the model or application", async () => {
  const model = createPreviewModel(createLocalIsolatedPreviewEngine());
  const brokenProject: GeneratedProject = {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      { path: "src/App.tsx", content: "export default function App() { return <div broken syntax", language: "typescript" },
    ],
  };
  model.setProject(brokenProject);
  await model.render();
  const state = model.getSnapshot();
  assert.equal(state.status, "ERROR");
  assert.equal(state.error, "ENGINE_FAILURE");
  assert.equal(state.documentHtml, null);
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

test("the SUCCESS surface is an isolated frame with sandbox allow-scripts and restrictive CSP", async () => {
  const model = createPreviewModel();
  model.setProject(project());
  await model.render();
  const html = render(model);
  assert.match(html, /data-status="SUCCESS"/);
  assert.match(html, /<iframe[^>]*sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/);
  assert.match(html, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i);
  assert.equal(previewDocument.PREVIEW_SANDBOX, "allow-scripts");
  assert.match(previewDocument.PREVIEW_IFRAME_CSP, /default-src 'none'/);
  assert.match(previewDocument.PREVIEW_IFRAME_CSP, /connect-src 'none'/);
  assert.match(previewDocument.PREVIEW_IFRAME_CSP, /base-uri 'none'/);
});

test("security test: preview document strictly contains zero forbidden tokens", async () => {
  const model = createPreviewModel();
  const deterministicProject = generateReactProject(simpleInterfaceFixture);
  model.setProject(deterministicProject);
  await model.render();

  const doc = model.getSnapshot().documentHtml!;
  assert.ok(doc, "documentHtml must be generated");

  // Critical security assertions
  assert.doesNotMatch(doc, /http:\/\//i, "Must not contain http://");
  assert.doesNotMatch(doc, /https:\/\//i, "Must not contain https://");
  assert.doesNotMatch(doc, /__TAURI__/i, "Must not contain __TAURI__");
  assert.doesNotMatch(doc, /invoke\(/i, "Must not contain invoke(");
  assert.doesNotMatch(doc, /fetch\(/i, "Must not contain fetch(");
  assert.doesNotMatch(doc, /XMLHttpRequest/i, "Must not contain XMLHttpRequest");
  assert.doesNotMatch(doc, /WebSocket/i, "Must not contain WebSocket");
  assert.doesNotMatch(doc, /allow-same-origin/i, "Must not contain allow-same-origin");
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

test("preview labels exist in both languages for every status and engine kind", () => {
  const statuses: PreviewStatus[] = ["EMPTY", "READY", "RENDERING", "SUCCESS", "ERROR"];
  for (const status of statuses) {
    const key = `previewStatus${status}` as keyof typeof es;
    assert.ok(es[key], key);
    assert.ok(en[key], key);
  }
  assert.ok(es.previewEngineLocal);
  assert.ok(en.previewEngineLocal);
});

test("generator compatibility: all 7 node types (FRAME, TEXT, IMAGE, ICON, BUTTON, INPUT, DIVIDER) compile and prepare cleanly", async () => {
  const fullSchema: UISchema = structuredClone(simpleInterfaceFixture);
  fullSchema.root.children = [
    {
      id: "node-text",
      type: "TEXT",
      name: "LabelText",
      bounds: { x: 0, y: 0, width: 200, height: 24 },
      layout: { mode: "NONE", direction: "NONE", justify: "START", align: "START", gap: null, columns: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      style: { background: null, color: "#1e293b", border: null, radius: null, shadow: null, opacity: 1 },
      text: { content: "Texto visible", fontFamily: "Inter", fontSize: 16, fontWeight: 500, lineHeight: 24, letterSpacing: 0, textAlign: "START" },
      image: null,
      children: [],
    },
    {
      id: "node-btn",
      type: "BUTTON",
      name: "PrimaryButton",
      bounds: { x: 0, y: 32, width: 140, height: 40 },
      layout: { mode: "NONE", direction: "NONE", justify: "CENTER", align: "CENTER", gap: null, columns: null, padding: { top: 8, right: 16, bottom: 8, left: 16 } },
      style: { background: "#7662F5", color: "#ffffff", border: null, radius: 8, shadow: null, opacity: 1 },
      text: { content: "Pulsar botón", fontFamily: null, fontSize: 14, fontWeight: 600, lineHeight: 20, letterSpacing: null, textAlign: "CENTER" },
      image: null,
      children: [],
    },
    {
      id: "node-input",
      type: "INPUT",
      name: "SingleInput",
      bounds: { x: 0, y: 80, width: 260, height: 40 },
      layout: { mode: "NONE", direction: "NONE", justify: "START", align: "START", gap: null, columns: null, padding: { top: 8, right: 12, bottom: 8, left: 12 } },
      style: { background: "#ffffff", color: "#000000", border: { width: 1, color: "#cbd5e1" }, radius: 6, shadow: null, opacity: 1 },
      text: { content: "Valor de entrada", fontFamily: null, fontSize: 14, fontWeight: null, lineHeight: null, letterSpacing: null, textAlign: "START" },
      image: null,
      children: [],
    },
    {
      id: "node-textarea",
      type: "INPUT",
      name: "MultilineInput",
      bounds: { x: 0, y: 130, width: 260, height: 80 },
      layout: { mode: "NONE", direction: "NONE", justify: "START", align: "START", gap: null, columns: null, padding: { top: 8, right: 12, bottom: 8, left: 12 } },
      style: { background: "#ffffff", color: "#000000", border: { width: 1, color: "#cbd5e1" }, radius: 6, shadow: null, opacity: 1 },
      text: { content: "Línea 1\nLínea 2", fontFamily: null, fontSize: 14, fontWeight: null, lineHeight: null, letterSpacing: null, textAlign: "START" },
      image: null,
      children: [],
    },
    {
      id: "node-img",
      type: "IMAGE",
      name: "ScreenshotImage",
      bounds: { x: 0, y: 220, width: 200, height: 120 },
      layout: { mode: "NONE", direction: "NONE", justify: "START", align: "START", gap: null, columns: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      style: { background: null, color: "#64748b", border: null, radius: 4, shadow: null, opacity: 1 },
      text: null,
      image: { description: "Captura de pantalla ilustrativa", fit: "CONTAIN" },
      children: [],
    },
    {
      id: "node-icon",
      type: "ICON",
      name: "NavigationIcon",
      bounds: { x: 0, y: 350, width: 24, height: 24 },
      layout: { mode: "NONE", direction: "NONE", justify: "START", align: "START", gap: null, columns: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      style: { background: null, color: "#7662F5", border: null, radius: null, shadow: null, opacity: 1 },
      text: null,
      image: { description: "Icono de navegación", fit: "CONTAIN" },
      children: [],
    },
    {
      id: "node-hr",
      type: "DIVIDER",
      name: "SectionDivider",
      bounds: { x: 0, y: 380, width: 260, height: 1 },
      layout: { mode: "NONE", direction: "NONE", justify: "START", align: "START", gap: null, columns: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      style: { background: null, color: "#e2e8f0", border: null, radius: null, shadow: null, opacity: 1 },
      text: { content: "Separador", fontFamily: null, fontSize: 11, fontWeight: null, lineHeight: null, letterSpacing: null, textAlign: "CENTER" },
      image: null,
      children: [],
    },
  ];

  const fullProject = generateReactProject(fullSchema);
  const model = createPreviewModel();
  model.setProject(fullProject);
  await model.render();

  const state = model.getSnapshot();
  assert.equal(state.status, "SUCCESS");
  assert.equal(state.error, null);
  const html = state.documentHtml!;
  assert.ok(html);

  // All 7 node elements and their text/attributes are properly generated
  assert.match(html, /Texto visible/);
  assert.match(html, /Pulsar bot[oó]n/);
  assert.match(html, /Valor de entrada/);
  assert.match(html, /Línea 1/);
  assert.match(html, /Captura de pantalla ilustrativa/);
  assert.match(html, /Icono de navegaci[oó]n/);
  assert.match(html, /Separador/);
});

test("CSS parser safety: malformed and hostile arbitrary properties fail safely and do not escape declarations", async () => {
  const hostileProject: GeneratedProject = {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      {
        path: "src/App.tsx",
        content: `export default function App() {
          return (
            <div className="[color:red}body{background:red}] [color:red</style><script>] [color:blue;content:'inject'] [color:green]">
              Test
            </div>
          );
        }`,
        language: "typescript",
      },
    ],
  };

  const model = createPreviewModel();
  model.setProject(hostileProject);
  await model.render();

  const doc = model.getSnapshot().documentHtml!;
  assert.ok(doc);
  const css = doc.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  // Malformed breakout attempts must NOT be emitted into stylesheet
  assert.doesNotMatch(css, /body\s*\{\s*background:\s*red/);
  assert.doesNotMatch(css, /content:\s*'inject'/);
  assert.doesNotMatch(css, /<\/style><script>/);
  // Valid arbitrary property is preserved
  assert.match(css, /color:\s*green/);
});

test("runtime sandbox probe: preview environment isolates dangerous host capabilities", () => {
  // Execute the runtime source inside an isolated VM sandbox simulating the iframe
  const sandbox: Record<string, any> = {
    window: {},
    document: {
      createElement: () => ({ setAttribute() {}, appendChild() {} }),
      createTextNode: () => ({}),
      getElementById: () => ({ innerHTML: "", appendChild() {} }),
    },
    console: { error() {}, log() {} },
  };
  sandbox.window = sandbox;

  // Run the preview runtime initialization
  runInNewContext(PREVIEW_RUNTIME_SOURCE, sandbox);

  // Assert dangerous host globals are completely undefined in the preview context
  assert.equal(sandbox.window.__TAURI__, undefined, "__TAURI__ must be undefined");
  assert.equal(sandbox.window.__TAURI_INTERNALS__, undefined, "__TAURI_INTERNALS__ must be undefined");
  assert.equal(sandbox.window.invoke, undefined, "invoke must be undefined");
  assert.equal(sandbox.window.fetch, undefined, "fetch must be undefined");
  assert.equal(sandbox.window.XMLHttpRequest, undefined, "XMLHttpRequest must be undefined");
  assert.equal(sandbox.window.WebSocket, undefined, "WebSocket must be undefined");
});

function executePreviewHtmlInSandbox(documentHtml: string) {
  const scripts = [...documentHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((s): s is string => typeof s === "string");
  const rootEl: { innerHTML: string; children: any[]; appendChild: (c: any) => void; firstElementChild?: any } = {
    innerHTML: "",
    children: [],
    appendChild(c: any) {
      this.children.push(c);
      if (!this.firstElementChild) this.firstElementChild = c;
    },
  };
  const stageEl: { style: Record<string, string>; clientWidth: number; clientHeight: number } = {
    style: {},
    clientWidth: 800,
    clientHeight: 600,
  };
  const shellEl: { style: Record<string, string> } = { style: {} };
  const canvasEl: { style: Record<string, string> } = { style: {} };
  const doc = {
    getElementById: (id: string) => {
      if (id === "root") return rootEl;
      if (id === "preview-stage") return stageEl;
      if (id === "preview-viewport-shell") return shellEl;
      if (id === "preview-scaled-canvas") return canvasEl;
      return null;
    },
    createElement: (tag: string) => ({
      tagName: tag,
      style: {},
      setAttribute(k: string, v: string) { (this as any)[k] = v; },
      appendChild(c: any) { ((this as any).children = (this as any).children || []).push(c); },
      children: [] as any[],
    }),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
    createDocumentFragment: () => ({
      children: [] as any[],
      appendChild(c: any) { this.children.push(c); },
    }),
  };
  const sandbox: Record<string, any> = {
    window: {},
    document: doc,
    console: { error() {}, log() {}, warn() {} },
    getComputedStyle: (el: any) => ({
      maxWidth: el?.style?.maxWidth || "1440px",
      minHeight: el?.style?.minHeight || "1024px",
    }),
    innerWidth: 800,
    innerHeight: 600,
  };
  sandbox.window = sandbox;

  for (const script of scripts) {
    runInNewContext(script, sandbox);
  }

  return { rootEl, stageEl, shellEl, canvasEl, sandbox };
}

test("module resolution: relative specifier and candidates order", () => {
  const rel = resolveRelativeSpecifier("src/App.tsx", "./generated/GeneratedInterface");
  assert.equal(rel, "src/generated/GeneratedInterface");
  const candidates = getCandidateModuleIds(rel);
  assert.equal(candidates[0], "src/generated/GeneratedInterface");
  assert.equal(candidates[1], "src/generated/GeneratedInterface.ts");
  assert.equal(candidates[2], "src/generated/GeneratedInterface.tsx");
});

test("module resolution: src/App.tsx imports ./generated/GeneratedInterface without extension", () => {
  const registered = ["src/App.tsx", "src/generated/GeneratedInterface.tsx"];
  const resolved = resolveModuleId("src/App.tsx", "./generated/GeneratedInterface", registered);
  assert.equal(resolved, "src/generated/GeneratedInterface.tsx");
});

test("module resolution: supports explicit extension ./generated/GeneratedInterface.tsx", () => {
  const registered = ["src/App.tsx", "src/generated/GeneratedInterface.tsx"];
  const resolved = resolveModuleId("src/App.tsx", "./generated/GeneratedInterface.tsx", registered);
  assert.equal(resolved, "src/generated/GeneratedInterface.tsx");
});

test("module resolution: supports nested relative import ../shared/Component", () => {
  const registered = ["src/components/Card.tsx", "src/shared/Component.tsx"];
  const resolved = resolveModuleId("src/components/Card.tsx", "../shared/Component", registered);
  assert.equal(resolved, "src/shared/Component.tsx");
});

test("module resolution: missing module produces bounded error", () => {
  const registered = ["src/App.tsx"];
  assert.throws(
    () => resolveModuleId("src/App.tsx", "./missing/DoesNotExist", registered),
    (err: unknown) => err instanceof Error && err.message.includes("Module not found: ./missing/DoesNotExist"),
  );
});

test("module resolution: path traversal outside virtual root is rejected", () => {
  const registered = ["src/App.tsx"];
  assert.throws(
    () => resolveModuleId("src/App.tsx", "../../outside/Secret", registered),
    (err: unknown) => err instanceof Error && err.message.includes("Path traversal outside project root: ../../outside/Secret"),
  );
  assert.throws(
    () => normalizeModulePath("../../outside.tsx"),
    (err: unknown) => err instanceof Error && err.message.includes("Path traversal outside project root: ../../outside.tsx"),
  );
});

test("module resolution: directory index file candidate resolution", () => {
  const registered = ["src/App.tsx", "src/components/Button/index.tsx"];
  const resolved = resolveModuleId("src/App.tsx", "./components/Button", registered);
  assert.equal(resolved, "src/components/Button/index.tsx");
});

test("real regression test: representative GeneratedProject with ./generated/GeneratedInterface runs through complete PreviewEngine", async () => {
  const engine = createLocalIsolatedPreviewEngine();
  const representativeProject: GeneratedProject = {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      {
        path: "src/App.tsx",
        language: "typescript",
        content: `import GeneratedInterface from "./generated/GeneratedInterface";
export default function App() {
  return <GeneratedInterface />;
}`,
      },
      {
        path: "src/generated/GeneratedInterface.tsx",
        language: "typescript",
        content: `export default function GeneratedInterface() {
  return <div id="generated-root"><span>Contenido de interfaz generada</span></div>;
}`,
      },
    ],
  };

  const result = await engine.render(representativeProject, new AbortController().signal);
  assert.ok(result && typeof result === "object" && "documentHtml" in result, "Must produce documentHtml");

  // Execute in isolated DOM sandbox exactly as the browser iframe does
  const { rootEl } = executePreviewHtmlInSandbox(result.documentHtml);

  // Must NOT render execution error banner
  assert.doesNotMatch(rootEl.innerHTML, /Error de ejecuci[oó]n/);
  assert.doesNotMatch(rootEl.innerHTML, /Module not found/);

  // Must render the interface with generated visible text surviving module resolution
  assert.equal(rootEl.children.length, 1);
  assert.equal(rootEl.children[0]?.tagName, "div");
  const childSpan = rootEl.children[0]?.children?.[0];
  assert.equal(childSpan?.tagName, "span");
  assert.equal(childSpan?.children?.[0]?.textContent, "Contenido de interfaz generada");
});

test("deterministic GeneratedProject: full output compiles and renders visible text through module graph", async () => {
  const deterministicProject = generateReactProject(simpleInterfaceFixture);
  const engine = createLocalIsolatedPreviewEngine();
  const result = await engine.render(deterministicProject, new AbortController().signal);
  assert.ok(result && typeof result === "object" && "documentHtml" in result);

  const { rootEl } = executePreviewHtmlInSandbox(result.documentHtml);
  assert.doesNotMatch(rootEl.innerHTML, /Error de ejecuci[oó]n/);
  assert.equal(rootEl.children.length, 1);
});

test("fit-to-viewport: scale calculation when content is larger than viewport", () => {
  const result = calculateFitScale({
    contentWidth: 1440,
    contentHeight: 1024,
    availableWidth: 800,
    availableHeight: 600,
    padding: 16,
  });

  // Available effective width: 768, height: 568
  // Scale should be min(768/1440, 568/1024) = min(0.5333, 0.5546) = 0.5333...
  assert.ok(result.scale < 1, "Scale must be less than 1 when content exceeds viewport");
  assert.ok(result.scale > 0.52 && result.scale < 0.54, `Scale ${result.scale} must match aspect ratio calculation`);
  assert.equal(result.scaledWidth, 768);
});

test("fit-to-viewport: scale never exceeds 1 in FIT mode", () => {
  const result = calculateFitScale({
    contentWidth: 400,
    contentHeight: 300,
    availableWidth: 1200,
    availableHeight: 900,
  });

  assert.equal(result.scale, 1, "FIT mode scale must never exceed 1");
  assert.equal(result.scaledWidth, 400);
  assert.equal(result.scaledHeight, 300);
});

test("fit-to-viewport: aspect ratio strictly preserved", () => {
  const contentWidth = 1440;
  const contentHeight = 1024;
  const result = calculateFitScale({
    contentWidth,
    contentHeight,
    availableWidth: 600,
    availableHeight: 700,
  });

  const originalAspectRatio = contentWidth / contentHeight;
  const scaledAspectRatio = result.scaledWidth / result.scaledHeight;
  const ratioDifference = Math.abs(originalAspectRatio - scaledAspectRatio);
  assert.ok(ratioDifference < 0.01, `Aspect ratio difference ${ratioDifference} must be negligible`);
});

test("fit-to-viewport: smaller generated interfaces are not unnecessarily enlarged", () => {
  const result = calculateFitScale({
    contentWidth: 320,
    contentHeight: 240,
    availableWidth: 1920,
    availableHeight: 1080,
  });

  assert.equal(result.scale, 1);
  assert.equal(result.scaledWidth, 320);
  assert.equal(result.scaledHeight, 240);
});

test("fit-to-viewport: resize causes recalculation", () => {
  const initial = calculateFitScale({
    contentWidth: 1440,
    contentHeight: 1024,
    availableWidth: 1200,
    availableHeight: 900,
  });

  const resizedNarrow = calculateFitScale({
    contentWidth: 1440,
    contentHeight: 1024,
    availableWidth: 600,
    availableHeight: 900,
  });

  assert.ok(resizedNarrow.scale < initial.scale, "Scale must decrease when viewport narrows");
  assert.ok(resizedNarrow.scaledWidth < initial.scaledWidth);
});

test("fit-to-viewport: graceful handling of zero or negative dimensions", () => {
  const result = calculateFitScale({
    contentWidth: 0,
    contentHeight: 0,
    availableWidth: 800,
    availableHeight: 600,
  });

  assert.equal(result.scale, 1);
  assert.equal(result.scaledWidth, 0);
  assert.equal(result.scaledHeight, 0);
});

test("fit-to-viewport: preview HTML contains stage, shell, canvas containers and neutral background", () => {
  const doc = previewDocument.buildPreviewDocument({
    css: "/* test styles */",
    script: "// test script",
  });

  assert.ok(doc.includes('id="preview-stage"'), "Must contain preview-stage container");
  assert.ok(doc.includes('id="preview-viewport-shell"'), "Must contain preview-viewport-shell container");
  assert.ok(doc.includes('id="preview-scaled-canvas"'), "Must contain preview-scaled-canvas container");
  assert.ok(doc.includes('id="root"'), "Must contain root mount point");
  assert.ok(doc.includes("background-color: #f1f5f9;"), "Must contain neutral stage background");
  assert.ok(doc.includes("transform-origin: 0 0;"), "Must set transform origin for scaling");
});

test("fit-to-viewport: runtime initializes fit scaling and updates dimensions", async () => {
  const representativeProject: GeneratedProject = {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      {
        path: "src/App.tsx",
        language: "typescript",
        content: `export default function App() {
  return <div style={{ width: "1440px", height: "1024px" }}>Test App</div>;
}`,
      },
    ],
  };

  const engine = createLocalIsolatedPreviewEngine();
  const result = await engine.render(representativeProject, new AbortController().signal);
  assert.ok(result && typeof result === "object" && "documentHtml" in result);

  const { sandbox, shellEl, canvasEl } = executePreviewHtmlInSandbox(result.documentHtml);
  assert.ok(typeof sandbox.window.__updateFit__ === "function", "Runtime must expose __updateFit__");
  assert.ok(typeof sandbox.window.__currentFitScale__ === "number", "Runtime must compute __currentFitScale__");
  assert.ok(sandbox.window.__currentFitScale__ <= 1, "Computed scale must not exceed 1");
  assert.ok(shellEl.style.width, "Shell must receive computed width");
  assert.ok(canvasEl.style.transform, "Canvas must receive scale transform");
});

test("fit-to-viewport: preview labels exist in both languages for mode and fit", () => {
  assert.equal(es.previewMode, "Modo");
  assert.equal(es.previewModeFit, "Ajustar al visor");
  assert.equal(en.previewMode, "Mode");
  assert.equal(en.previewModeFit, "Fit to viewport");
});
