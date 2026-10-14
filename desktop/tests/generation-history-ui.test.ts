import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import type { GenerationDetail, GenerationSummary } from "@vision2code/contracts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createGenerationArtifact, toSourceImageName } from "../src/features/generation/generationArtifact.ts";
import { createGenerationSessionModel } from "../src/features/generation/generationSessionModel.ts";
import { createToastModel } from "../src/features/feedback/toastModel.ts";
import * as discardGuardModule from "../src/features/projects/discardGuard.ts";
import { createGenerationHistoryModel } from "../src/features/projects/generationHistoryModel.ts";
import * as historyActions from "../src/features/projects/historyActions.ts";
import * as historySelectors from "../src/features/projects/historySelectors.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import type { ProjectsClient } from "../src/features/projects/projectsClient.ts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import * as actions from "../src/features/projects/projectTargetActions.ts";
import * as vaultActions from "../src/features/projects/vaultActions.ts";
import * as vaultKeyboard from "../src/features/projects/vaultKeyboard.ts";
import * as vaultSelectors from "../src/features/projects/vaultSelectors.ts";
import { fakeScheduler } from "./fake-scheduler.ts";
import {
  deferred, fakeClient, generationOne, generationTwo, projectA, screenshot, storedGeneration, summaryA, summaryB, summaryOf, uiSchemaFixture,
} from "./generation-fixtures.ts";

type Lang = "es" | "en";
type Node = any;
const g3 = "223e4567-e89b-42d3-a456-426614174003";
const NOW = new Date("2026-10-14T12:00:00.000Z");
const old1 = summaryOf(generationOne, "2026-10-12T10:00:00.000Z", projectA, { sourceImageName: "C:\\Users\\someone\\old-capture.png", fidelityMode: "FAST" });
const old2 = summaryOf(generationTwo, "2026-10-13T10:00:00.000Z", projectA, { fidelityMode: "PRECISE" });
const newest = summaryOf(g3, "2026-10-14T11:55:00.000Z", projectA, { sourceImageName: null });

// ---- Loading components -----------------------------------------------------------------------

function loadModule(file: string, language: Lang, react: unknown, globals: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  const table: Record<string, unknown> = {
    "/historySelectors": historySelectors, "/historyActions": historyActions, "/discardGuard": discardGuardModule,
    "/projectTargetActions": actions, "/vaultKeyboard": vaultKeyboard, "/vaultSelectors": vaultSelectors,
    "/vaultActions": vaultActions, "/NewProjectDialog": { NewProjectDialog: () => null },
    "/generationArtifact": { toSourceImageName },
    ...extra,
  };
  runInNewContext(code, {
    exports, ...globals,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "lucide-react") return lucide;
      if (name.endsWith("/useLabels")) return { useLabels: () => ({ t: i18n.getFixedT(language) }) };
      if (name.endsWith("/i18n")) return { i18n: { language } };
      for (const [suffix, value] of Object.entries(table)) if (name.endsWith(suffix)) return value;
      return require(name);
    },
  });
  return exports;
}

/** Static HTML with real React; `openFirstState` forces the first useState (the tray's `open`) to true. */
function html(file: string, component: string, language: Lang, props: Record<string, unknown>, options: { openFirstState?: boolean; extra?: Record<string, unknown> } = {}) {
  let first = true;
  const react = { ...React, useState: (initial: unknown) => {
    const forced = first && options.openFirstState ? true : initial;
    first = false;
    return React.useState(forced);
  } };
  const exports = loadModule(file, language, react, {}, options.extra);
  return renderToStaticMarkup(React.createElement(exports[component], props));
}

/** Hook-driving harness: renders a component as a plain function with stateful fake hooks. */
function driver(file: string, component: string, language: Lang, extra: Record<string, unknown> = {}) {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let pending: Array<() => void | (() => void)> = [];
  let cleanups: Array<() => void> = [];
  let stateIndex = 0;
  let refIndex = 0;
  const documentHandlers: Array<(event: unknown) => void> = [];
  const react = {
    ...React,
    useState(initial: unknown) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? (next as (v: unknown) => unknown)(states[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect(effect: () => void | (() => void)) { pending.push(effect); },
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
  const document = { addEventListener: (_type: string, fn: (event: unknown) => void) => { documentHandlers.push(fn); }, removeEventListener() {} };
  const exports = loadModule(file, language, react, { document }, extra);
  return {
    refs, documentHandlers,
    render(props: Record<string, unknown>): Node {
      stateIndex = 0; refIndex = 0; pending = [];
      return exports[component](props);
    },
    flushEffects() {
      cleanups.forEach((cleanup) => cleanup());
      cleanups = [];
      for (const effect of pending) { const cleanup = effect(); if (typeof cleanup === "function") cleanups.push(cleanup); }
      pending = [];
    },
    unmount() { cleanups.forEach((cleanup) => cleanup()); cleanups = []; },
  };
}

function walk(node: Node, visit: (item: Node) => void) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of React.Children.toArray(node.props?.children)) walk(child as Node, visit);
}
function findAll(node: Node, predicate: (item: Node) => boolean): Node[] {
  const result: Node[] = [];
  walk(node, (item) => { if (predicate(item)) result.push(item); });
  return result;
}
const text = (node: Node): string => {
  let value = "";
  walk(node, (item) => { for (const child of [item.props?.children].flat()) if (typeof child === "string" || typeof child === "number") value += String(child); });
  return value;
};
const fakeNode = (label: string, log: string[]) => ({ label, isConnected: true, focus() { log.push(label); }, contains: () => false, querySelectorAll: () => [] as unknown[] });

// ---- Fixtures ---------------------------------------------------------------------------------

function artifact(targetProjectId: string | null = projectA) {
  return createGenerationArtifact({ uiSchema: uiSchemaFixture, generatedProject: generateReactProject(uiSchemaFixture), fidelity: "balanced", screenshot: screenshot(), targetProjectId });
}

function world(overrides: Partial<ProjectsClient> = {}, items: readonly GenerationSummary[] = [newest, old2, old1]) {
  const opened: string[] = [];
  const saves: string[] = [];
  const { client } = fakeClient({
    listProjects: async () => [summaryA, summaryB],
    listGenerations: async () => [...items],
    getGeneration: async (projectId, generationId) => { opened.push(generationId); return storedGeneration(projectId, generationId); },
    createGeneration: async (projectId, body) => { saves.push(projectId); return storedGeneration(projectId, g3, body.generatedProject); },
    ...overrides,
  });
  const projects = createProjectsModel(client);
  const editor = createEditorModel();
  const session = createGenerationSessionModel({ client, projects, loadProject: (project) => editor.setProject(project) });
  const history = createGenerationHistoryModel({ client, session, projects });
  const guard = discardGuardModule.createDiscardGuard();
  return { client, projects, editor, session, history, guard, opened, saves };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function codeContextHtml(language: Lang, w: ReturnType<typeof world>) {
  const trayExports = loadModule("projects/GenerationHistoryTray.tsx", language, React);
  return html("workspace/CodeContext.tsx", "CodeContext", language, {
    editor: w.editor, session: w.session, projects: w.projects, history: w.history, discardGuard: w.guard, now: () => NOW,
  }, { extra: { "/GenerationHistoryTray": trayExports, "/EditorModel": {} } });
}
function trayHtml(language: Lang, w: ReturnType<typeof world>, open = true) {
  return html("projects/GenerationHistoryTray.tsx", "GenerationHistoryTray", language, {
    history: w.history, session: w.session, hasLocalEdits: () => false, confirmDiscard: async () => true, now: () => NOW,
  }, { openFirstState: open });
}

// ---- Identity and chip --------------------------------------------------------------------------

test("identity shows the project name (title for truncation) and the PROJECT eyebrow; local-only says no project", async () => {
  const w = world();
  await w.projects.loadProjects();
  await w.projects.selectProject(projectA);
  await settle();
  for (const language of ["es", "en"] as const) {
    const labels = language === "es" ? es : en;
    const out = codeContextHtml(language, w);
    assert.match(out, new RegExp(`<p class="eyebrow">${labels.vaultProjectEyebrow}</p>`));
    assert.ok(out.includes('class="code-identity-name" title="Alpha" aria-haspopup="dialog"') && out.includes(">Alpha</button>"));
  }
  await w.session.complete(artifact(null));
  assert.ok(codeContextHtml("en", w).includes('title="No project"') && codeContextHtml("en", w).includes(">No project</button>"));
});

test("status chip variants render with LED, localized label and the Edited marker", async () => {
  const cases: Array<[string, () => Promise<ReturnType<typeof world>>, RegExp, RegExp?]> = [
    ["generated", async () => { const w = world(); await w.projects.loadProjects(); await w.session.complete(artifact()); await settle(); return w; },
      /data-tone="success"><span class="result-led" aria-hidden="true"><\/span>Generated</],
    ["saving", async () => { const w = world({ createGeneration: () => new Promise(() => {}) }); void w.session.complete(artifact()); return w; },
      /data-tone="progress"><span class="result-led" aria-hidden="true"><\/span>Saving…</],
    ["unsaved", async () => { const w = world({ createGeneration: async () => { throw new ProjectsClientError("SERVER_ERROR"); } }); await w.session.complete(artifact()); return w; },
      /data-tone="warning">[^]*?Not saved</],
    ["local", async () => { const w = world(); await w.session.complete(artifact(null)); return w; },
      /data-tone="neutral">[^]*?Local only</],
    ["not saveable", async () => { const w = world(); await w.session.complete({ ...artifact(), generatedProject: { target: "react-tailwind", generatorVersion: "1", files: [] } }); return w; },
      /data-tone="error">[^]*?Not saveable</],
  ];
  for (const [name, build, expected] of cases) {
    const out = codeContextHtml("en", await build());
    assert.match(out, expected, name);
    assert.doesNotMatch(out, /data-tone="edited"/, `${name}: no Edited marker without drafts`);
  }
  const w = world();
  await w.projects.loadProjects();
  await w.projects.selectProject(projectA);
  await w.session.openGeneration(projectA, generationTwo);
  await settle();
  const restored = codeContextHtml("en", w);
  assert.match(restored, /data-tone="info">[^]*?Restored · Generation 02</);
  assert.ok(codeContextHtml("es", w).includes("Restaurado · Generación 02"));
  w.editor.edit("// local change");
  const edited = codeContextHtml("en", w);
  assert.match(edited, /data-tone="info">[^]*?Restored/);
  assert.match(edited, /data-tone="edited"><span class="result-led" aria-hidden="true"><\/span>Edited</);
  assert.ok(codeContextHtml("es", w).includes(">Editado<"));
  const empty = world();
  assert.doesNotMatch(codeContextHtml("en", empty), /result-chip/, "no result → no chip");
});

// ---- Tray ---------------------------------------------------------------------------------------

test("populated tray: newest first, numbers, relative time, fidelity, basename, current item marked", async () => {
  const w = world();
  await w.projects.selectProject(projectA);
  await settle();
  await w.session.openGeneration(projectA, generationTwo);
  for (const language of ["es", "en"] as const) {
    const labels = language === "es" ? es : en;
    const out = trayHtml(language, w);
    assert.match(out, /<button[^>]*class="history-key action-button"[^>]*aria-expanded="true"[^>]*aria-controls="generation-history-tray"/);
    assert.ok(out.includes(labels.historyKey.replace("{{count}}", "3")));
    assert.match(out, /id="generation-history-tray"[^>]*role="region"/);
    const order = [...out.matchAll(new RegExp(labels.historyGeneration.replace("{{number}}", "(\\d\\d)"), "g"))].map((match) => match[1]);
    assert.deepEqual(order, ["03", "02", "01"]);
    assert.equal(out.match(/aria-current="true"/g)?.length, 1);
    assert.match(out, /<li class="history-entry" data-current="true"><button[^>]*aria-current="true"/);
    assert.ok(out.includes(labels.historyCurrent));
    assert.ok(out.includes(labels.fidelityFast) && out.includes(labels.fidelityPrecise));
    assert.match(out, /title="old-capture.png">old-capture.png</, "basename only, never a path");
    assert.doesNotMatch(out, /Users/);
  }
  assert.match(trayHtml("en", w), /5 minutes ago/);
  assert.match(trayHtml("es", w), /hace 5 minutos/);
  assert.match(trayHtml("en", w), /yesterday/);
});

test("tray states: loading skeleton, empty, error with Retry, and disabled key without a project", async () => {
  const loading = world({ listGenerations: () => new Promise(() => {}) });
  await loading.projects.selectProject(projectA);
  const loadingHtml = trayHtml("en", loading);
  assert.match(loadingHtml, /class="history-log history-skeleton" aria-label="Loading history…"/);
  assert.equal(loadingHtml.match(/class="history-entry" aria-hidden="true"/g)?.length, 3);

  const empty = world({}, []);
  await empty.projects.selectProject(projectA);
  await settle();
  for (const language of ["es", "en"] as const) {
    assert.ok(trayHtml(language, empty).includes((language === "es" ? es : en).historyEmpty));
  }

  const failed = world({ listGenerations: async () => { throw new ProjectsClientError("SERVER_ERROR"); } });
  await failed.projects.selectProject(projectA);
  await settle();
  const errorHtml = trayHtml("es", failed);
  assert.match(errorHtml, /role="alert"/);
  assert.ok(errorHtml.includes(es.historyError) && errorHtml.includes(es.historyRetry));

  const none = world();
  const closed = trayHtml("en", none, true);
  assert.match(closed, /class="history-key action-button" aria-expanded="false"[^>]*disabled=""/);
  assert.ok(closed.includes(`title="${en.historyNoProject}"`));
  assert.doesNotMatch(closed, /id="generation-history-tray"/, "no popover without a project");
});

test("tray key toggles, Esc closes and returns focus, outside click closes", async () => {
  const w = world();
  await w.projects.selectProject(projectA);
  await settle();
  const d = driver("projects/GenerationHistoryTray.tsx", "GenerationHistoryTray", "en");
  const props = { history: w.history, session: w.session, hasLocalEdits: () => false, confirmDiscard: async () => true, now: () => NOW };
  let tree = d.render(props);
  assert.equal(findAll(tree, (n) => n.props?.id === "generation-history-tray").length, 0);
  const log: string[] = [];
  const key = findAll(tree, (n) => n.props?.className?.includes("history-key"))[0];
  key.props.onClick();
  tree = d.render(props);
  assert.equal(findAll(tree, (n) => n.props?.id === "generation-history-tray").length, 1);
  assert.equal(findAll(tree, (n) => n.props?.className?.includes("history-key"))[0].props["aria-expanded"], true);
  // Attach fake DOM nodes to the refs, as React would.
  d.refs[1]!.current = fakeNode("history-key", log);
  const root = findAll(tree, (n) => n.props?.className === "history")[0];
  let prevented = false;
  root.props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(log, ["history-key"], "focus returned to the key");
  tree = d.render(props);
  assert.equal(findAll(tree, (n) => n.props?.id === "generation-history-tray").length, 0);
  // Outside click: reopen, flush effects so the document listener registers.
  findAll(tree, (n) => n.props?.className?.includes("history-key"))[0].props.onClick();
  tree = d.render(props);
  d.flushEffects();
  const inside = {};
  d.refs[0]!.current = { contains: (target: unknown) => target === inside };
  d.documentHandlers[0]!({ target: inside });
  tree = d.render(props);
  assert.equal(findAll(tree, (n) => n.props?.id === "generation-history-tray").length, 1, "inside click keeps it open");
  d.documentHandlers[0]!({ target: {} });
  tree = d.render(props);
  assert.equal(findAll(tree, (n) => n.props?.id === "generation-history-tray").length, 0, "outside click closes");
});

// ---- Selection flows through the tray -----------------------------------------------------------

function entries(tree: Node) {
  return findAll(tree, (n) => n.type === "li" && n.props?.className === "history-entry").map((li) => findAll(li, (n) => n.type === "button")[0]);
}
async function openTray(w: ReturnType<typeof world>, hasEdits: () => boolean) {
  const d = driver("projects/GenerationHistoryTray.tsx", "GenerationHistoryTray", "en");
  const props = { history: w.history, session: w.session, hasLocalEdits: hasEdits, confirmDiscard: (trigger: HTMLElement | null) => w.guard.request(trigger), now: () => NOW };
  let tree = d.render(props);
  findAll(tree, (n) => n.props?.className?.includes("history-key"))[0].props.onClick();
  tree = d.render(props);
  return { d, props, tree: () => d.render(props), first: tree };
}

test("select without drafts opens exactly once; busy item and disabled siblings while restoring", async () => {
  const pending = deferred<GenerationDetail>();
  let requests = 0;
  const w = world({ getGeneration: () => { requests++; return pending.promise; } });
  await w.projects.selectProject(projectA);
  await settle();
  const { tree } = await openTray(w, () => false);
  const buttons = entries(tree());
  assert.equal(buttons.length, 3);
  buttons[1].props.onClick({ currentTarget: {} });
  const busy = entries(tree());
  assert.equal(busy[1].props["aria-busy"], true);
  assert.equal(busy[0].props.disabled, true);
  assert.equal(busy[2].props.disabled, true);
  assert.equal(busy[1].props.disabled, false);
  // A second click on another entry is ignored even if it somehow reaches the handler.
  buttons[2].props.onClick({ currentTarget: {} });
  await settle();
  assert.equal(requests, 1, "exactly one restore request");
  assert.ok(text(findAll(tree(), (n) => n.props?.className === "history-busy")[0]).includes("Opening generation…"));
  pending.resolve(storedGeneration(projectA, generationTwo));
  await settle();
  assert.equal(w.session.getSnapshot().generationId, generationTwo);
  assert.equal(w.guard.getSnapshot().open, false);
  assert.equal(findAll(tree(), (n) => n.props?.id === "generation-history-tray").length, 0, "closes after a successful restore");
});

test("select with drafts: dialog first; Cancel keeps drafts and calls nothing; Confirm opens", async () => {
  const w = world();
  await w.projects.selectProject(projectA);
  await settle();
  w.editor.setProject(generateReactProject(uiSchemaFixture));
  w.editor.edit("// unsaved work");
  const { tree } = await openTray(w, () => w.editor.getSnapshot().drafts.size > 0);
  entries(tree())[1].props.onClick({ currentTarget: {} });
  await settle();
  assert.equal(w.guard.getSnapshot().open, true);
  assert.deepEqual(w.opened, []);
  w.guard.cancel();
  await settle();
  assert.deepEqual(w.opened, [], "cancel calls nothing");
  assert.equal(w.editor.getSnapshot().drafts.size, 1, "drafts intact");
  entries(tree())[1].props.onClick({ currentTarget: {} });
  await settle();
  w.guard.confirm();
  await settle();
  assert.deepEqual(w.opened, [generationTwo]);
  assert.equal(w.editor.getSnapshot().drafts.size, 0, "restored working copy replaced the drafts");
});

test("selecting the current generation just closes; nothing is requested", async () => {
  const w = world();
  await w.projects.selectProject(projectA);
  await settle();
  await w.session.openGeneration(projectA, generationTwo);
  w.opened.length = 0;
  const { tree } = await openTray(w, () => true);
  const current = entries(tree()).find((button) => button.props["aria-current"] === "true");
  current.props.onClick({ currentTarget: {} });
  await settle();
  assert.deepEqual(w.opened, []);
  assert.equal(w.guard.getSnapshot().open, false, "no dialog even with drafts");
  assert.equal(findAll(tree(), (n) => n.props?.id === "generation-history-tray").length, 0);
});

test("restore failure keeps current work and the tray open for another choice", async () => {
  const w = world({ getGeneration: async () => { throw new ProjectsClientError("NOT_FOUND"); } });
  await w.projects.selectProject(projectA);
  await settle();
  await w.session.complete(artifact(projectA));
  await settle();
  const before = w.session.getSnapshot();
  const { tree } = await openTray(w, () => false);
  entries(tree())[1].props.onClick({ currentTarget: {} });
  await settle();
  assert.equal(w.session.getSnapshot().artifact, before.artifact);
  assert.equal(w.session.getSnapshot().restoreStatus, "FAILED");
  assert.equal(findAll(tree(), (n) => n.props?.id === "generation-history-tray").length, 1);
});

// ---- Vault "Open latest" guard --------------------------------------------------------------------

test("Vault Open latest with drafts asks first and changes nothing until confirmed", async () => {
  const w = world({ listProjects: async () => [{ ...summaryA, generationCount: 2, latestGenerationId: generationTwo }, summaryB] });
  await w.projects.loadProjects();
  w.editor.setProject(generateReactProject(uiSchemaFixture));
  w.editor.edit("// unsaved");
  let selects = 0;
  const select = w.projects.selectProject;
  w.projects.selectProject = (id) => { selects++; return select(id); };
  const navigations: string[] = [];
  const d = driver("projects/ProjectVault.tsx", "ProjectVault", "en", { "/NewProjectDialog": { NewProjectDialog: () => null } });
  const props = {
    projects: w.projects, session: w.session, toasts: createToastModel(fakeScheduler()),
    onCapture: () => navigations.push("capture"), onEditor: () => navigations.push("editor"),
    now: () => NOW,
    hasLocalEdits: () => w.editor.getSnapshot().drafts.size > 0,
    confirmDiscard: (trigger: HTMLElement | null) => w.guard.request(trigger),
  };
  const latestButton = () => findAll(d.render(props), (n) => n.props?.className === "vault-latest")[0];
  latestButton().props.onClick({ currentTarget: {} });
  await settle();
  assert.equal(w.guard.getSnapshot().open, true);
  assert.equal(selects, 0, "selection untouched while the dialog is open");
  assert.deepEqual(w.opened, []);
  w.guard.cancel();
  await settle();
  assert.equal(selects, 0);
  assert.deepEqual(w.opened, []);
  assert.deepEqual(navigations, []);
  assert.equal(w.editor.getSnapshot().drafts.size, 1);
  latestButton().props.onClick({ currentTarget: {} });
  await settle();
  w.guard.confirm();
  await settle();
  await settle();
  assert.deepEqual(w.opened, [generationTwo]);
  assert.deepEqual(navigations, ["editor"]);
  assert.equal(selects, 1);
  // Without drafts there is no dialog at all.
  w.editor.reset();
  w.opened.length = 0;
  latestButton().props.onClick({ currentTarget: {} });
  await settle();
  await settle();
  assert.equal(w.guard.getSnapshot().open, false);
  assert.deepEqual(w.opened, [generationTwo]);
});

// ---- Discard dialog accessibility ---------------------------------------------------------------

test("discard dialog: role, aria-modal, labels, ES/EN copy, safe default, error-toned confirm", async () => {
  for (const language of ["es", "en"] as const) {
    const labels = language === "es" ? es : en;
    const guard = discardGuardModule.createDiscardGuard();
    void guard.request(null);
    const out = html("projects/DiscardDialog.tsx", "DiscardDialog", language, { guard });
    assert.match(out, /role="dialog" aria-modal="true" aria-labelledby="discard-dialog-title" aria-describedby="discard-dialog-description"/);
    assert.ok(out.includes(`<h2 id="discard-dialog-title">${labels.discardTitle}</h2>`));
    assert.ok(out.includes(labels.discardDescription));
    assert.match(out, new RegExp(`class="action-button secondary-button">${labels.vaultCancel}</button>`));
    assert.match(out, new RegExp(`class="action-button danger-action">${labels.discardConfirm}</button>`));
    assert.doesNotMatch(out, /primary-action/, "the destructive choice is not the accent action");
    guard.cancel();
  }
  assert.equal(es.discardDescription, "Tienes cambios sin guardar en el editor. Si abres otra generación se descartarán.");
  assert.equal(html("projects/DiscardDialog.tsx", "DiscardDialog", "en", { guard: discardGuardModule.createDiscardGuard() }), "");
});

test("discard dialog focus: Cancel first, Esc cancels, Tab trapped, focus returns to the trigger", async () => {
  const guard = discardGuardModule.createDiscardGuard();
  const log: string[] = [];
  const trigger = fakeNode("trigger", log) as unknown as HTMLElement;
  const answer = guard.request(trigger);
  const host = driver("projects/DiscardDialog.tsx", "DiscardDialog", "en");
  // DiscardDialog renders DiscardSheet; drive that function component through the same fake hooks.
  const sheetElement = host.render({ guard });
  const sheetProps = sheetElement.props as { guard: typeof guard; trigger: HTMLElement | null };
  assert.equal(sheetProps.trigger, trigger);
  const sheet = (sheetElement.type as (props: unknown) => Node)(sheetProps);
  assert.equal(sheet.props.className, "vault-scrim");
  // Mount effects: Cancel takes focus; unmounting returns focus to the trigger.
  const focusLog: string[] = [];
  host.refs[0]!.current = fakeNode("sheet", focusLog);
  host.refs[1]!.current = fakeNode("cancel", focusLog);
  host.flushEffects();
  assert.deepEqual(focusLog, ["cancel"], "safe action is focused first");
  host.unmount();
  assert.deepEqual(log, ["trigger"], "focus returns to the opener");
  const dialog = findAll(sheet, (n) => n.props?.role === "dialog")[0];
  const [cancelButton, confirmButton] = findAll(dialog, (n) => n.type === "button");
  assert.equal(text(cancelButton), "Cancel");
  assert.equal(text(confirmButton), "Discard and open");
  assert.equal(cancelButton.props.ref !== undefined && confirmButton.props.ref === undefined, true, "only Cancel is the focus target");
  // Esc cancels.
  let prevented = false;
  dialog.props.onKeyDown({ key: "Escape", shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(await answer, false);
  assert.equal(guard.getSnapshot().open, false);
  // Backdrop click cancels too; a second request resolves true on confirm.
  const second = guard.request(null);
  sheet.props.onMouseDown({ target: sheet, currentTarget: sheet });
  assert.equal(await second, false);
  const third = guard.request(null);
  confirmButton.props.onClick();
  assert.equal(await third, true);
});

test("the discard dialog is a single app-level host; the editor aside slot keeps the layout out of flow", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal((app.match(/<DiscardDialog/g) ?? []).length, 1);
  assert.match(app, /codeContext=\{<CodeContext/);
  const shell = readFileSync(new URL("../src/features/workspace/ApplicationShell.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(shell, /import .*(DiscardDialog|CodeContext|GenerationHistoryTray)/, "shell keeps only type imports (test shim pattern)");
  assert.equal(existsSync(new URL("../src/features/projects/discardGuard.ts", import.meta.url)), true);
  const vault = readFileSync(new URL("../src/features/projects/ProjectVault.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(vault, /editorModel|features\/editor/, "Vault learns about edits only through a prop");
});

test("history styles use tokens only, stay out of flow, cap the tray height, and respect reduced motion", () => {
  const css = readFileSync(new URL("../src/features/projects/vault.css", import.meta.url), "utf8");
  const lines = css.split("\n").filter((line) => /\.(history|result-chip|result-led|code-context|code-identity|code-chips|workspace-aside|danger-action)/.test(line));
  assert.ok(lines.length > 20);
  for (const line of lines) assert.doesNotMatch(line, /#[0-9a-fA-F]{3,8}\b/, `hard-coded color: ${line}`);
  const tray = lines.find((line) => line.trimStart().startsWith(".history-tray {")) ?? "";
  assert.match(tray, /position: absolute;/);
  assert.match(tray, /max-height: 60vh;/);
  assert.match(tray, /overflow-y: auto;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.result-chip\[data-tone="progress"\] \.result-led, \.history-bar \{ animation: none; \}/);
  assert.match(css, /\.history-key \{ width: 100%; justify-content: center; \}/);
});
