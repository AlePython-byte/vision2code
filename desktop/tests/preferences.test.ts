import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createInstance } from "i18next";
import { createPreferences, preferences, PREFERENCES_KEY } from "../src/features/preferences/preferences.ts";
import { es, en, messageKeys } from "../src/features/preferences/resources.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { createEditorModel, activeFile } from "../src/features/editor/editorModel.ts";

function storage() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
}
test("first launch defaults to light and Spanish regardless of OS theme", () => {
  assert.deepEqual(createPreferences().getSnapshot(), { theme: "light", language: "es" });
});
test("theme and language switch immediately and persist only preferences", () => {
  const local = storage();
  const model = createPreferences(local);
  let notifications = 0;
  model.subscribe(() => { notifications++; });
  model.set({ theme: "dark" });
  assert.equal(model.getSnapshot().theme, "dark");
  model.set({ language: "en" });
  assert.equal(notifications, 2);
  assert.deepEqual(createPreferences(local).getSnapshot(), { theme: "dark", language: "en" });
  assert.deepEqual([...local.entries.keys()], [PREFERENCES_KEY]);
  assert.deepEqual(Object.keys(JSON.parse(local.getItem(PREFERENCES_KEY)!)), ["theme", "language"]);
});
test("corrupt, unsupported and unavailable storage fail safely", () => {
  for (const saved of ["{", "null", '{"theme":"system","language":"fr"}']) {
    const local = storage(); local.setItem(PREFERENCES_KEY, saved);
    assert.deepEqual(createPreferences(local).getSnapshot(), { theme: "light", language: "es" });
  }
  const model = createPreferences({ getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } });
  model.set({ theme: "dark" });
  assert.equal(model.getSnapshot().theme, "dark");
});
test("all bundled keys exist in both languages with matching interpolation variables", () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
  for (const key of Object.keys(es) as (keyof typeof es)[]) {
    assert.ok(es[key].length && en[key].length);
    assert.deepEqual(es[key].match(/{{\w+}}/g), en[key].match(/{{\w+}}/g), key);
  }
});
test("core screens and retained errors translate at runtime without changing data", async () => {
  const instance = createInstance();
  await instance.init({ resources: { es: { translation: es }, en: { translation: en } }, lng: "es", initAsync: false });
  assert.equal(instance.t("captureTitle"), "Consola de captura");
  await instance.changeLanguage("en");
  assert.equal(instance.t("captureTitle"), "Capture console");
  assert.equal(instance.t("editorTitle"), "Code workspace");
  assert.equal(instance.t(messageKeys["Código copiado."]!), "Code copied.");
  assert.equal(instance.t(messageKeys["Análisis cancelado. Puedes volver a intentarlo."]!), "Analysis cancelled. You can try again.");
  assert.equal(instance.t("selectedScreenshot", { name: "captura.png" }), "Selected screenshot: captura.png");
});
test("global preference switching updates localization and preserves editor drafts", () => {
  const model = createEditorModel();
  model.setProject({ target: "react-tailwind", generatorVersion: "1", files: [{ path: "src/App.tsx", content: "original", language: "typescript" }] });
  model.edit("// contenido que no se traduce");
  preferences.set({ theme: "dark", language: "en" });
  assert.equal(i18n.t("login"), "Sign in");
  assert.equal(activeFile(model.getSnapshot())?.content, "// contenido que no se traduce");
  preferences.set({ theme: "light", language: "es" });
});

function loadComponent(file: string, overrides: Record<string, unknown> = {}) {
  const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, { exports, require: (name: string) => {
    if (name in overrides) return overrides[name];
    if (name.endsWith("/useLabels") || name === "./useLabels") return { useLabels: () => ({ t: i18n.t.bind(i18n) }) };
    if (name.endsWith("/preferences") || name === "./preferences") return { preferences };
    if (name.endsWith("/previewModel") || name === "./previewModel") return { createPreviewModel: () => ({ setProject: () => {}, render: () => Promise.resolve(), subscribe: () => () => {}, getSnapshot: () => ({ status: "EMPTY" }) }) };
    if (name.endsWith("/PreviewPanel") || name === "./PreviewPanel") return { PreviewPanel: () => null };
    if (name.endsWith("/previewSync") || name === "./previewSync") return { syncEditorToPreview: () => ({ dispose: () => {}, flush: async () => {}, isPending: () => false }) };
    return require(name);
  } });
  return exports;
}
test("login renders labeled fields, disabled authentication, and explicit demo entry", () => {
  const controls = loadComponent("preferences/PreferenceControls.tsx");
  const { Login } = loadComponent("login/Login.tsx", { "../preferences/PreferenceControls": controls });
  const html = renderToStaticMarkup(React.createElement(Login, { onDemo() {} }));
  assert.match(html, /type="email"/);
  assert.match(html, /type="password"/);
  assert.match(html, /aria-label="Mostrar contraseña"/);
  assert.match(html, /Entrar a la demostración local/);
  assert.match(html, /autenticación todavía no está disponible/);
  assert.match(html, /type="submit"[^>]*disabled/);
  assert.match(html, /Español/);
  assert.match(html, /English/);
});
test("password visibility action toggles the real field type and accessible name", () => {
  let visible = false;
  const { Login } = loadComponent("login/Login.tsx", {
    react: { ...React, useState: () => [visible, (value: boolean) => { visible = value; }] },
    "../preferences/PreferenceControls": { PreferenceControls: () => null },
  });
  function flatten(element: any): any[] {
    if (!element || typeof element !== "object") return [];
    return [element, ...React.Children.toArray(element.props?.children).flatMap(flatten)];
  }
  let nodes = flatten(Login({ onDemo() {} }));
  assert.equal(nodes.find(n => n.props?.id === "login-password").props.type, "password");
  nodes.find(n => n.props?.["aria-label"] === "Mostrar contraseña").props.onClick();
  nodes = flatten(Login({ onDemo() {} }));
  assert.equal(nodes.find(n => n.props?.id === "login-password").props.type, "text");
  assert.ok(nodes.find(n => n.props?.["aria-label"] === "Ocultar contraseña"));
});
test("theme and language selectors have visible accessible labels in English", () => {
  preferences.set({ language: "en" });
  const { PreferenceControls } = loadComponent("preferences/PreferenceControls.tsx");
  const html = renderToStaticMarkup(React.createElement(PreferenceControls));
  assert.match(html, /Theme/); assert.match(html, /Language/);
  assert.match(html, /aria-label="Interface preferences"/);
  assert.match(html, /aria-hidden="true"/);
  preferences.set({ language: "es" });
});
test("preferences and translation resources require no external service", (context) => {
  context.mock.method(globalThis, "fetch", () => { throw new Error("Network forbidden"); });
  const model = createPreferences(storage());
  model.set({ theme: "dark", language: "en" });
  assert.ok(en.demoEntry);
});

test("settings screen renders appearance, language, telemetry and reset controls", () => {
  preferences.set({ theme: "light", language: "es" });
  const { SettingsScreen } = loadComponent("settings/SettingsScreen.tsx");
  const html = renderToStaticMarkup(React.createElement(SettingsScreen));
  assert.match(html, /id="settings-workspace"/);
  assert.match(html, /Configuración del entorno/);
  assert.match(html, /Modo visual/);
  assert.match(html, /Idioma del entorno/);
  assert.match(html, /Telemetría de consola/);
  assert.match(html, /Modo claro/);
  assert.match(html, /Modo oscuro/);
  assert.match(html, /Español/);
  assert.match(html, /English/);
  assert.match(html, /aria-label="Selección de modo visual"/);
  assert.match(html, /aria-label="Selección de idioma de la consola"/);
  assert.match(html, /Restablecer valores predeterminados/);
  assert.match(html, /ONLINE/);
});

test("settings screen controls switch theme and language immediately and support reset", () => {
  preferences.set({ theme: "light", language: "es" });
  let statusMessage: string | null = null;
  const { SettingsScreen } = loadComponent("settings/SettingsScreen.tsx", {
    react: {
      ...React,
      useSyncExternalStore: (_subscribe: any, getSnapshot: any) => getSnapshot(),
      useState: (initial: any) => [
        statusMessage ?? (typeof initial === "function" ? initial() : initial),
        (v: any) => { statusMessage = typeof v === "function" ? v(statusMessage) : v; },
      ],
    },
  });
  function flatten(element: any): any[] {
    if (!element || typeof element !== "object") return [];
    return [element, ...React.Children.toArray(element.props?.children).flatMap(flatten)];
  }

  // Initial state: Light and Spanish
  let nodes = flatten(SettingsScreen());
  const radios = nodes.filter(n => n.props?.role === "radio");
  assert.equal(radios.length, 4);

  const lightBtn = radios[0];
  const darkBtn = radios[1];
  const esBtn = radios[2];
  const enBtn = radios[3];

  assert.equal(lightBtn?.props?.["aria-checked"], true);
  assert.equal(darkBtn?.props?.["aria-checked"], false);
  assert.equal(esBtn?.props?.["aria-checked"], true);
  assert.equal(enBtn?.props?.["aria-checked"], false);

  // Switch to Dark
  darkBtn.props.onClick();
  assert.equal(preferences.getSnapshot().theme, "dark");
  nodes = flatten(SettingsScreen());
  const updatedRadios = nodes.filter(n => n.props?.role === "radio");
  assert.equal(updatedRadios[0].props["aria-checked"], false);
  assert.equal(updatedRadios[1].props["aria-checked"], true);

  // Switch to English
  enBtn.props.onClick();
  assert.equal(preferences.getSnapshot().language, "en");
  assert.equal(i18n.language, "en");

  // Reset to defaults
  nodes = flatten(SettingsScreen());
  const resetBtn = nodes.find(n => n.props?.["aria-label"] === "Reset to defaults");
  assert.ok(resetBtn);
  resetBtn.props.onClick();
  assert.equal(preferences.getSnapshot().theme, "light");
  assert.equal(preferences.getSnapshot().language, "es");
});

test("application shell provides Settings navigation and removes redundant shell-preferences", () => {
  let activeView = "capture";
  const { ApplicationShell } = loadComponent("workspace/ApplicationShell.tsx", {
    react: { ...React, useEffect: () => {}, useState: (initial: any) => typeof initial === "function" ? [initial(), () => {}] : [activeView, (v: string) => { activeView = v; }] },
    "./Workspace": { Workspace: () => React.createElement("div", { id: "workspace" }) },
    "../editor/EditorWorkspace": { EditorWorkspace: () => React.createElement("div", { id: "code-workspace" }) },
    "../settings/SettingsScreen": { SettingsScreen: () => React.createElement("main", { id: "settings-workspace" }) },
    "../editor/editorModel": { createEditorModel: () => ({}) },
  });

  function flatten(element: any): any[] {
    if (!element || typeof element !== "object") return [];
    return [element, ...React.Children.toArray(element.props?.children).flatMap(flatten)];
  }

  // Initial view is capture
  let nodes = flatten(ApplicationShell({ onLogin() {} }));
  const skipLink = nodes.find(n => n.props?.className === "skip-link");
  assert.equal(skipLink.props.href, "#workspace");

  // Redundant shell-preferences is removed from ApplicationShell
  assert.equal(nodes.find(n => n.props?.className === "shell-preferences"), undefined);

  // Find settings navigation item
  const settingsNavItem = nodes.find(n => n.props?.className === "navigation-item" && n.props?.children?.some?.((c: any) => c?.props?.children === "Configuración"));
  assert.ok(settingsNavItem);
  assert.equal(settingsNavItem.props["aria-current"], undefined);

  // Navigate to settings
  settingsNavItem.props.onClick();
  assert.equal(activeView, "settings");

  // Re-render in settings view
  nodes = flatten(ApplicationShell({ onLogin() {} }));
  const updatedSkipLink = nodes.find(n => n.props?.className === "skip-link");
  assert.equal(updatedSkipLink.props.href, "#settings-workspace");

  const activeSettingsNav = nodes.find(n => n.props?.className === "navigation-item" && n.props?.children?.some?.((c: any) => c?.props?.children === "Configuración"));
  assert.equal(activeSettingsNav.props["aria-current"], "page");

  // Settings screen is rendered in the tree via renderToStaticMarkup
  const html = renderToStaticMarkup(React.createElement(ApplicationShell, { onLogin() {} }));
  assert.match(html, /id="settings-workspace"/);
});

test("preference changes survive navigation between settings and workspace and persist", () => {
  const local = storage();
  const model = createPreferences(local);
  model.set({ theme: "dark", language: "en" });
  assert.deepEqual(model.getSnapshot(), { theme: "dark", language: "en" });

  // Simulate navigating back and forth in application
  let activeView = "settings";
  const { ApplicationShell } = loadComponent("workspace/ApplicationShell.tsx", {
    react: { ...React, useEffect: () => {}, useState: (initial: any) => typeof initial === "function" ? [initial(), () => {}] : [activeView, (v: string) => { activeView = v; }] },
    "./Workspace": { Workspace: () => React.createElement("div", { id: "workspace" }) },
    "../editor/EditorWorkspace": { EditorWorkspace: () => React.createElement("div", { id: "code-workspace" }) },
    "../settings/SettingsScreen": { SettingsScreen: () => React.createElement("main", { id: "settings-workspace" }) },
    "../editor/editorModel": { createEditorModel: () => ({}) },
    "../preferences/preferences": { preferences: model },
  });

  // Switch to capture
  activeView = "capture";
  let html = renderToStaticMarkup(React.createElement(ApplicationShell, { onLogin() {} }));
  assert.match(html, /id="workspace"/);
  assert.equal(model.getSnapshot().theme, "dark");
  assert.equal(model.getSnapshot().language, "en");

  // Reloaded preferences from same storage maintain exact values
  const reloaded = createPreferences(local);
  assert.deepEqual(reloaded.getSnapshot(), { theme: "dark", language: "en" });
});
