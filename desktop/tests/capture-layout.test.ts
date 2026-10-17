import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { AnalysisResponseSchema } from "@vision2code/contracts";
import * as analysisModelModule from "../src/features/analysis/analysisModel.ts";
import * as generationProfileModule from "../src/features/analysis/generationProfileModel.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { en, es, messageKeys } from "../src/features/preferences/resources.ts";

const uiSchema: unknown = JSON.parse(readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
const result = AnalysisResponseSchema.parse({ requestId: "layout-ok", uiSchema });

const states = {
  idle: { status: "IDLE", screenshot: null, result: null, error: null, errorRequestId: null, errorRetryAfterSeconds: null, context: null },
  analyzing: { status: "ANALYZING", screenshot: null, result: null, error: null, errorRequestId: null, errorRetryAfterSeconds: null,
    context: { targetProjectId: null, fidelity: "balanced" } },
  success: { status: "SUCCESS", screenshot: null, result, error: null, errorRequestId: null, errorRetryAfterSeconds: null,
    context: { targetProjectId: null, fidelity: "balanced" } },
  error: { status: "ERROR", screenshot: null, result: null, error: es.connectionFailure, errorRequestId: "req-error", errorRetryAfterSeconds: null,
    context: { targetProjectId: null, fidelity: "balanced" } },
} as const;

function render(state: object) {
  const source = readFileSync(new URL("../src/features/analysis/CaptureConsole.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  const overrides: Record<string, unknown> = {
    "./VisualFidelitySelector": { VisualFidelitySelector: () => null },
    "../screenshot/ScreenshotInput": { ScreenshotInput: () => null },
    "../screenshot/useScreenshot": { useScreenshot: () => ({ screenshot: null, status: "EMPTY", error: null, selectFiles: () => {}, removeScreenshot: () => {} }) },
    "./useAnalysis": { useAnalysis: () => ({ state, model: { analyze: async () => {}, cancel: () => {}, setScreenshot: () => {}, generateArtifact: () => null } }) },
  };
  runInNewContext(code, { exports, require: (name: string) => {
    if (name in overrides) return overrides[name];
    if (name.endsWith("/useLabels")) return { useLabels: () => ({ t: i18n.t.bind(i18n), message: (value: string) => i18n.t(messageKeys[value] ?? "analysisFailure") }) };
    if (name.includes("generationProfileModel")) return generationProfileModule;
    if (name.includes("analysisModel")) return analysisModelModule;
    return require(name);
  } });
  return renderToStaticMarkup(React.createElement(exports.CaptureConsole, { onGenerated() {} }));
}

/** The footer runs from its opening tag to the end of the profile panel. */
function footerOf(html: string) {
  const start = html.indexOf('<div class="profile-footer">');
  assert.ok(start >= 0, "the profile panel has a footer");
  return html.slice(start, html.indexOf("</section>", start));
}
const count = (html: string, pattern: RegExp) => html.match(new RegExp(pattern, "g"))?.length ?? 0;

test("the stepper shows five steps and no 'coming soon' tag, in Spanish and English", async () => {
  try {
    for (const language of ["es", "en"] as const) {
      await i18n.changeLanguage(language);
      const html = render(states.idle);
      const stepper = html.slice(html.indexOf('<ol class="workflow-strip"'), html.indexOf("</ol>"));
      assert.equal(count(stepper, /class="workflow-number"/), 5, language);
      assert.doesNotMatch(stepper, /pr[oó]ximamente|coming soon|<small/i, language);
      assert.doesNotMatch(stepper, /data-future/, "step 05 is a normal future step");
      assert.match(stepper, new RegExp(language === "es" ? es.exportStage : en.exportStage));
    }
  } finally {
    await i18n.changeLanguage("es");
  }
});

test("in every state the main action and the status live together in the panel footer, with a single primary", async () => {
  await i18n.changeLanguage("es");
  const expected = {
    idle: { primary: es.analyze, status: es.analysisIdle },
    analyzing: { primary: es.analyzingButton, status: es.analysisBusyBalanced },
    success: { primary: es.generate, status: es.analysisSuccess },
    error: { primary: es.retry, status: null },
  } as const;
  for (const [name, state] of Object.entries(states) as [keyof typeof states, object][]) {
    const html = render(state);
    const footer = footerOf(html);
    assert.equal(count(html, /primary-action/), 1, `${name}: exactly one primary action`);
    assert.match(footer, new RegExp(`class="action-button primary-action"[^>]*>${expected[name].primary}`), `${name}: primary in the footer`);
    assert.match(footer, /<p role="status" aria-live="polite" aria-atomic="true">/, `${name}: status in the footer`);
    if (expected[name].status) assert.match(footer, new RegExp(expected[name].status.replace(/[.]/g, "\\.")), name);
  }
  // Analyzing: the primary is disabled with a spinner, Cancel is the secondary action.
  const analyzing = footerOf(render(states.analyzing));
  assert.match(analyzing, /<button class="action-button primary-action" type="button" disabled=""[^>]*>Analizando…<svg[^>]*action-spinner/);
  assert.match(analyzing, new RegExp(`secondary-button[^>]*>${es.cancelAnalysis}`));
  // Success: analyzing again is a discreet ghost action and the reference stays visible.
  const success = footerOf(render(states.success));
  assert.match(success, new RegExp(`class="action-button ghost-button"[^>]*>.*${es.reanalyze}`));
  assert.match(success, /class="request-reference">Referencia: layout-ok</);
});

test("an analysis error is announced with role=alert inside the footer, next to Retry", async () => {
  await i18n.changeLanguage("es");
  const footer = footerOf(render(states.error));
  assert.match(footer, new RegExp(`<p role="alert" class="input-error">${es.connectionFailure.replace(/[.]/g, "\\.")}</p>`));
  assert.match(footer, /class="request-reference">Referencia: req-error</);
});

test("the removed profile controls are gone and the stack is one read-only row", () => {
  const html = render(states.idle);
  assert.doesNotMatch(html, /<select|<textarea|profile-fields|instructions-field|output-stack/);
  assert.match(html, /<p class="profile-stack">.*React · Tailwind CSS · TypeScript<\/span><\/p>/);
  for (const key of ["soon", "noFramework", "styles", "codeLanguage", "instructions", "instructionsHelp", "htmlSoon", "analysisHelp"]) {
    assert.equal(key in es || key in en, false, `${key} is no longer a resource`);
  }
  assert.deepEqual([es.analyze, en.analyze], ["Analizar captura", "Analyze screenshot"]);
});

test("the capture layout fills the window and only the profile body scrolls", () => {
  const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  const fill = css.slice(css.indexOf(".capture-view[hidden]"));
  assert.match(fill, /\.capture-view:not\(\[hidden\]\) \{[^}]*min-height: 0;/);
  assert.match(fill, /\.capture-workspace \.capture-grid \{[^}]*grid-template-rows: minmax\(0, 1fr\);[^}]*align-items: stretch;/);
  assert.match(fill, /\.profile-body \{[^}]*overflow-y: auto;/);
  assert.match(css, /\.profile-footer \{[^}]*flex-shrink: 0;/);
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*\.action-spinner \{ animation: none !important; \}/);
});
