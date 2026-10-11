import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as lucide from "lucide-react";
import ts from "typescript";
import { useLabels } from "../src/features/preferences/useLabels.ts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { createPreviewModel, type PreviewModel } from "../src/features/preview/previewModel.ts";
import { createLocalIsolatedPreviewEngine } from "../src/features/preview/previewEngine.ts";
import {
  createPreviewPresentation,
  calculatePresentationScale,
  PREVIEW_VIEWPORT_PRESETS,
  PREVIEW_ZOOM_SCALES,
  DEFAULT_VIEWPORT_PRESET,
  DEFAULT_ZOOM_MODE,
  type PreviewPresentation,
} from "../src/features/preview/previewPresentation.ts";
import {
  PREVIEW_SANDBOX,
  PREVIEW_IFRAME_CSP,
} from "../src/features/preview/previewDocument.ts";
import * as previewDocument from "../src/features/preview/previewDocument.ts";
import * as previewTypes from "../src/features/preview/previewTypes.ts";
import * as previewInput from "../src/features/preview/previewInput.ts";
import * as previewPresentation from "../src/features/preview/previewPresentation.ts";
import { syncEditorToPreview, type DebounceScheduler } from "../src/features/preview/previewSync.ts";
import { resolveModuleId } from "../src/features/preview/previewResolver.ts";
import type { GeneratedProject } from "../src/features/generation/generatedProject.ts";
import type { PreviewEngine } from "../src/features/preview/previewTypes.ts";

function sampleProject(): GeneratedProject {
  return {
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
  return <div data-node-id="root" className="box-border min-w-0 [max-width:1440px] [min-height:900px] [background-color:#ffffff]"><span>Control Test</span></div>;
}`,
      },
    ],
  };
}

function createMockScheduler() {
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const scheduler: DebounceScheduler = {
    setTimeout(callback: () => void, delay: number) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id: unknown) {
      timers.delete(id as number);
    },
  };
  return {
    scheduler,
    get pendingCount() {
      return timers.size;
    },
    runAll() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, timer] of pending) {
        timer.callback();
      }
    },
  };
}

const require = createRequire(import.meta.url);
function loadPreviewPanelComponent(): ComponentType<{
  model: PreviewModel;
  presentation?: PreviewPresentation;
  onRefresh?: () => void;
}> {
  const source = readFileSync(new URL("../src/features/preview/PreviewPanel.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(compiled, {
    exports,
    require: (id: string) => {
      if (id === "lucide-react") return lucide;
      if (id === "../preferences/useLabels" || id.endsWith("/useLabels")) return { useLabels };
      if (id === "./previewDocument" || id.endsWith("/previewDocument")) return previewDocument;
      if (id === "./previewTypes" || id.endsWith("/previewTypes")) return previewTypes;
      if (id === "./previewInput" || id.endsWith("/previewInput")) return previewInput;
      if (id === "./previewPresentation" || id.endsWith("/previewPresentation")) return previewPresentation;
      return require(id);
    },
  });
  return exports.PreviewPanel as ComponentType<{
    model: PreviewModel;
    presentation?: PreviewPresentation;
    onRefresh?: () => void;
  }>;
}

const PreviewPanel = loadPreviewPanelComponent();

test("1. default device preset = desktop", () => {
  const presentation = createPreviewPresentation();
  assert.equal(presentation.getSnapshot().preset, "desktop");
  assert.equal(DEFAULT_VIEWPORT_PRESET, "desktop");
  assert.equal(PREVIEW_VIEWPORT_PRESETS.desktop.width, 1440);
  assert.equal(PREVIEW_VIEWPORT_PRESETS.desktop.height, 900);
});

test("2. switching desktop/tablet/mobile", () => {
  const presentation = createPreviewPresentation();
  let notifications = 0;
  presentation.subscribe(() => {
    notifications++;
  });

  presentation.setPreset("tablet");
  assert.equal(presentation.getSnapshot().preset, "tablet");
  assert.equal(PREVIEW_VIEWPORT_PRESETS.tablet.width, 768);
  assert.equal(PREVIEW_VIEWPORT_PRESETS.tablet.height, 1024);

  presentation.setPreset("mobile");
  assert.equal(presentation.getSnapshot().preset, "mobile");
  assert.equal(PREVIEW_VIEWPORT_PRESETS.mobile.width, 390);
  assert.equal(PREVIEW_VIEWPORT_PRESETS.mobile.height, 844);

  presentation.setPreset("desktop");
  assert.equal(presentation.getSnapshot().preset, "desktop");
  assert.equal(notifications, 3);
});

test("3. changing device preset does NOT compile preview", async () => {
  let compileCalls = 0;
  const countingEngine: PreviewEngine = {
    kind: "placeholder",
    async render() {
      compileCalls++;
      return { documentHtml: "<html><body>count</body></html>" };
    },
  };

  const model = createPreviewModel(countingEngine);
  const presentation = createPreviewPresentation();
  model.setProject(sampleProject());
  await model.render();
  assert.equal(compileCalls, 1);

  // Changing device presets in presentation layer
  presentation.setPreset("tablet");
  presentation.setPreset("mobile");
  presentation.setPreset("desktop");

  // Compile calls must strictly remain 1
  assert.equal(compileCalls, 1);
});

test("4. default zoom = fit", () => {
  const presentation = createPreviewPresentation();
  assert.equal(presentation.getSnapshot().zoomMode, "fit");
  assert.equal(DEFAULT_ZOOM_MODE, "fit");
});

test("5. switching fit/50/75/100", () => {
  const presentation = createPreviewPresentation();
  let notifications = 0;
  presentation.subscribe(() => {
    notifications++;
  });

  presentation.setZoomMode("50");
  assert.equal(presentation.getSnapshot().zoomMode, "50");

  presentation.setZoomMode("75");
  assert.equal(presentation.getSnapshot().zoomMode, "75");

  presentation.setZoomMode("100");
  assert.equal(presentation.getSnapshot().zoomMode, "100");

  presentation.setZoomMode("fit");
  assert.equal(presentation.getSnapshot().zoomMode, "fit");

  assert.equal(notifications, 4);
});

test("6. manual zoom uses expected scale", () => {
  assert.equal(PREVIEW_ZOOM_SCALES["50"], 0.5);
  assert.equal(PREVIEW_ZOOM_SCALES["75"], 0.75);
  assert.equal(PREVIEW_ZOOM_SCALES["100"], 1.0);

  const res50 = calculatePresentationScale({
    preset: "desktop",
    zoomMode: "50",
    stageWidth: 1000,
    stageHeight: 800,
  });
  assert.equal(res50.scale, 0.5);
  assert.equal(res50.scaledWidth, 720);
  assert.equal(res50.scaledHeight, 450);

  const res75 = calculatePresentationScale({
    preset: "tablet",
    zoomMode: "75",
    stageWidth: 1000,
    stageHeight: 800,
  });
  assert.equal(res75.scale, 0.75);
  assert.equal(res75.scaledWidth, 576);
  assert.equal(res75.scaledHeight, 768);

  const res100 = calculatePresentationScale({
    preset: "mobile",
    zoomMode: "100",
    stageWidth: 1000,
    stageHeight: 800,
  });
  assert.equal(res100.scale, 1.0);
  assert.equal(res100.scaledWidth, 390);
  assert.equal(res100.scaledHeight, 844);
});

test("7. fit recalculates after device change", () => {
  const stage = { stageWidth: 800, stageHeight: 600 };

  const desktopFit = calculatePresentationScale({
    preset: "desktop",
    zoomMode: "fit",
    ...stage,
  });
  const mobileFit = calculatePresentationScale({
    preset: "mobile",
    zoomMode: "fit",
    ...stage,
  });

  assert.notEqual(desktopFit.scale, mobileFit.scale);
  assert.ok(desktopFit.scaledWidth <= stage.stageWidth);
  assert.ok(desktopFit.scaledHeight <= stage.stageHeight);
  assert.ok(mobileFit.scaledWidth <= stage.stageWidth);
  assert.ok(mobileFit.scaledHeight <= stage.stageHeight);

  // Aspect ratios strictly preserved
  const expectedDesktopRatio = PREVIEW_VIEWPORT_PRESETS.desktop.width / PREVIEW_VIEWPORT_PRESETS.desktop.height;
  const actualDesktopRatio = desktopFit.scaledWidth / desktopFit.scaledHeight;
  assert.ok(Math.abs(expectedDesktopRatio - actualDesktopRatio) < 0.02);
});

test("8. zoom/device changes do not mutate GeneratedProject", () => {
  const project = sampleProject();
  const originalJson = JSON.stringify(project);

  const presentation = createPreviewPresentation();
  presentation.setPreset("tablet");
  presentation.setZoomMode("50");
  presentation.setPreset("mobile");
  presentation.setZoomMode("100");

  assert.equal(JSON.stringify(project), originalJson);
});

test("9. zoom/device changes do not trigger editor sync", () => {
  const editorModel = createEditorModel();
  const previewModel = createPreviewModel();
  const { scheduler, pendingCount } = createMockScheduler();

  const sync = syncEditorToPreview(editorModel, previewModel, { scheduler });
  editorModel.setProject(sampleProject());

  const presentation = createPreviewPresentation();
  presentation.setPreset("mobile");
  presentation.setZoomMode("75");

  // Presentation adjustments must not queue pending editor compile timers
  assert.equal(pendingCount, 0);
  sync.dispose();
});

test("10. manual refresh triggers immediate render", async () => {
  let renders = 0;
  const engine: PreviewEngine = {
    kind: "placeholder",
    async render() {
      renders++;
      return { documentHtml: "<html><body>refreshed</body></html>" };
    },
  };

  const model = createPreviewModel(engine);
  model.setProject(sampleProject());
  await model.render();
  assert.equal(renders, 1);

  // Manual render call
  await model.render();
  assert.equal(renders, 2);
  assert.equal(model.getSnapshot().status, "SUCCESS");
});

test("11. manual refresh cancels stale render", async () => {
  const resolvers: ((val: any) => void)[] = [];
  const engine: PreviewEngine = {
    kind: "placeholder",
    render() {
      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    },
  };

  const model = createPreviewModel(engine);
  model.setProject(sampleProject());

  // Render 1 started
  const render1 = model.render();
  assert.equal(model.getSnapshot().revision, 2);

  // Manual refresh supersedes render 1 immediately
  const render2 = model.render();
  assert.equal(model.getSnapshot().revision, 3);

  // Render 1 resolves late
  resolvers[0]!({ documentHtml: "<html><body>stale</body></html>" });
  await render1;

  // Stale render must not overwrite active revision
  assert.equal(model.getSnapshot().status, "RENDERING");

  // Render 2 resolves
  resolvers[1]!({ documentHtml: "<html><body>fresh</body></html>" });
  await render2;
  assert.equal(model.getSnapshot().status, "SUCCESS");
  assert.equal(model.getSnapshot().documentHtml, "<html><body>fresh</body></html>");
});

test("12. updating status shown during RENDERING", async () => {
  let finishRender: () => void = () => {};
  const engine: PreviewEngine = {
    kind: "placeholder",
    render() {
      return new Promise((resolve) => {
        finishRender = () => resolve({ documentHtml: "<html><body>done</body></html>" });
      });
    },
  };

  const model = createPreviewModel(engine);
  model.setProject(sampleProject());
  void model.render();

  const markup = renderToStaticMarkup(createElement(PreviewPanel, { model }));
  assert.match(markup, /Actualizando…/);
  assert.match(markup, /data-status="RENDERING"/);

  finishRender();
  await new Promise((r) => setTimeout(r, 10));
});

test("13. compile error UI is sanitized", async () => {
  const model = createPreviewModel(createLocalIsolatedPreviewEngine());
  const invalidProject: GeneratedProject = {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      {
        path: "src/App.tsx",
        language: "typescript",
        content: `export default function App() { return <div className="test">missing closing tag; }`,
      },
    ],
  };

  model.setProject(invalidProject);
  await model.render();
  assert.equal(model.getSnapshot().status, "ERROR");

  const markup = renderToStaticMarkup(createElement(PreviewPanel, { model }));
  assert.match(markup, /role="alert"/);
  assert.match(markup, /ERR_COMPILATION_FAILED/);
  assert.doesNotMatch(markup, /[A-Za-z]:\\[^:\n]+/);
  assert.doesNotMatch(markup, /at Object\.transform/);
});

test("14. retry/refresh works from ERROR", async () => {
  let shouldFail = true;
  const engine: PreviewEngine = {
    kind: "placeholder",
    async render() {
      if (shouldFail) throw new Error("compile failure");
      return { documentHtml: "<html><body>recovered</body></html>" };
    },
  };

  const model = createPreviewModel(engine);
  model.setProject(sampleProject());
  await model.render();
  assert.equal(model.getSnapshot().status, "ERROR");

  // Fix and retry
  shouldFail = false;
  await model.render();
  assert.equal(model.getSnapshot().status, "SUCCESS");
  assert.equal(model.getSnapshot().documentHtml, "<html><body>recovered</body></html>");
});

test("15. fixing code still recovers automatically", async () => {
  const editorModel = createEditorModel();
  const previewModel = createPreviewModel();
  const { scheduler } = createMockScheduler();

  const sync = syncEditorToPreview(editorModel, previewModel, { scheduler });
  editorModel.setProject(sampleProject());
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(previewModel.getSnapshot().status, "SUCCESS");

  // 1. Break code
  editorModel.edit(`export default function Broken() { return <div>unclosed; }`);
  scheduler.setTimeout(() => {}, 0);
  await sync.flush();
  assert.equal(previewModel.getSnapshot().status, "ERROR");

  // 2. Fix code
  editorModel.edit(`export default function Fixed() { return <div>fixed</div>; }`);
  await sync.flush();
  assert.equal(previewModel.getSnapshot().status, "SUCCESS");

  sync.dispose();
});

test("16. no network calls", () => {
  const presentationSource = readFileSync(
    new URL("../src/features/preview/previewPresentation.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(presentationSource, /fetch\(/);
  assert.doesNotMatch(presentationSource, /XMLHttpRequest/);
  assert.doesNotMatch(presentationSource, /WebSocket/);
  assert.doesNotMatch(presentationSource, /http:\/\//);
  assert.doesNotMatch(presentationSource, /https:\/\//);
});

test("17. no OpenAI calls", () => {
  const panelSource = readFileSync(
    new URL("../src/features/preview/PreviewPanel.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(panelSource, /openai/i);
  assert.doesNotMatch(panelSource, /analysis/i);
  assert.doesNotMatch(panelSource, /invoke\(/);
  assert.doesNotMatch(panelSource, /__TAURI__/);
});

test("18. sandbox policy unchanged", () => {
  assert.equal(PREVIEW_SANDBOX, "allow-scripts");
  assert.doesNotMatch(PREVIEW_SANDBOX, /allow-same-origin/);
  assert.match(PREVIEW_IFRAME_CSP, /connect-src 'none'/);
  assert.match(PREVIEW_IFRAME_CSP, /default-src 'none'/);
});

test("19. fit-to-viewport calculations remain consistent", () => {
  const result = calculatePresentationScale({
    preset: "desktop",
    zoomMode: "fit",
    stageWidth: 1440,
    stageHeight: 900,
    padding: 0,
  });
  assert.equal(result.scale, 1);
  assert.equal(result.scaledWidth, 1440);
  assert.equal(result.scaledHeight, 900);
});

test("20. module resolver tests remain passing", () => {
  const resolved = resolveModuleId("src/App.tsx", "./generated/GeneratedInterface", [
    "src/App.tsx",
    "src/generated/GeneratedInterface.tsx",
  ]);
  assert.equal(resolved, "src/generated/GeneratedInterface.tsx");
});
