import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { useLabels } from "../src/features/preferences/useLabels.ts";
import { activeFile, createEditorModel, editorEmptyMessage, editorLanguage } from "../src/features/editor/editorModel.ts";
import type { GeneratedProject } from "../src/features/generation/generatedProject.ts";

function project(): GeneratedProject {
  return { target: "react-tailwind", generatorVersion: "1", files: [
    { path: "src/App.tsx", content: "export default function App() {}", language: "typescript" },
    { path: "src/generated/GeneratedInterface.tsx", content: "export default function GeneratedInterface() {}", language: "typescript" },
  ] };
}
test("default selection prefers GeneratedInterface and explorer ordering is deterministic", () => {
  const model = createEditorModel();
  const input = project();
  input.files.reverse();
  model.setProject(input);
  assert.equal(model.getSnapshot().activePath, "src/generated/GeneratedInterface.tsx");
  assert.deepEqual(model.getSnapshot().files.map((file) => file.path), ["src/App.tsx", "src/generated/GeneratedInterface.tsx"]);
});
test("default fallback preserves first supplied file, even when explorer is sorted", () => {
  const input = project();
  input.files[1]!.path = "a.tsx";
  const model = createEditorModel();
  model.setProject(input);
  assert.equal(model.getSnapshot().activePath, "src/App.tsx");
});
test("switching files exposes active content and language", () => {
  const model = createEditorModel();
  model.setProject(project());
  model.select("src/App.tsx");
  assert.deepEqual(activeFile(model.getSnapshot()), project().files[0]);
});
test("editing is immutable, isolated per file and survives switching and empty content", () => {
  const model = createEditorModel();
  const original = project();
  const before = structuredClone(original);
  model.setProject(original);
  model.edit("Edited interface");
  model.select("src/App.tsx");
  assert.equal(activeFile(model.getSnapshot())?.content, before.files[0]!.content);
  model.edit("");
  model.select("src/generated/GeneratedInterface.tsx");
  assert.equal(activeFile(model.getSnapshot())?.content, "Edited interface");
  model.select("src/App.tsx");
  assert.equal(activeFile(model.getSnapshot())?.content, "");
  assert.deepEqual(original, before);
});
test("reset restores all original files and retains active selection", () => {
  const model = createEditorModel();
  model.setProject(project());
  model.edit("one");
  model.select("src/App.tsx");
  model.edit("two");
  model.reset();
  assert.equal(activeFile(model.getSnapshot())?.content, project().files[0]!.content);
  assert.equal(model.getSnapshot().drafts.size, 0);
  model.select("src/generated/GeneratedInterface.tsx");
  assert.equal(activeFile(model.getSnapshot())?.content, project().files[1]!.content);
});
test("new projects replace previous drafts and reset source is an independent snapshot", () => {
  const model = createEditorModel();
  const original = project();
  model.setProject(original);
  original.files[1]!.content = "mutated externally";
  model.edit("draft");
  model.reset();
  assert.equal(activeFile(model.getSnapshot())?.content, project().files[1]!.content);
  model.edit("another draft");
  model.setProject(project());
  assert.equal(model.getSnapshot().drafts.size, 0);
});
test("language aliases map deterministically with plaintext fallback", () => {
  for (const language of ["typescript", "typescriptreact", "TSX"]) assert.equal(editorLanguage(language), "typescript");
  for (const language of ["javascript", "javascriptreact", "JSX"]) assert.equal(editorLanguage(language), "javascript");
  for (const language of ["css", "html", "json", "plaintext"]) assert.equal(editorLanguage(language), language);
  assert.equal(editorLanguage("unknown"), "plaintext");
});
test("no project, no files and missing selection have distinct Spanish empty states", () => {
  const model = createEditorModel();
  assert.match(editorEmptyMessage(model.getSnapshot())!, /Todavía no hay código/);
  model.setProject({ ...project(), files: [] });
  assert.match(editorEmptyMessage(model.getSnapshot())!, /no contiene archivos/);
  model.setProject(project());
  model.select("missing.tsx");
  assert.equal(activeFile(model.getSnapshot()), null);
  assert.match(editorEmptyMessage(model.getSnapshot())!, /Selecciona un archivo/);
  model.edit("ignored");
  assert.equal(model.getSnapshot().drafts.size, 0);
});
test("copy sends active edited code and reports success in Spanish", async () => {
  const model = createEditorModel();
  model.setProject(project());
  model.edit("copied code");
  let copied = "";
  await model.copy(async (value) => { copied = value; });
  assert.equal(copied, "copied code");
  assert.equal(model.getSnapshot().feedback, "Código copiado.");
});
test("copy handles denied or missing clipboard safely and skips missing active files", async () => {
  const model = createEditorModel();
  model.setProject(project());
  await model.copy(async () => { throw new Error("PRIVATE OS ERROR"); });
  assert.match(model.getSnapshot().feedback, /No se pudo copiar/);
  assert.doesNotMatch(model.getSnapshot().feedback, /PRIVATE/);
  await model.copy(() => { throw new TypeError("Clipboard unavailable"); });
  assert.match(model.getSnapshot().feedback, /No se pudo copiar/);
  model.select("missing");
  await model.copy(async () => { assert.fail("No file should be copied"); });
});
test("late clipboard feedback cannot overwrite a different active file or project", async () => {
  const model = createEditorModel();
  model.setProject(project());
  let complete!: () => void;
  const pending = model.copy(() => new Promise<void>((resolve) => { complete = resolve; }));
  model.select("src/App.tsx");
  complete();
  await pending;
  assert.equal(model.getSnapshot().feedback, "");
});
test("subscriptions notify on edits and release listeners on unsubscribe", () => {
  const model = createEditorModel();
  let calls = 0;
  const unsubscribe = model.subscribe(() => { calls++; });
  model.setProject(project());
  model.edit("change");
  assert.equal(calls, 2);
  unsubscribe();
  model.reset();
  assert.equal(calls, 2);
});
test("file explorer renders every path, selection and safe long path text", () => {
  const source = readFileSync(new URL("../src/features/editor/FileExplorer.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { FileExplorer?: Parameters<typeof createElement>[0] } = {};
  const require = createRequire(import.meta.url);
  runInNewContext(compiled, { exports, require: (name: string) => name === "../preferences/useLabels" ? { useLabels } : require(name) });
  const files = project().files;
  files.push({ path: "src/" + "long/".repeat(20) + "<script>.tsx", content: "", language: "typescript" });
  const html = renderToStaticMarkup(createElement(exports.FileExplorer!, { files, activePath: files[0]!.path, onSelect() {} }));
  for (const file of files.slice(0, 2)) assert.ok(html.includes(file.path));
  assert.match(html, /aria-current="true"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
test("editor state requires no network or analysis calls", (context) => {
  context.mock.method(globalThis, "fetch", () => { throw new Error("No network allowed"); });
  const model = createEditorModel();
  model.setProject(project());
  model.edit("local");
  model.reset();
  assert.equal(editorEmptyMessage(model.getSnapshot()), null);
});
