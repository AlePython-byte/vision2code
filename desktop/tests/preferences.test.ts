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
    if (name === "./preferences") return { preferences };
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
