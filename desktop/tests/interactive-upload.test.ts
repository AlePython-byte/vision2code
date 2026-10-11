import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { i18n } from "../src/features/preferences/i18n.ts";
import { createAnalysisClient, DEFAULT_API_BASE_URL } from "../src/features/analysis/analysisClient.ts";
import { createAnalysisModel, canAnalyze } from "../src/features/analysis/analysisModel.ts";
import { validateScreenshotFile } from "../src/features/screenshot/validation.ts";
import type { Screenshot } from "../src/features/screenshot/loadScreenshot.ts";
import { AnalysisResponseSchema } from "@vision2code/contracts";

const uiSchemaFixture: unknown = JSON.parse(
  readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"),
);
const validAnalysisResult = AnalysisResponseSchema.parse({ requestId: "upload-test-001", uiSchema: uiSchemaFixture });

function loadScreenshotInput() {
  const source = readFileSync(new URL("../src/features/screenshot/ScreenshotInput.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name.endsWith("/useLabels") || name === "./useLabels") {
        return { useLabels: () => ({ t: i18n.t.bind(i18n), message: (s: string) => s }) };
      }
      if (name.includes("ScreenshotPreview")) {
        return { ScreenshotPreview: () => React.createElement("div", { className: "mock-preview" }, "Preview") };
      }
      if (name.endsWith("/validation") || name === "./validation") {
        return {
          MAX_SCREENSHOT_SIZE_LABEL: "10 MB",
          SCREENSHOT_ACCEPT: ".png,image/png,.jpg,.jpeg,image/jpeg,.webp,image/webp",
        };
      }
      return require(name);
    },
  });
  return exports.ScreenshotInput;
}

function findElement(node: any, predicate: (n: any) => boolean): any {
  if (!node) return null;
  if (predicate(node)) return node;
  if (node.props?.children) {
    const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
    for (const child of children) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function renderTree(ScreenshotInputComponent: any, props: any) {
  let captured: any = null;
  function TreeHarness(innerProps: any) {
    captured = ScreenshotInputComponent(innerProps);
    return captured;
  }
  const html = renderToStaticMarkup(React.createElement(TreeHarness, props));
  return { html, tree: captured };
}

function mockScreenshot(): Screenshot {
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "sample.png", { type: "image/png" });
  return { file, name: file.name, size: file.size, format: "PNG", width: 1024, height: 768, url: "blob:test" };
}

function mockController(overrides: Partial<any> = {}) {
  return {
    screenshot: null,
    status: "EMPTY",
    error: null,
    setDragging: () => {},
    selectFiles: () => {},
    removeScreenshot: () => {},
    ...overrides,
  };
}

test("renders empty state with accessible names for plus affordance, upload surface, browse button and file input in Spanish", async () => {
  await i18n.changeLanguage("es");
  const ScreenshotInput = loadScreenshotInput();
  const { html, tree } = renderTree(ScreenshotInput, { controller: mockController() });

  assert.ok(html.includes('class="upload-mark"'));
  assert.ok(html.includes('aria-label="Seleccionar imagen de referencia"'));
  assert.ok(html.includes('role="region"'));
  assert.ok(html.includes('aria-label="Arrastra tu interfaz aquí."'));
  assert.ok(html.includes('aria-label="Seleccionar una captura de pantalla"'));
  assert.ok(html.includes("Seleccionar imagen"));

  const fileInput = findElement(tree, (n) => n.type === "input" && n.props?.type === "file");
  assert.ok(fileInput);
  assert.equal(fileInput.props["aria-label"], "Seleccionar una captura de pantalla");
  assert.equal(fileInput.props.hidden, true);
});

test("renders English translations correctly when language changes to English", async () => {
  await i18n.changeLanguage("en");
  const ScreenshotInput = loadScreenshotInput();
  const { html, tree } = renderTree(ScreenshotInput, { controller: mockController() });

  assert.ok(html.includes('aria-label="Select reference image"'));
  assert.ok(html.includes('aria-label="Drop your interface here."'));
  assert.ok(html.includes('aria-label="Select a screenshot"'));
  assert.ok(html.includes("Select image"));

  const affordance = findElement(tree, (n) => n.props?.className === "upload-mark");
  assert.equal(affordance.props["aria-label"], "Select reference image");

  await i18n.changeLanguage("es");
});

test("clicking '+' affordance triggers the shared file picker", () => {
  const ScreenshotInput = loadScreenshotInput();
  let pickerClicks = 0;
  const fakeInput = { click: () => { pickerClicks++; } };
  const inputRef = { current: fakeInput as any };

  const { tree } = renderTree(ScreenshotInput, { controller: mockController(), inputRef });
  const uploadMark = findElement(tree, (n) => n.props?.className === "upload-mark");
  assert.ok(uploadMark);

  let stopped = false;
  uploadMark.props.onClick({
    stopPropagation: () => { stopped = true; },
  });

  assert.equal(pickerClicks, 1);
  assert.equal(stopped, true);
});

test("clicking upload surface triggers the same shared file picker", () => {
  const ScreenshotInput = loadScreenshotInput();
  let pickerClicks = 0;
  const fakeInput = { click: () => { pickerClicks++; } };
  const inputRef = { current: fakeInput as any };

  const { tree } = renderTree(ScreenshotInput, { controller: mockController(), inputRef });
  const emptyWorkspace = findElement(tree, (n) => n.props?.className?.includes("empty-workspace"));
  assert.ok(emptyWorkspace);

  let stopped = false;
  const surfaceElement = { closest: () => null };
  emptyWorkspace.props.onClick({
    target: surfaceElement,
    stopPropagation: () => { stopped = true; },
  });

  assert.equal(pickerClicks, 1);
  assert.equal(stopped, true);
});

test("clicking Browse files triggers the same shared file picker and does not double-trigger", () => {
  const ScreenshotInput = loadScreenshotInput();
  let pickerClicks = 0;
  const fakeInput = { click: () => { pickerClicks++; } };
  const inputRef = { current: fakeInput as any };

  const { tree } = renderTree(ScreenshotInput, { controller: mockController(), inputRef });
  const browseButton = findElement(tree, (n) => n.props?.className?.includes("action-button"));
  assert.ok(browseButton);

  let stopped = false;
  const buttonElement = {
    closest: (selector: string) => (selector === "button" ? buttonElement : null),
  };

  browseButton.props.onClick({
    target: buttonElement,
    stopPropagation: () => { stopped = true; },
  });

  assert.equal(pickerClicks, 1);
  assert.equal(stopped, true);

  // If the click event had bubbled to the drop area or surface, the closest('button') guard prevents re-triggering
  const dropArea = findElement(tree, (n) => n.props?.className?.includes("screenshot-drop-area"));
  dropArea.props.onClick({
    target: buttonElement,
    stopPropagation: () => {},
  });

  assert.equal(pickerClicks, 1, "Browse button click must not double-trigger when bubbling");
});

test("clicking help text does not trigger the file picker", () => {
  const ScreenshotInput = loadScreenshotInput();
  let pickerClicks = 0;
  const fakeInput = { click: () => { pickerClicks++; } };
  const inputRef = { current: fakeInput as any };

  const { tree } = renderTree(ScreenshotInput, { controller: mockController(), inputRef });
  const dropArea = findElement(tree, (n) => n.props?.className?.includes("screenshot-drop-area"));

  const helpElement = {
    closest: (selector: string) => (selector === ".input-help" ? helpElement : null),
  };

  dropArea.props.onClick({
    target: helpElement,
    stopPropagation: () => {},
  });

  assert.equal(pickerClicks, 0, "Clicking help text must not open the file picker");
});

test("keyboard activation with Enter and Space opens the file picker", () => {
  const ScreenshotInput = loadScreenshotInput();
  let pickerClicks = 0;
  const fakeInput = { click: () => { pickerClicks++; } };
  const inputRef = { current: fakeInput as any };

  const { tree } = renderTree(ScreenshotInput, { controller: mockController(), inputRef });
  const emptyWorkspace = findElement(tree, (n) => n.props?.className?.includes("empty-workspace"));
  assert.ok(emptyWorkspace);

  const surfaceDom = {};
  let enterPrevented = false;
  emptyWorkspace.props.onKeyDown({
    key: "Enter",
    target: surfaceDom,
    currentTarget: surfaceDom,
    preventDefault: () => { enterPrevented = true; },
  });
  assert.equal(pickerClicks, 1);
  assert.equal(enterPrevented, true);

  let spacePrevented = false;
  emptyWorkspace.props.onKeyDown({
    key: " ",
    target: surfaceDom,
    currentTarget: surfaceDom,
    preventDefault: () => { spacePrevented = true; },
  });
  assert.equal(pickerClicks, 2);
  assert.equal(spacePrevented, true);
});

test("drag and drop delivers files to controller and respects drag states", () => {
  const ScreenshotInput = loadScreenshotInput();
  let selectedFiles: File[] = [];
  let dragStates: boolean[] = [];

  const controller = mockController({
    setDragging: (dragging: boolean) => { dragStates.push(dragging); },
    selectFiles: (files: File[]) => { selectedFiles = files; },
  });

  const { tree } = renderTree(ScreenshotInput, { controller });
  const dropArea = findElement(tree, (n) => n.props?.className?.includes("screenshot-drop-area"));
  assert.ok(dropArea);

  // Drag enter with Files
  let defaultPrevented = false;
  dropArea.props.onDragEnter({
    dataTransfer: { types: ["Files"] },
    preventDefault: () => { defaultPrevented = true; },
  });
  assert.equal(defaultPrevented, true);
  assert.deepEqual(dragStates, [true]);

  // Drop with files
  const testFile = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "drop.png", { type: "image/png" });
  dropArea.props.onDrop({
    dataTransfer: { files: [testFile] },
    preventDefault: () => {},
  });
  assert.equal(selectedFiles.length, 1);
  assert.equal(selectedFiles[0]?.name, testFile.name);
  assert.equal(selectedFiles[0]?.size, testFile.size);
  assert.equal(selectedFiles[0]?.type, testFile.type);
  assert.deepEqual(dragStates, [true, false]);
});

test("file input change delegates to controller selectFiles", () => {
  const ScreenshotInput = loadScreenshotInput();
  let selectedFiles: File[] = [];
  const controller = mockController({
    selectFiles: (files: File[]) => { selectedFiles = files; },
  });

  const { tree } = renderTree(ScreenshotInput, { controller });
  const fileInput = findElement(tree, (n) => n.type === "input" && n.props?.type === "file");
  assert.ok(fileInput);

  const testFile = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "selected.png", { type: "image/png" });
  fileInput.props.onChange({
    currentTarget: { files: [testFile], value: "C:\\fakepath\\selected.png" },
  });

  assert.equal(selectedFiles.length, 1);
  assert.equal(selectedFiles[0]?.name, testFile.name);
  assert.equal(selectedFiles[0]?.size, testFile.size);
  assert.equal(selectedFiles[0]?.type, testFile.type);
});

test("when screenshot is already loaded, preview renders and replace uses the same picker trigger", () => {
  const ScreenshotInput = loadScreenshotInput();
  let pickerClicks = 0;
  const fakeInput = { click: () => { pickerClicks++; } };
  const inputRef = { current: fakeInput as any };

  const controller = mockController({
    screenshot: mockScreenshot(),
    status: "READY",
  });

  const { html, tree } = renderTree(ScreenshotInput, { controller, inputRef });
  assert.ok(html.includes("mock-preview"));
  assert.doesNotMatch(html, /class="empty-workspace"/);
  assert.ok(html.includes("Reemplazar captura"));

  // Replace button delegates to same picker trigger
  const replaceButton = findElement(tree, (n) => n.props?.className?.includes("action-button"));
  assert.ok(replaceButton);

  replaceButton.props.onClick({
    stopPropagation: () => {},
  });
  assert.equal(pickerClicks, 1);

  // Tray surface does not trigger file picker when screenshot is present
  const dropArea = findElement(tree, (n) => n.props?.className?.includes("screenshot-drop-area"));
  dropArea.props.onClick({
    target: { closest: () => null },
    stopPropagation: () => {},
  });
  assert.equal(pickerClicks, 1, "Surface click must not trigger picker when screenshot is present");
});

test("screenshot validation behavior remains strictly intact", async () => {
  const validFile = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "valid.png", { type: "image/png" });
  assert.equal(await validateScreenshotFile(validFile), "PNG");

  const invalidFile = new File(["not-an-image"], "invalid.txt", { type: "text/plain" });
  await assert.rejects(validateScreenshotFile(invalidFile));
});

test("validated screenshot reaches analysis model and executes successfully", async () => {
  const selected = mockScreenshot();
  const model = createAnalysisModel(async () => validAnalysisResult);

  assert.equal(canAnalyze(model.getSnapshot()), false);
  model.setScreenshot(selected);
  assert.equal(canAnalyze(model.getSnapshot()), true);

  await model.analyze();
  assert.equal(model.getSnapshot().status, "SUCCESS");
  assert.deepEqual(model.getSnapshot().result, validAnalysisResult);
});

test("confirm backend payload to /analyses remains strictly unchanged", async () => {
  const selected = mockScreenshot();
  const client = createAnalysisClient(undefined, async (url, options) => {
    assert.equal(url, DEFAULT_API_BASE_URL + "/analyses");
    assert.equal(options?.method, "POST");
    assert.ok(options?.body instanceof FormData);
    const keys = Array.from(options.body.keys()).sort();
    assert.deepEqual(keys, ["image", "viewportHeight", "viewportWidth"]);
    return Response.json(validAnalysisResult);
  });

  const res = await client(selected, new AbortController().signal);
  assert.deepEqual(res, validAnalysisResult);
});
