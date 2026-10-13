import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import * as sessionModule from "../src/features/generation/generationSessionModel.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import type { ProjectsClient } from "../src/features/projects/projectsClient.ts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import * as actions from "../src/features/projects/projectTargetActions.ts";
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
      if (name.endsWith("/generationSessionModel")) return sessionModule;
      return require(name);
    },
  });
  return exports;
}

function components(language: "es" | "en") {
  const { GenerationSaveStatus } = loadComponent("generation/GenerationSaveStatus.tsx", language);
  const { ProjectTargetPanel } = loadComponent("projects/ProjectTargetPanel.tsx", language, {
    "../generation/GenerationSaveStatus": { GenerationSaveStatus },
  });
  return { GenerationSaveStatus, ProjectTargetPanel };
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

test("save status is localized for saving, saved, failed + retry, project required and non-persistable", async () => {
  for (const language of ["es", "en"] as const) {
    const labels = language === "es" ? es : en;
    const { GenerationSaveStatus } = components(language);
    const renderStatus = (m: ReturnType<typeof models>) => renderToStaticMarkup(React.createElement(GenerationSaveStatus, { session: m.session, projects: m.projects }));

    const pending = deferred<GenerationDetail>();
    const saving = models({ createGeneration: () => pending.promise });
    await saving.projects.loadProjects();
    void saving.session.complete(artifact());
    let html = renderStatus(saving);
    assert.ok(html.includes(escape(labels.saveStatusSaving)), "saving");
    assert.ok(html.includes(labels.resultTargetProject.replace("{{name}}", "Alpha")));
    assert.ok(!html.includes(labels.saveRetry), "no retry during the first attempt");

    const saved = models();
    await saved.session.complete(artifact());
    assert.ok(renderStatus(saved).includes(labels.saveStatusSaved));

    let fail = true;
    const retryPending = deferred<GenerationDetail>();
    const failed = models({ createGeneration: () => fail ? Promise.reject(new ProjectsClientError("SERVER_ERROR")) : retryPending.promise });
    await failed.session.complete(artifact());
    html = renderStatus(failed);
    assert.match(html, /data-state="SAVE_FAILED"/);
    assert.ok(html.includes(escape(labels.saveStatusFailed)));
    assert.match(html, new RegExp(`<button type="button" class="action-button secondary-button">${labels.saveRetry}</button>`));
    fail = false;
    void failed.session.retrySave();
    assert.match(renderStatus(failed), new RegExp(`disabled="">${labels.saveRetry}</button>`), "retry disabled while saving");

    const local = models();
    await local.session.complete(artifact(null));
    html = renderStatus(local);
    assert.ok(html.includes(escape(labels.saveStatusProjectRequired)));
    assert.ok(html.includes(escape(labels.resultTargetLocal)));

    const broken = models();
    await broken.session.complete({ ...artifact(), generatedProject: { target: "react-tailwind", generatorVersion: "1", files: [] } });
    html = renderStatus(broken);
    assert.match(html, /data-state="NOT_PERSISTABLE"/);
    assert.ok(html.includes(escape(labels.saveStatusNotPersistable)));
  }
});

test("restore failure is reported as a localized alert", async () => {
  const m = models({ getGeneration: async () => { throw new ProjectsClientError("NOT_FOUND"); } });
  await m.session.openGeneration(projectA, generationOne);
  const { GenerationSaveStatus } = components("en");
  const html = renderToStaticMarkup(React.createElement(GenerationSaveStatus, { session: m.session, projects: m.projects }));
  assert.match(html, /role="alert"/);
  assert.ok(html.includes(en.restoreNotFound));
});

test("empty session renders no status block", () => {
  const m = models();
  const { GenerationSaveStatus } = components("es");
  assert.equal(renderToStaticMarkup(React.createElement(GenerationSaveStatus, { session: m.session, projects: m.projects })), "");
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
