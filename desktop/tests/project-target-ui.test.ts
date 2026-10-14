import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import type { GenerationDetail } from "@vision2code/contracts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createGenerationArtifact } from "../src/features/generation/generationArtifact.ts";
import { createGenerationSessionModel } from "../src/features/generation/generationSessionModel.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import type { ProjectsClient } from "../src/features/projects/projectsClient.ts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import * as actions from "../src/features/projects/projectTargetActions.ts";
import { createToastModel } from "../src/features/feedback/toastModel.ts";
import { fakeScheduler } from "./fake-scheduler.ts";
import { deferred, fakeClient, generationOne, projectA, screenshot, summaryA, summaryB, uiSchemaFixture } from "./generation-fixtures.ts";

function loadComponent(file: string, language: "es" | "en", overrides: Record<string, unknown> = {}) {
  const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name in overrides) return overrides[name];
      if (name === "lucide-react") return lucide;
      if (name.endsWith("/useLabels")) return { useLabels: () => ({ t: i18n.getFixedT(language) }) };
      if (name.endsWith("/projectTargetActions")) return actions;
      return require(name);
    },
  });
  return exports;
}

function components(language: "es" | "en") {
  const { ProjectTargetPanel } = loadComponent("projects/ProjectTargetPanel.tsx", language);
  const { ToastViewport } = loadComponent("feedback/ToastViewport.tsx", language);
  return { ProjectTargetPanel, ToastViewport };
}

function models(overrides: Partial<ProjectsClient> = {}) {
  const { client } = fakeClient(overrides);
  const projects = createProjectsModel(client);
  const session = createGenerationSessionModel({ client, projects, loadProject: () => {} });
  return { projects, session };
}

function artifact(targetProjectId: string | null = projectA) {
  return createGenerationArtifact({ uiSchema: uiSchemaFixture, generatedProject: generateReactProject(uiSchemaFixture), fidelity: "balanced", screenshot: screenshot(), targetProjectId });
}

function render(language: "es" | "en", m: ReturnType<typeof models>, analysisTargetProjectId: string | null | undefined = undefined) {
  const { ProjectTargetPanel } = components(language);
  return renderToStaticMarkup(React.createElement(ProjectTargetPanel, {
    projects: m.projects, session: m.session, analysisTargetProjectId, onOpenGeneration() {},
  }));
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

test("selector lists only project names, with accessible labels and a local-only option", async () => {
  const m = models();
  await m.projects.loadProjects();
  const html = render("es", m);
  assert.match(html, /<label for="project-target-select"[^>]*>Proyecto seleccionado<\/label>/);
  assert.match(html, /<select id="project-target-select"/);
  assert.match(html, /<option value="" selected="">Sin proyecto \(solo local\)<\/option>/);
  assert.match(html, new RegExp(`<option value="${summaryA.id}">Alpha</option>`));
  assert.match(html, new RegExp(`<option value="${summaryB.id}">Beta</option>`));
  assert.match(html, /<label for="project-create-name"[^>]*>Nombre del nuevo proyecto<\/label>/);
  assert.match(html, /<button type="submit"[^>]*>.*Crear proyecto<\/button>/);
  assert.match(html, /role="group" aria-labelledby="project-target-title"/);
});

test("open latest generation is disabled without a selected project or stored generation", async () => {
  const m = models({ listProjects: async () => [{ ...summaryA, latestGenerationId: generationOne }, summaryB] });
  await m.projects.loadProjects();
  assert.match(render("es", m), /<button type="button" class="action-button secondary-button" disabled="">.*Abrir última generación/);
  await m.projects.selectProject(summaryB.id);
  assert.match(render("es", m), /disabled="">.*Abrir última generación/);
  await m.projects.selectProject(projectA);
  const html = render("en", m);
  assert.doesNotMatch(html, /disabled="">.*Open latest generation/);
  assert.match(html, /Open latest generation/);
});

test("analysis target shows which project a pending result belongs to", async () => {
  const m = models();
  await m.projects.loadProjects();
  assert.ok(render("es", m, projectA).includes(es.analysisTargetProject.replace("{{name}}", "Alpha")));
  assert.ok(render("en", m, null).includes(en.analysisTargetLocal));
  assert.ok(!render("es", m, undefined).includes("Este análisis"));
});

test("inline result line: linked, not linked, and SAVE_FAILED with a compact retry", async () => {
  for (const language of ["es", "en"] as const) {
    const labels = language === "es" ? es : en;
    const saved = models();
    await saved.projects.loadProjects();
    await saved.session.complete(artifact());
    let html = render(language, saved);
    assert.ok(html.includes(`class="project-result-line input-help" data-state="SAVED">${labels.resultLinked.replace("{{name}}", "Alpha")}</p>`));

    const local = models();
    await local.session.complete(artifact(null));
    html = render(language, local);
    assert.ok(html.includes(`data-state="PROJECT_REQUIRED">${labels.resultUnlinked}</p>`));

    let fail = true;
    const retry = deferred<GenerationDetail>();
    const failed = models({ createGeneration: () => fail ? Promise.reject(new ProjectsClientError("SERVER_ERROR")) : retry.promise });
    await failed.projects.loadProjects();
    await failed.session.complete(artifact());
    html = render(language, failed);
    assert.ok(html.includes(` · ${labels.resultUnsaved} · `));
    assert.ok(html.includes(`<button type="button" class="text-button" aria-label="${labels.saveRetry}">${labels.resultRetry}</button>`));
    fail = false;
    void failed.session.retrySave();
    assert.ok(render(language, failed).includes(`aria-label="${labels.saveRetry}" disabled="">${labels.resultRetry}</button>`), "disabled while retrying");
  }
});

test("no status banner remains in the capture flow", async () => {
  const m = models({ createGeneration: async () => { throw new ProjectsClientError("SERVER_ERROR"); } });
  await m.session.complete(artifact());
  const html = render("es", m);
  assert.doesNotMatch(html, /generation-save-status|role="status"/);
  assert.ok(!html.includes(es.saveStatusFailed), "the long failure text lives in the toast");
  assert.ok(!existsSync(new URL("../src/features/generation/GenerationSaveStatus.tsx", import.meta.url)));
  const shell = readFileSync(new URL("../src/features/workspace/ApplicationShell.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(shell, /editorStatus/);
  const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  assert.match(css, /\.project-result-line \{[^}]*height: 1\.6em;[^}]*white-space: nowrap;/, "fixed one-line height");
});

function renderViewport(language: "es" | "en", toasts: ReturnType<typeof createToastModel>) {
  const { ToastViewport } = components(language);
  return renderToStaticMarkup(React.createElement(ToastViewport, { model: toasts }));
}

test("toasts: errors are alerts, everything else is a polite status; icon + text always", () => {
  const toasts = createToastModel(fakeScheduler());
  toasts.show({ key: "a", tone: "success", eyebrow: "toastEyebrowSaved", message: "saveStatusSaved", persistent: false, durationMs: 2500 });
  toasts.show({ key: "b", tone: "progress", eyebrow: "toastEyebrowSaving", message: "toastSaving", persistent: true });
  toasts.show({ key: "c", tone: "error", eyebrow: "toastEyebrowError", message: "saveStatusNotPersistable", persistent: true });
  const html = renderViewport("es", toasts);
  assert.match(html, /^<div class="toast-viewport">/);
  assert.match(html, /data-tone="success" role="status" aria-live="polite"/);
  assert.match(html, /data-tone="progress" role="status" aria-live="polite"/);
  assert.match(html, /data-tone="error" role="alert" aria-live="assertive"/);
  assert.equal(html.match(/class="toast-lamp" aria-hidden="true"><svg/g)?.length, 3);
  assert.match(html, /lucide-check/);
  assert.match(html, /lucide-loader[^"]*toast-spin|toast-spin[^"]*lucide-loader/);
  assert.ok(html.includes(es.saveStatusSaved) && html.includes(es.toastSaving) && html.includes(es.toastEyebrowError));
  assert.doesNotMatch(html, /autofocus|tabindex/i, "never moves focus");
});

test("toast buttons are real buttons with localized labels in ES and EN", () => {
  for (const language of ["es", "en"] as const) {
    const labels = language === "es" ? es : en;
    const toasts = createToastModel(fakeScheduler());
    toasts.show({ key: "save", tone: "error", eyebrow: "toastEyebrowError", message: "saveStatusFailed", persistent: true, action: { label: "saveRetry", run() {} } });
    const html = renderViewport(language, toasts);
    assert.ok(html.includes(`<button type="button" class="toast-action" aria-label="${labels.saveRetry}">`));
    assert.ok(html.includes(`<button type="button" class="toast-close" aria-label="${labels.toastDismiss}" title="${labels.toastDismiss}">`));
    assert.ok(html.includes(escape(labels.saveStatusFailed)));
  }
});

test("restore failure toast offers close only", () => {
  const toasts = createToastModel(fakeScheduler());
  toasts.show({ key: "generation-restore", tone: "error", eyebrow: "toastEyebrowHistory", message: "restoreNotFound", persistent: true });
  const html = renderViewport("en", toasts);
  assert.match(html, /role="alert"/);
  assert.ok(html.includes(en.restoreNotFound));
  assert.doesNotMatch(html, /toast-action/);
  assert.match(html, /toast-close/);
});

test("viewport is fixed, out of flow, click-through, and honors reduced motion", () => {
  const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  const rule = (selector: string) => css.split("\n").find((line) => line.trimStart().startsWith(selector + " {")) ?? "";
  const viewport = rule(".toast-viewport");
  assert.match(viewport, /position: fixed;/);
  assert.match(viewport, /top: 16px; right: 24px;/);
  assert.match(viewport, /pointer-events: none;/);
  assert.match(viewport, /width: min\(360px, calc\(100vw - 32px\)\);/);
  assert.match(rule(".toast-capsule"), /pointer-events: auto;/);
  assert.match(css, /@media \(max-width: 560px\) \{\s*\.toast-viewport \{ top: 12px; left: 12px; right: 12px; width: auto; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.toast-capsule, \.toast-spin \{ animation: none !important; \}/);
  for (const line of css.split("\n").filter((item) => /\.toast-/.test(item))) {
    assert.doesNotMatch(line, /position: (static|sticky)|margin-(top|bottom)/, line);
  }
});

test("selector styles reuse console tokens and every new label exists in ES and EN", () => {
  const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  const rules = css.split("\n").filter((line) => /\.project-|\.generation-save-status|\.text-button/.test(line));
  assert.ok(rules.length > 0);
  for (const rule of rules) assert.doesNotMatch(rule, /#[0-9a-f]{3,6}(?![0-9a-f])/i, `hard-coded color outside tokens: ${rule}`);
  for (const key of ["projectTargetTitle", "saveStatusFailed", "saveRetry", "openLatestGeneration", "projectCreateFailed", "restoreFailed"] as const) {
    assert.ok(es[key] && en[key] && es[key] !== en[key], key);
  }
});
