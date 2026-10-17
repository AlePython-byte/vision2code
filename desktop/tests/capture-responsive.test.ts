import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import * as analysisModelModule from "../src/features/analysis/analysisModel.ts";
import * as generationProfileModule from "../src/features/analysis/generationProfileModel.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { DISABLED_PAIRS, SCROLLBAR_PAIRS, ratioFor, readThemeTokens } from "../../scripts/contrast.mts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const theme = read("../src/styles/theme.css");
const foundation = read("../src/styles/foundation.css");
/** Body of the first `@media (query) { ... }` block, found by brace matching. */
function mediaBlock(css: string, query: string) {
  const start = css.indexOf(`@media ${query} {`);
  assert.ok(start >= 0, `missing @media ${query}`);
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index++) {
    if (css[index] === "{") depth++;
    if (css[index] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, index);
  }
  throw new Error("unbalanced media block");
}

function cssFiles(): string[] {
  const out: string[] = [];
  const walk = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) walk(child); else if (entry.name.endsWith(".css")) out.push(fileURLToPath(child));
    }
  };
  walk(new URL("../src/", import.meta.url));
  return out;
}

test("there is ONE shared scrollbar style, without arrow buttons, and no container brings its own", () => {
  const rules = foundation.match(/::-webkit-scrollbar \{/g) ?? [];
  assert.equal(rules.length, 1, "a single base scrollbar rule");
  assert.match(foundation, /::-webkit-scrollbar-thumb \{[^}]*border-radius: 999px;/, "rounded thumb");
  assert.match(foundation, /::-webkit-scrollbar-button \{ display: none;/, "no arrow buttons");
  assert.match(foundation, /\*:not\(\.monaco-editor, \.monaco-editor \*\)::-webkit-scrollbar/, "Monaco's own scrollbars are left alone");
  // The standard properties would switch the pseudo-elements off in Chromium: only the unsupported-engine fallback may use them.
  for (const path of cssFiles()) {
    if (path.endsWith("foundation.css")) continue; // owns the shared block (asserted above)
    assert.doesNotMatch(readFileSync(path, "utf8"), /scrollbar-width|scrollbar-color|::-webkit-scrollbar/, path);
  }
  assert.equal((foundation.match(/scrollbar-width/g) ?? []).length, 2, "foundation: only the explanatory comment and the unsupported-engine fallback mention it");
  const library = read("../src/features/projects/vault.css").match(/\.library-dialog \{([^}]*)\}/)?.[1] ?? "";
  assert.match(library, /overflow-y: auto;/, "the library dialog is a scroll container...");
  assert.doesNotMatch(library, /scrollbar/, "...that takes the shared style, not its own");
});

test("the shared scrollbar thumb keeps 3:1 against its track in both themes", () => {
  const themes = readThemeTokens(foundation);
  for (const name of ["light", "dark"] as const) {
    for (const pair of SCROLLBAR_PAIRS) {
      const ratio = ratioFor(themes[name], pair.foreground, pair.background);
      assert.ok(ratio >= pair.minimum, `${name}: ${pair.label} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("in one-column mode the Capture footer is sticky to the bottom of the window", () => {
  const narrow = mediaBlock(theme, "(max-width: 850px)");
  assert.match(narrow, /\.profile-footer \{[^}]*position: sticky;[^}]*bottom: 0;/);
  assert.match(narrow, /\.profile-panel \{ display: contents; \}/, "the panel is dissolved so the grid is the sticky containing block");
  assert.match(narrow, /\.capture-grid \{ grid-template-columns: minmax\(0, 1fr\);/);
  const wide = mediaBlock(theme, "(min-width: 851px)");
  assert.doesNotMatch(wide, /position: sticky/, "the two-column layout keeps its fixed footer instead");
  assert.match(wide, /\.profile-body \{[^}]*overflow-y: auto;/);
});

function renderConsole() {
  const source = read("../src/features/analysis/CaptureConsole.tsx");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  const overrides: Record<string, unknown> = {
    "./VisualFidelitySelector": { VisualFidelitySelector: () => null },
    "../screenshot/ScreenshotInput": { ScreenshotInput: () => null },
    "../screenshot/useScreenshot": { useScreenshot: () => ({ screenshot: null, status: "EMPTY", error: null, selectFiles: () => {}, removeScreenshot: () => {} }) },
    "./useAnalysis": { useAnalysis: () => ({ state: { status: "IDLE", screenshot: null, result: null, error: null, errorRequestId: null, errorRetryAfterSeconds: null, context: null },
      model: { analyze: async () => {}, cancel: () => {}, setScreenshot: () => {}, generateArtifact: () => null } }) },
  };
  runInNewContext(code, { exports, require: (name: string) => {
    if (name in overrides) return overrides[name];
    if (name.endsWith("/useLabels")) return { useLabels: () => ({ t: i18n.t.bind(i18n), message: (value: string) => value }) };
    if (name.includes("generationProfileModel")) return generationProfileModule;
    if (name.includes("analysisModel")) return analysisModelModule;
    return require(name);
  } });
  return renderToStaticMarkup(React.createElement(exports.CaptureConsole, { onGenerated() {} }));
}

test("the narrow stepper keeps five numbered steps on one row and shows only the current label", async () => {
  await i18n.changeLanguage("es");
  const html = renderConsole();
  const stepper = html.slice(html.indexOf('<ol class="workflow-strip"'), html.indexOf("</ol>"));
  assert.equal((stepper.match(/<li /g) ?? []).length, 5);
  assert.equal((stepper.match(/class="workflow-number"/g) ?? []).length, 5);
  for (const label of ["Entrada", "Perfil", "Análisis", "Resultado", "Exportación"]) {
    assert.match(stepper, new RegExp(`<span>${label}</span>`), `${label} stays in the markup (and so in the accessibility tree)`);
  }
  const narrow = mediaBlock(theme, "(max-width: 850px)");
  assert.match(narrow, /\.workflow-strip \{ display: flex; justify-content: space-between;/, "one row, no wrapping grid");
  assert.match(narrow, /\.workflow-strip li:not\(\[data-current="true"\]\) > span:last-child \{[^}]*clip-path: inset\(50%\);/, "only the current label is visible");
  for (const query of ["(max-width: 560px)", "(max-width: 440px)"]) {
    assert.doesNotMatch(mediaBlock(theme, query), /\.workflow-strip \{[^}]*grid-template-columns/, `${query} does not re-split the stepper`);
  }
});

function renderInput(controller: Record<string, unknown>) {
  const source = read("../src/features/screenshot/ScreenshotInput.tsx");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === "lucide-react") return lucide;
    if (name.endsWith("/useLabels")) return { useLabels: () => ({ t: i18n.t.bind(i18n), message: (value: string) => value }) };
    if (name.includes("ScreenshotPreview")) return { ScreenshotPreview: () => React.createElement("div", { className: "mock-preview" }) };
    if (name.endsWith("/validation")) return { MAX_SCREENSHOT_SIZE_LABEL: "10 MB", SCREENSHOT_ACCEPT: ".png" };
    return require(name);
  } });
  return renderToStaticMarkup(React.createElement(exports.ScreenshotInput, { controller: { screenshot: null, status: "EMPTY", error: null, setDragging() {}, selectFiles() {}, removeScreenshot() {}, ...controller } }));
}

test("the empty drop zone groups icon, title, description and button; the note sits below; no visible duplicate status", async () => {
  await i18n.changeLanguage("es");
  const html = renderInput({});
  const zone = html.slice(html.indexOf('<div class="empty-workspace"'), html.indexOf('<div class="screenshot-controls"'));
  assert.match(zone, /class="upload-mark"/);
  assert.match(zone, /<h3>Arrastra tu interfaz aquí\.<\/h3>/);
  assert.match(zone, /class="empty-description"/);
  assert.match(zone, /<button class="action-button"[^>]*aria-describedby="screenshot-help"[^>]*>.*Seleccionar imagen<\/button>/, "the select button is inside the centred block");
  const controls = html.slice(html.indexOf('<div class="screenshot-controls"'), html.indexOf('<div class="screenshot-feedback"'));
  assert.doesNotMatch(controls, /<button/, "below the zone there is only the note");
  assert.match(controls, /<p id="screenshot-help" class="input-help">PNG, JPEG o WEBP · Máximo 10 MB\./);

  const feedback = html.slice(html.indexOf('<div class="screenshot-feedback"'));
  assert.match(feedback, /<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">Sin captura seleccionada<\/p>/, "kept as a visually hidden live region");
  assert.equal((feedback.match(/<p /g) ?? []).length, 1, "nothing else is visible without an error");

  const ready = renderInput({ screenshot: { file: new File([], "a.png"), name: "a.png", size: 1, format: "PNG", width: 1, height: 1, url: "blob:x" }, status: "READY" });
  assert.match(ready, /<p class="sr-only" role="status"[^>]*>Captura lista<\/p>/);
  assert.doesNotMatch(ready.slice(0, ready.indexOf('<div class="screenshot-feedback"')), /Captura lista/, "the visible tree no longer says it");
  assert.match(ready, /class="screenshot-controls">.*Reemplazar captura.*Eliminar captura/, "with an image, Replace/Remove sit under the preview");

  const failed = renderInput({ error: "No se pudo aceptar", status: "ERROR" });
  assert.match(failed, /<p role="alert" class="input-error">/, "errors stay visible");
  const css = theme;
  assert.match(css, /\.empty-workspace \{[^}]*align-items: center;[^}]*justify-content: center;/);
  assert.match(mediaBlock(css, "(min-width: 851px)"), /\.screenshot-input \.empty-workspace \{ flex: 0 1 clamp\(230px, 34vh, 340px\);/, "the empty zone is a compact, bounded block; the note follows it");
});

test("the disabled primary action stays legible: label at 3:1 or more against its fill in both themes", () => {
  const themes = readThemeTokens(foundation);
  for (const name of ["light", "dark"] as const) {
    for (const pair of DISABLED_PAIRS) {
      const ratio = ratioFor(themes[name], pair.foreground, pair.background);
      assert.ok(ratio >= 3, `${name}: ${pair.label} is ${ratio.toFixed(2)}:1`);
    }
  }
  const rule = foundation.match(/\.primary-action:disabled \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /opacity: 1;/, "no opacity wash-out");
  assert.match(rule, /background: var\(--color-disabled-bg\);/);
  assert.match(rule, /color: var\(--color-disabled-fg\);/);
  assert.match(rule, /box-shadow: none;/, "flat, so it still reads as inactive");
});

test("the code editor is as tall as its content so the page is the only vertical scroller", () => {
  const source = read("../src/features/editor/CodeEditor.tsx");
  assert.doesNotMatch(source, /height="60vh"/);
  assert.match(source, /getContentHeight\(\)/);
  assert.match(source, /onDidContentSizeChange\(fit\)/);
  assert.match(source, /alwaysConsumeMouseWheel: false/);
  assert.match(read("../src/features/preview/preview.css"), /\.editor-split \{[^}]*align-items: start;/, "the preview does not stretch to the editor's height");
});

test("the reference image is the compact side of the row (a third) with a bounded preview; one column is untouched", () => {
  const grid = theme.match(/\.capture-grid \{ display: grid; grid-template-columns: ([^;]*);/)?.[1] ?? "";
  assert.equal(grid, "minmax(250px, 1fr) minmax(0, 2fr)", "1fr : 2fr leaves the reference panel about a third and the options two thirds");
  assert.match(theme, /@media \(max-width: 1050px\) \{[\s\S]*?\.capture-grid \{ grid-template-columns: minmax\(240px, 1fr\) minmax\(0, 2fr\);/);
  const wide = mediaBlock(theme, "(min-width: 851px)");
  assert.match(wide, /\.screenshot-input \{ align-self: start; max-height: 100%; \}/, "as tall as its content, never taller than the row");
  assert.match(wide, /\.screenshot-input \.screenshot-image-area \{ flex: 0 1 clamp\(170px, 34vh, 360px\); min-height: 96px; \}/, "bounded preview height");
  assert.match(theme, /\.screenshot-image-area img \{[^}]*object-fit: contain;/, "the preview keeps its proportions");
  // Narrow panel: the name takes a line of its own and the facts share the next one; one column goes back to a single row.
  assert.match(theme, /\.screenshot-filename \{ flex: 1 1 100%;/);
  const narrow = mediaBlock(theme, "(max-width: 850px)");
  assert.match(narrow, /\.capture-grid \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(narrow, /\.profile-footer \{[^}]*position: sticky;[^}]*bottom: 0;/, "the sticky footer of the one-column mode is intact");
  assert.match(narrow, /\.screenshot-metadata \{ flex-wrap: nowrap; \}/);
});
