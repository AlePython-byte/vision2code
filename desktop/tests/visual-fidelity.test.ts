import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  createGenerationProfileModel,
  DEFAULT_VISUAL_FIDELITY,
  VISUAL_FIDELITY_OPTIONS,
  VISUAL_FIDELITY_CONFIGS,
  type VisualFidelity,
} from "../src/features/analysis/generationProfileModel.ts";
import * as generationProfileModule from "../src/features/analysis/generationProfileModel.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { es, en } from "../src/features/preferences/resources.ts";
import { createAnalysisClient, DEFAULT_API_BASE_URL } from "../src/features/analysis/analysisClient.ts";
import type { Screenshot } from "../src/features/screenshot/loadScreenshot.ts";
import { OutputStackSchema, AnalysisResponseSchema } from "@vision2code/contracts";

const uiSchemaFixture: unknown = JSON.parse(
  readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"),
);
const validAnalysisResult = AnalysisResponseSchema.parse({ requestId: "fidelity-test-001", uiSchema: uiSchemaFixture });

function loadComponent(file: string, overrides: Record<string, unknown> = {}) {
  const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name in overrides) return overrides[name];
      if (name.endsWith("/useLabels") || name === "./useLabels") return { useLabels: () => ({ t: i18n.t.bind(i18n), message: (s: string) => s }) };
      if (name.includes("generationProfileModel")) return generationProfileModule;
      if (name.includes("analysisModel")) return { canAnalyze: () => true };
      if (name === "@vision2code/contracts") return { OutputStackSchema, AnalysisResponseSchema };
      return require(name);
    },
  });
  return exports;
}

function testScreenshot(): Screenshot {
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "screenshot.png", { type: "image/png" });
  return { file, name: file.name, size: file.size, format: "PNG", width: 800, height: 600, url: "blob:test" };
}

test("default fidelity mode is balanced at 0 degrees with valid configs", () => {
  const model = createGenerationProfileModel();
  const state = model.getSnapshot();
  assert.equal(state.fidelity, "balanced");
  assert.equal(state.outputStack, "REACT_TAILWIND");
  assert.equal(DEFAULT_VISUAL_FIDELITY, "balanced");

  assert.deepEqual(VISUAL_FIDELITY_OPTIONS, ["fast", "balanced", "precise"]);
  assert.equal(VISUAL_FIDELITY_CONFIGS.fast.rotationDegrees, -35);
  assert.equal(VISUAL_FIDELITY_CONFIGS.balanced.rotationDegrees, 0);
  assert.equal(VISUAL_FIDELITY_CONFIGS.precise.rotationDegrees, 35);
});

test("switching fidelity updates state and notifies subscribers without unnecessary notifications", () => {
  const model = createGenerationProfileModel();
  let notifications = 0;
  const unsubscribe = model.subscribe(() => {
    notifications++;
  });

  // Switch to fast
  model.setFidelity("fast");
  assert.equal(model.getSnapshot().fidelity, "fast");
  assert.equal(notifications, 1);

  // Redundant set does not notify
  model.setFidelity("fast");
  assert.equal(notifications, 1);

  // Switch to precise
  model.setFidelity("precise");
  assert.equal(model.getSnapshot().fidelity, "precise");
  assert.equal(notifications, 2);

  // Output stack changes notify independently
  model.setOutputStack("HTML_CSS");
  assert.equal(model.getSnapshot().outputStack, "HTML_CSS");
  assert.equal(notifications, 3);

  // Unsubscribe stops notifications
  unsubscribe();
  model.setFidelity("balanced");
  assert.equal(notifications, 3);
  assert.equal(model.getSnapshot().fidelity, "balanced");
});

test("cycleFidelity cycles through fast, balanced, and precise in round-robin order", () => {
  const model = createGenerationProfileModel({ fidelity: "fast" });
  assert.equal(model.cycleFidelity(), "balanced");
  assert.equal(model.getSnapshot().fidelity, "balanced");

  assert.equal(model.cycleFidelity(), "precise");
  assert.equal(model.getSnapshot().fidelity, "precise");

  assert.equal(model.cycleFidelity(), "fast");
  assert.equal(model.getSnapshot().fidelity, "fast");
});

test("all fidelity labels and descriptions are correctly localized in Spanish and English", () => {
  // Spanish labels and descriptions
  assert.equal(es.fidelityFast, "Rápido");
  assert.equal(es.fidelityFastDesc, "Menor tiempo de análisis.");
  assert.equal(es.fidelityBalanced, "Equilibrado");
  assert.equal(es.fidelityBalancedDesc, "Balance entre velocidad y detalle.");
  assert.equal(es.fidelityPrecise, "Preciso");
  assert.equal(es.fidelityPreciseDesc, "Mayor detalle, generación más lenta.");

  // English labels and descriptions
  assert.equal(en.fidelityFast, "Fast");
  assert.equal(en.fidelityFastDesc, "Faster analysis with reduced detail.");
  assert.equal(en.fidelityBalanced, "Balanced");
  assert.equal(en.fidelityBalancedDesc, "Balanced speed and visual detail.");
  assert.equal(en.fidelityPrecise, "Precise");
  assert.equal(en.fidelityPreciseDesc, "Higher detail, slower generation.");
});

test("VisualFidelitySelector renders accessible radiogroup, dial rotor, and active states", () => {
  void i18n.changeLanguage("es");
  const { VisualFidelitySelector } = loadComponent("analysis/VisualFidelitySelector.tsx");

  // Render balanced (default)
  let html = renderToStaticMarkup(
    React.createElement(VisualFidelitySelector, {
      value: "balanced",
      onChange() {},
    }),
  );

  assert.match(html, /role="radiogroup"/);
  assert.match(html, /aria-label="Fidelidad visual"/);
  assert.match(html, /role="radio"/);
  assert.match(html, /transform:rotate\(0deg\)/);
  assert.match(html, /Equilibrado/);
  assert.match(html, /Balance entre velocidad y detalle\./);
  assert.match(html, /data-fidelity="balanced"/);

  // Render fast
  html = renderToStaticMarkup(
    React.createElement(VisualFidelitySelector, {
      value: "fast",
      onChange() {},
    }),
  );
  assert.match(html, /transform:rotate\(-35deg\)/);
  assert.match(html, /Rápido/);
  assert.match(html, /Menor tiempo de análisis\./);
  assert.match(html, /data-fidelity="fast"/);

  // Render precise
  html = renderToStaticMarkup(
    React.createElement(VisualFidelitySelector, {
      value: "precise",
      onChange() {},
    }),
  );
  assert.match(html, /transform:rotate\(35deg\)/);
  assert.match(html, /Preciso/);
  assert.match(html, /Mayor detalle, generación más lenta\./);
  assert.match(html, /data-fidelity="precise"/);
});

test("VisualFidelitySelector supports keyboard arrow navigation and dial click", () => {
  void i18n.changeLanguage("es");
  const { VisualFidelitySelector } = loadComponent("analysis/VisualFidelitySelector.tsx");

  let selected: VisualFidelity = "balanced";
  let cycled = false;

  function flatten(element: any): any[] {
    if (!element || typeof element !== "object") return [];
    return [element, ...React.Children.toArray(element.props?.children).flatMap(flatten)];
  }

  // Keyboard navigation on radiogroup
  const node = VisualFidelitySelector({
    value: selected,
    onChange(val: VisualFidelity) {
      selected = val;
    },
    onCycle() {
      cycled = true;
    },
  });

  const nodes = flatten(node);
  const radiogroup = nodes.find((n) => n.props?.role === "radiogroup");
  assert.ok(radiogroup);

  // ArrowRight moves from balanced to precise
  radiogroup.props.onKeyDown({ key: "ArrowRight", preventDefault() {} });
  assert.equal(selected, "precise");

  // ArrowRight from precise wraps to fast
  const nodePrecise = VisualFidelitySelector({
    value: "precise",
    onChange(val: VisualFidelity) {
      selected = val;
    },
  });
  flatten(nodePrecise)
    .find((n) => n.props?.role === "radiogroup")
    .props.onKeyDown({ key: "ArrowRight", preventDefault() {} });
  assert.equal(selected, "fast");

  // ArrowLeft from fast wraps to precise
  const nodeFast = VisualFidelitySelector({
    value: "fast",
    onChange(val: VisualFidelity) {
      selected = val;
    },
  });
  flatten(nodeFast)
    .find((n) => n.props?.role === "radiogroup")
    .props.onKeyDown({ key: "ArrowLeft", preventDefault() {} });
  assert.equal(selected, "precise");

  // Clicking the dial triggers onCycle
  const dialBtn = nodes.find((n) => n.props?.className === "fidelity-dial");
  assert.ok(dialBtn);
  dialBtn.props.onClick();
  assert.equal(cycled, true);
});

test("CaptureConsole renders fidelity control and state survives normal rerenders", () => {
  void i18n.changeLanguage("es");
  const profileModel = createGenerationProfileModel();
  const fidelitySelectorModule = loadComponent("analysis/VisualFidelitySelector.tsx");
  const { CaptureConsole } = loadComponent("analysis/CaptureConsole.tsx", {
    "./VisualFidelitySelector": fidelitySelectorModule,
    "../screenshot/ScreenshotInput": { ScreenshotInput: () => React.createElement("div", { id: "screenshot-input" }) },
    "../screenshot/useScreenshot": {
      useScreenshot: () => ({
        screenshot: null,
        status: "IDLE",
        error: null,
        selectFiles: () => {},
        removeScreenshot: () => {},
      }),
    },
    "./useAnalysis": {
      useAnalysis: () => ({
        state: { status: "IDLE", screenshot: null, result: null, error: null, errorRequestId: null },
        model: { analyze: async () => {}, cancel: () => {}, setScreenshot: () => {} },
      }),
    },
  });

  // Initial render has balanced
  let html = renderToStaticMarkup(
    React.createElement(CaptureConsole, {
      onGenerated() {},
      profileModel,
    }),
  );
  assert.match(html, /data-fidelity="balanced"/);
  assert.match(html, /Equilibrado/);

  // Change fidelity to precise on the profile model
  profileModel.setFidelity("precise");

  // Re-render retains the updated state
  html = renderToStaticMarkup(
    React.createElement(CaptureConsole, {
      onGenerated() {},
      profileModel,
    }),
  );
  assert.match(html, /data-fidelity="precise"/);
  assert.match(html, /Preciso/);
});

test("backend analyses request payload is completely unchanged regardless of fidelity selection", async () => {
  const profileModel = createGenerationProfileModel();
  const shot = testScreenshot();

  let capturedFormData: FormData | null = null;
  const mockTransport = async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), DEFAULT_API_BASE_URL + "/analyses");
    assert.equal(init?.method, "POST");
    capturedFormData = init?.body as FormData;
    return Response.json(validAnalysisResult);
  };

  const client = createAnalysisClient(undefined, mockTransport);

  // Test across all 3 fidelity modes
  for (const mode of VISUAL_FIDELITY_OPTIONS) {
    profileModel.setFidelity(mode);
    assert.equal(profileModel.getSnapshot().fidelity, mode);

    capturedFormData = null;
    await client(shot, new AbortController().signal);

    assert.ok(capturedFormData instanceof FormData);
    const keys = Array.from((capturedFormData as FormData).keys()).sort();
    // Exactly three fields sent: image, viewportHeight, viewportWidth
    assert.deepEqual(keys, ["image", "viewportHeight", "viewportWidth"]);
    assert.equal((capturedFormData as FormData).get("viewportWidth"), "800");
    assert.equal((capturedFormData as FormData).get("viewportHeight"), "600");
    // Verify fidelity is NEVER included in the multipart payload
    assert.equal((capturedFormData as FormData).get("fidelity"), null);
    assert.equal((capturedFormData as FormData).get("profile"), null);
    assert.equal((capturedFormData as FormData).get("outputStack"), null);
  }
});
