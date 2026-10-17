import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import { i18n } from "../src/features/preferences/i18n.ts";

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
      if (name === "lucide-react") return lucide;
      if (name.endsWith("/ProjectVault")) return { ProjectVault: () => React.createElement("main", { id: "project-vault" }) };
      if (name.endsWith("/useLabels") || name === "./useLabels") return { useLabels: () => ({ t: i18n.t.bind(i18n) }) };
      if (name.endsWith("/previewModel") || name === "./previewModel") {
        return {
          createPreviewModel: () => ({
            setProject: () => {},
            render: () => Promise.resolve(),
            subscribe: () => () => {},
            getSnapshot: () => ({ status: "EMPTY" }),
          }),
        };
      }
      if (name.endsWith("/PreviewPanel") || name === "./PreviewPanel") return { PreviewPanel: () => null };
      if (name.endsWith("/previewSync") || name === "./previewSync") {
        return {
          syncEditorToPreview: () => ({
            dispose: () => {},
            flush: async () => {},
            isPending: () => false,
          }),
        };
      }
      return require(name);
    },
  });
  return exports;
}

test("shell navigation contains semantic landmarks, brand mark, and accessible destinations", () => {
  const { ApplicationShell } = loadComponent("workspace/ApplicationShell.tsx", {
    "./Workspace": { Workspace: () => React.createElement("div", { id: "workspace" }) },
    "../editor/EditorWorkspace": { EditorWorkspace: () => React.createElement("div", { id: "code-workspace" }) },
    "../settings/SettingsScreen": { SettingsScreen: () => React.createElement("main", { id: "settings-workspace" }) },
    "../editor/editorModel": { createEditorModel: () => ({}) },
  });

  const html = renderToStaticMarkup(React.createElement(ApplicationShell, { onLogin() {} }));

  // Semantic nav with aria-label
  assert.match(html, /<nav class="navigation"[^>]*aria-label="Navegación principal"/);
  // Brand mark with accessible label
  assert.match(html, /class="brand-mark"[^>]*aria-label="Espacio de trabajo de Vision2Code"/);
  // Navigation links container
  assert.match(html, /class="navigation-links"/);
  // Primary destinations with accessible title/labels
  assert.match(html, /title="Captura"/);
  assert.match(html, /title="Código"/);
  assert.match(html, /title="Configuración"/);
  // Login destination
  assert.match(html, /aria-label="Ver pantalla de acceso"/);
  // Active state for initial capture view
  assert.match(html, /aria-current="page"/);
});

test("authenticated services land in the Project Vault and mark Projects current", () => {
  const { ApplicationShell } = loadComponent("workspace/ApplicationShell.tsx", {
    "./Workspace": { Workspace: () => React.createElement("div", { id: "workspace" }) },
    "../editor/EditorWorkspace": { EditorWorkspace: () => React.createElement("div", { id: "code-workspace" }) },
    "../settings/SettingsScreen": { SettingsScreen: () => React.createElement("main", { id: "settings-workspace" }) },
    "../editor/editorModel": { createEditorModel: () => ({}) },
  });
  const services = { editorModel: {}, previewModel: {}, projectsModel: {}, generationSession: {}, toasts: {} };
  const html = renderToStaticMarkup(React.createElement(ApplicationShell, { onLogin() {}, services }));
  assert.match(html, /id="project-vault"/);
  assert.match(html, /href="#project-vault"/);
  assert.match(html, /aria-current="page"[^>]*aria-label="Proyectos"/);
  assert.match(html, /<div class="capture-view" hidden=""><div id="workspace"/);
});

test("rail email exposes its full value and compact navigation hides it without a layout-shifting active border", () => {
  const { ApplicationShell } = loadComponent("workspace/ApplicationShell.tsx", {
    "./Workspace": { Workspace: () => React.createElement("div", { id: "workspace" }) },
    "../editor/EditorWorkspace": { EditorWorkspace: () => React.createElement("div", { id: "code-workspace" }) },
    "../settings/SettingsScreen": { SettingsScreen: () => React.createElement("main", { id: "settings-workspace" }) },
    "../editor/editorModel": { createEditorModel: () => ({}) },
  });
  const email = "long.designer@example.com";
  const html = renderToStaticMarkup(React.createElement(ApplicationShell, {
    onLogin() {}, user: { id: "u-rail", email, emailVerified: true },
  }));
  const emailElement = html.match(/<span class="account-email"([^>]*)>/)?.[1];
  assert.ok(emailElement, "The address has its own styled element");
  assert.match(emailElement, /title="long\.designer@example\.com"/);
  assert.doesNotMatch(emailElement, /style=|max-width/);
  assert.match(html, /class="account-email"[^>]*>long\.designer@example\.com<\/span>/);

  const themeCss = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  const foundationCss = readFileSync(new URL("../src/styles/foundation.css", import.meta.url), "utf8");
  const compactStart = themeCss.indexOf("@media (max-width: 760px) and (min-width: 561px)");
  const compactRules = themeCss.slice(compactStart, themeCss.indexOf("@media (max-width: 560px)", compactStart));
  assert.match(compactRules, /\.account-email,\s*\.account-version\s*\{\s*display:\s*none;/);
  assert.match(themeCss, /\.account-email\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/);
  for (const css of [themeCss, foundationCss]) {
    for (const rule of css.matchAll(/\.navigation-item\[aria-current\][^{]*\{([^}]*)\}/g)) {
      assert.doesNotMatch(rule[1] ?? "", /border-left(?:-width|-color)?\s*:/);
    }
  }
});

test("workflow strip maintains semantic ordered list and 5 stage steps", () => {
  const { CaptureConsole } = loadComponent("analysis/CaptureConsole.tsx", {
    "@vision2code/contracts": { OutputStackSchema: { safeParse: () => ({ success: true, data: "REACT_TAILWIND" }) } },
    "./analysisModel": { canAnalyze: () => false },
    "../screenshot/ScreenshotInput": { ScreenshotInput: () => null },
    "../screenshot/useScreenshot": { useScreenshot: () => ({ screenshot: null, status: "EMPTY", selectFiles: () => {}, removeScreenshot: () => {} }) },
    "./useAnalysis": { useAnalysis: () => ({ state: { status: "IDLE" }, model: { cancel: () => {}, setScreenshot: () => {} } }) },
    "./generationProfileModel": { createGenerationProfileModel: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ outputStack: "REACT_TAILWIND", fidelity: "balanced" }) }) },
    "./VisualFidelitySelector": { VisualFidelitySelector: () => null },
  });
  const html = renderToStaticMarkup(React.createElement(CaptureConsole, { onGenerated() {} }));

  // Semantic ordered list
  assert.match(html, /<ol class="workflow-strip"/);
  // Active step
  assert.match(html, /data-current="true"/);
  // All 5 step numbers present
  assert.match(html, /class="workflow-number"[^>]*>01<\/span>/);
  assert.match(html, /class="workflow-number"[^>]*>02<\/span>/);
  assert.match(html, /class="workflow-number"[^>]*>03<\/span>/);
  assert.match(html, /class="workflow-number"[^>]*>04<\/span>/);
  assert.match(html, /class="workflow-number"[^>]*>05<\/span>/);
});

test("responsive breakpoints are defined for desktop, compact, and narrow layouts", () => {
  const themeCss = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");

  // Tier 1 & 2: Compact desktop / tablet (< 850px)
  assert.ok(themeCss.includes("@media (max-width: 850px)"));
  assert.ok(!themeCss.includes("repeat(3, minmax(0, 1fr))") && !themeCss.includes("repeat(2, minmax(0, 1fr))"), "The stepper no longer wraps into uneven rows");
  assert.match(themeCss, /@media \(max-width: 850px\) \{[\s\S]*?\.workflow-strip \{ display: flex; justify-content: space-between;/, "Workflow stays on one row on compact tablet");

  // Compact left rail icon-only transition (561px - 760px) prevents cramped/clipped labels
  assert.ok(themeCss.includes("@media (max-width: 760px) and (min-width: 561px)"));
  assert.ok(
    themeCss.includes(".navigation-item small {\n    display: none;\n  }") ||
    themeCss.includes(".navigation-item small {\n    display: none;"),
    "Navigation item labels collapse to icon-only presentation in compact rail mode"
  );

  // Tier 3: Very narrow layout (< 560px)
  assert.ok(themeCss.includes("@media (max-width: 560px)"));
  assert.ok(themeCss.includes("flex-direction: row;"), "Navigation shifts to horizontal layout at < 560px");
  assert.ok(themeCss.includes("height: 48px;"), "Navigation height is capped at 48px at < 560px");
  assert.ok(themeCss.includes("flex-wrap: nowrap;"), "Navigation prevents vertical stacking wrapping at < 560px");

  // Ultra narrow layout (< 440px)
  assert.ok(themeCss.includes("@media (max-width: 440px)"));

  // Foundation.css does not force wrapping on narrow navigation
  const foundationCss = readFileSync(new URL("../src/styles/foundation.css", import.meta.url), "utf8");
  assert.doesNotMatch(foundationCss, /\.navigation\s*\{\s*flex-wrap:\s*wrap;\s*\}/);
});

test("preview workspace controls have responsive compact rules", () => {
  const previewCss = readFileSync(new URL("../src/features/preview/preview.css", import.meta.url), "utf8");

  // Mobile compact preview controls rule
  assert.ok(previewCss.includes("@media (max-width: 600px)"));
  assert.ok(previewCss.includes(".preview-segment-text { display: none; }"), "Device text labels collapse to compact icons");
});
