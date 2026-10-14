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
import * as selectors from "../src/features/projects/vaultSelectors.ts";
import * as vaultActions from "../src/features/projects/vaultActions.ts";
import * as vaultKeyboard from "../src/features/projects/vaultKeyboard.ts";
import { createToastModel } from "../src/features/feedback/toastModel.ts";
import { fakeScheduler } from "./fake-scheduler.ts";
import { deferred, fakeClient, generationOne, projectA, screenshot, summaryA, summaryB, uiSchemaFixture } from "./generation-fixtures.ts";

function loadComponent(file: string, language: "es" | "en") {
  const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === "lucide-react") return lucide;
      if (name.endsWith("/useLabels")) return { useLabels: () => ({ t: i18n.getFixedT(language) }) };
      if (name.endsWith("/i18n")) return { i18n: { language } };
      if (name.endsWith("/projectTargetActions")) return actions;
      if (name.endsWith("/vaultSelectors")) return selectors;
      if (name.endsWith("/vaultActions")) return vaultActions;
      if (name.endsWith("/vaultKeyboard")) return vaultKeyboard;
      if (name.endsWith("/NewProjectDialog")) return { NewProjectDialog: () => null };
      return require(name);
    },
  });
  return exports;
}

function models(overrides: Partial<ProjectsClient> = {}) {
  const { client } = fakeClient(overrides);
  const projects = createProjectsModel(client);
  const session = createGenerationSessionModel({ client, projects, loadProject: () => {} });
  const toasts = createToastModel(fakeScheduler());
  return { projects, session, toasts };
}

function chip(language: "es" | "en", m: ReturnType<typeof models>, target: string | null | undefined = undefined) {
  const { ProjectChip } = loadComponent("projects/ProjectChip.tsx", language);
  return renderToStaticMarkup(React.createElement(ProjectChip, {
    projects: m.projects, session: m.session, analysisTargetProjectId: target, onChange() {},
  }));
}

function vault(language: "es" | "en", m: ReturnType<typeof models>, initialFilters?: { query?: string }) {
  const { ProjectVault } = loadComponent("projects/ProjectVault.tsx", language);
  return renderToStaticMarkup(React.createElement(ProjectVault, {
    projects: m.projects, session: m.session, toasts: m.toasts, onCapture() {}, onEditor() {},
    now: () => new Date("2026-10-13T18:00:00.000Z"),
    initialFilters,
  }));
}

function artifact(targetProjectId: string | null = projectA) {
  return createGenerationArtifact({ uiSchema: uiSchemaFixture, generatedProject: generateReactProject(uiSchemaFixture), fidelity: "balanced", screenshot: screenshot(), targetProjectId });
}

test("Capture project chip replaces the temporary selector in ES and EN", async () => {
  const m = models();
  await m.projects.loadProjects();
  for (const language of ["es", "en"] as const) {
    const labels = language === "es" ? es : en;
    assert.ok(chip(language, m).includes(labels.vaultNoProject));
    assert.ok(chip(language, m).includes(labels.vaultChooseProject));
  }
  await m.projects.selectProject(projectA);
  assert.ok(chip("en", m).includes("Alpha"));
  assert.ok(chip("en", m).includes(en.vaultChangeProject));
  assert.doesNotMatch(chip("en", m), /project-target-select|project-create-name|Open latest/);
  assert.equal(existsSync(new URL("../src/features/projects/ProjectTargetPanel.tsx", import.meta.url)), false);
});

test("analysis target and persistent linked / unsaved retry line remain", async () => {
  const m = models();
  await m.projects.loadProjects();
  assert.ok(chip("es", m, projectA).includes(es.analysisTargetProject.replace("{{name}}", "Alpha")));
  assert.ok(chip("en", m, null).includes(en.analysisTargetLocal));
  await m.session.complete(artifact());
  assert.ok(chip("en", m).includes(en.resultLinked.replace("{{name}}", "Alpha")));
  const failed = models({ createGeneration: async () => { throw new ProjectsClientError("SERVER_ERROR"); } });
  await failed.projects.loadProjects();
  await failed.session.complete(artifact());
  const html = chip("en", failed);
  assert.ok(html.includes(en.resultUnsaved));
  assert.ok(html.includes(`aria-label="${en.saveRetry}"`));
  assert.ok(!html.includes(en.saveStatusFailed));
  const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  assert.match(css, /\.project-result-line \{[^}]*height: 1\.6em;[^}]*white-space: nowrap;/);
});

test("retry remains disabled while a failed save is retrying", async () => {
  let fail = true;
  const pending = deferred<GenerationDetail>();
  const m = models({ createGeneration: () => fail ? Promise.reject(new ProjectsClientError("SERVER_ERROR")) : pending.promise });
  await m.projects.loadProjects();
  await m.session.complete(artifact());
  fail = false;
  void m.session.retrySave();
  assert.match(chip("en", m), /aria-label="Retry save" disabled=""/);
});

test("Vault renders localized loading, empty, error and populated states", async () => {
  const loading = models({ listProjects: () => new Promise(() => {}) });
  void loading.projects.loadProjects();
  assert.equal(vault("en", loading).match(/class="vault-card raised-panel"/g)?.length, 6);
  const empty = models({ listProjects: async () => [] });
  await empty.projects.loadProjects();
  assert.ok(vault("es", empty).includes(es.vaultCreateFirst));
  const populated = models({ listProjects: async () => [{ ...summaryA, generationCount: 1, latestGenerationId: generationOne }, summaryB] });
  await populated.projects.loadProjects();
  const html = vault("en", populated);
  assert.ok(html.includes(en.vaultTitle));
  assert.ok(vault("es", populated).includes(es.vaultTitle));
  assert.ok(html.includes("1 generation"));
  assert.match(html, /<ul class="vault-grid">/);
  assert.match(html, /aria-label="Open project Alpha"/);
  assert.match(html, /<label for="vault-state"/);
  assert.match(html, /<label for="vault-sort"/);
  assert.match(html, /Open latest/);
  assert.equal((html.match(/class="vault-latest"/g) ?? []).length, 1);
  assert.ok(vault("en", populated, { query: "none-match" }).includes(en.vaultClearFilters));
  const failed = models({ listProjects: async () => { throw new ProjectsClientError("SERVER_ERROR"); } });
  await failed.projects.loadProjects();
  assert.ok(vault("en", failed).includes(en.projectsRetryLoad));
  assert.match(vault("en", failed), /role="alert"/);
  let failLater = false;
  const retained = models({ listProjects: async () => {
    if (failLater) throw new ProjectsClientError("NETWORK_ERROR");
    return [summaryA];
  } });
  await retained.projects.loadProjects();
  failLater = true;
  await retained.projects.loadProjects();
  assert.ok(vault("en", retained).includes(en.projectsRetryLoad));
  assert.match(vault("en", retained), /aria-label="Open project Alpha"/);
});

test("dialog has a labelled modal, name field, counter and cancel/create controls", () => {
  const { NewProjectDialog } = loadComponent("projects/NewProjectDialog.tsx", "en");
  const m = models();
  const html = renderToStaticMarkup(React.createElement(NewProjectDialog, {
    projects: m.projects, trigger: { current: null }, onClose() {}, onCreated() {},
  }));
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="vault-dialog-title"/);
  assert.match(html, /<label for="vault-project-name"/);
  assert.match(html, /0\/100/);
  assert.ok(html.includes(en.vaultCancel) && html.includes(en.projectCreate));
});

test("toast viewport keeps accessible alerts and retry action", () => {
  const { ToastViewport } = loadComponent("feedback/ToastViewport.tsx", "en");
  const toasts = createToastModel(fakeScheduler());
  toasts.show({ key: "a", tone: "success", eyebrow: "toastEyebrowSaved", message: "saveStatusSaved", persistent: false, durationMs: 2500 });
  toasts.show({ key: "b", tone: "error", eyebrow: "toastEyebrowError", message: "saveStatusFailed", persistent: true,
    action: { label: "saveRetry", run() {} } });
  const html = renderToStaticMarkup(React.createElement(ToastViewport, { model: toasts }));
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /role="alert" aria-live="assertive"/);
  assert.ok(html.includes(en.saveRetry));
  assert.ok(html.includes(en.toastDismiss));
});

test("Vault and chip styles use tokens and reduced-motion handling", () => {
  const css = readFileSync(new URL("../src/features/projects/vault.css", import.meta.url), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.match(css, /var\(--font-display\)/);
  assert.match(css, /var\(--font-sans\)/);
  assert.match(css, /var\(--font-mono\)/);
});
