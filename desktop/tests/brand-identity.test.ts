import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import { requireLocalSource } from "./source-loader.ts";

const root = new URL("../", import.meta.url);

function load(file: string, overrides: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync(new URL("src/features/" + file, root), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name in overrides) return overrides[name];
      if (name === "lucide-react") return lucide;
      return requireLocalSource(file, name, require) ?? require(name);
    },
  });
  return exports;
}

test("BrandMark is decorative and uses currentColor", () => {
  const { BrandMark } = load("brand/BrandMark.tsx", {});
  const html = renderToStaticMarkup(React.createElement(BrandMark));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /stroke="currentColor"/);
  assert.doesNotMatch(html, /#[0-9a-f]{3,8}/i);
});

test("the sidebar and the login both render the BrandMark", () => {
  const shell = readFileSync(new URL("src/features/workspace/ApplicationShell.tsx", root), "utf8");
  const login = readFileSync(new URL("src/features/login/Login.tsx", root), "utf8");
  for (const source of [shell, login]) {
    assert.match(source, /import \{ BrandMark \} from "\.\.\/brand\/BrandMark"/);
    assert.match(source, /<BrandMark \/>/);
  }
  const { ApplicationShell } = load("workspace/ApplicationShell.tsx", {
    "./Workspace": { Workspace: () => null },
    "../editor/EditorWorkspace": { EditorWorkspace: () => null },
    "../settings/SettingsScreen": { SettingsScreen: () => null },
    "../editor/editorModel": { createEditorModel: () => ({}) },
    "./useLabels": { useLabels: () => ({ t: (key: string) => key }) },
    "../preferences/useLabels": { useLabels: () => ({ t: (key: string) => key }) },
  });
  const html = renderToStaticMarkup(React.createElement(ApplicationShell, { onLogin() {} }));
  assert.match(html, /class="brand-mark"[^>]*><svg class="brand-mark-symbol"/);
});

test("every icon referenced by tauri.conf.json exists and the installer uses the .ico", () => {
  const config = JSON.parse(readFileSync(new URL("src-tauri/tauri.conf.json", root), "utf8"));
  const icons: string[] = [...config.bundle.icon, config.bundle.windows.nsis.installerIcon];
  assert.equal(config.bundle.windows.nsis.installerIcon, "icons/icon.ico");
  for (const icon of icons) assert.ok(existsSync(new URL("src-tauri/" + icon, root)), `${icon} is missing`);
  assert.ok(existsSync(new URL("src-tauri/icons/source/logo.svg", root)));
});

test("the .ico holds several sizes and the favicon is the single-source logo", () => {
  const ico = readFileSync(new URL("src-tauri/icons/icon.ico", root));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 4, "icon.ico should embed several sizes");
  const logo = readFileSync(new URL("src-tauri/icons/source/logo.svg", root), "utf8");
  assert.equal(readFileSync(new URL("public/logo.svg", root), "utf8"), logo);
  assert.match(readFileSync(new URL("index.html", root), "utf8"), /rel="icon"[^>]*href="\/logo\.svg"/);
});
