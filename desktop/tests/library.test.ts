import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GenerationSummary } from "@vision2code/contracts";
import { createAuthModel } from "../src/features/auth/authModel.ts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createGenerationSessionModel } from "../src/features/generation/generationSessionModel.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import { createDiscardGuard } from "../src/features/projects/discardGuard.ts";
import { chooseLibraryGeneration } from "../src/features/projects/libraryActions.ts";
import { createLibraryModel } from "../src/features/projects/libraryModel.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import type { ProjectsClient } from "../src/features/projects/projectsClient.ts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { bindWorkspaceToAuth, createWorkspaceServices } from "../src/features/workspace/workspaceServices.ts";
import {
  deferred, fakeClient, generationOne, generationTwo, projectA, projectB, storedGeneration, summaryA, summaryB, summaryOf, uiSchemaFixture,
} from "./generation-fixtures.ts";
import { driver, fakeNode, findAll, html, loadModule, settle, type Lang, type Node } from "./ui-harness.ts";

const g3 = "223e4567-e89b-42d3-a456-426614174003";
const NOW = new Date("2026-10-14T12:00:00.000Z");
const a1 = summaryOf(generationOne, "2026-10-12T10:00:00.000Z", projectA, { fidelityMode: "FAST", sourceImageName: "very-long-source-name-that-must-truncate-with-ellipsis.png" });
const a2 = summaryOf(generationTwo, "2026-10-13T10:00:00.000Z", projectA, { fidelityMode: "PRECISE" });
const a3 = summaryOf(g3, "2026-10-14T11:55:00.000Z", projectA, { sourceImageName: null });
const projectAWithCount = { ...summaryA, generationCount: 3, latestGenerationId: g3 };

function world(listGenerations?: ProjectsClient["listGenerations"], onUnauthorized?: () => void, overrides: Partial<ProjectsClient> = {}) {
  const requested: string[] = [];
  const opened: string[] = [];
  const { client } = fakeClient({
    listProjects: async () => [projectAWithCount, summaryB],
    listGenerations: listGenerations ?? (async (id) => { requested.push(id); return id === projectA ? [a1, a3, a2] : []; }),
    getGeneration: async (projectId, generationId) => { opened.push(generationId); return storedGeneration(projectId, generationId); },
    ...overrides,
  });
  const counted: ProjectsClient["listGenerations"] = listGenerations
    ? (id) => { requested.push(id); return client.listGenerations(id); }
    : client.listGenerations;
  const library = createLibraryModel({ client: { listGenerations: counted }, ...(onUnauthorized ? { onUnauthorized } : {}) });
  const projects = createProjectsModel(client);
  const editor = createEditorModel();
  const session = createGenerationSessionModel({ client, projects, loadProject: (project) => editor.setProject(project) });
  const guard = createDiscardGuard();
  return { library, projects, editor, session, guard, requested, opened };
}
type World = ReturnType<typeof world>;

function dialogProps(w: World, openCode: () => void = () => {}) {
  return {
    library: w.library, projects: w.projects, session: w.session, openCode, now: () => NOW,
    hasLocalEdits: () => w.editor.getSnapshot().drafts.size > 0,
    confirmDiscard: (trigger: HTMLElement | null) => w.guard.request(trigger),
  };
}
const dialogHtml = (language: Lang, w: World) => html("projects/LibraryDialog.tsx", "LibraryDialog", language, dialogProps(w));

function mount(language: Lang, w: World, openCode?: () => void) {
  const d = driver("projects/LibraryDialog.tsx", "LibraryDialog", language);
  const props = dialogProps(w, openCode);
  const render = (): Node => { const element = d.render(props); return element ? element.type(element.props) : null; };
  return { d, render };
}
const entries = (tree: Node) => findAll(tree, (n) => n.type === "li" && n.props?.className === "history-entry").map((li) => findAll(li, (n) => n.type === "button")[0]);
const toggles = (tree: Node) => findAll(tree, (n) => n.props?.className === "library-project-toggle");

// ---- Model ------------------------------------------------------------------------------------

test("library loads a project's generations lazily, newest first, summaries only", async () => {
  const w = world();
  await w.projects.loadProjects();
  assert.deepEqual(w.requested, [], "nothing requested until a project is expanded");
  await w.library.loadProject(projectA);
  assert.deepEqual(w.requested, [projectA]);
  const entry = w.library.getSnapshot().entries[projectA]!;
  assert.equal(entry.status, "READY");
  assert.deepEqual(entry.items.map((item) => item.id), [g3, generationTwo, generationOne]);
  for (const item of entry.items) assert.equal(Object.hasOwn(item, "uiSchema"), false);
  assert.equal(w.library.getSnapshot().entries[projectB], undefined, "other projects untouched");
});

test("dialog state: open with a focused project and a trigger; close clears them", () => {
  const w = world();
  const trigger = {} as HTMLElement;
  w.library.openDialog(projectA, trigger);
  assert.deepEqual([w.library.getSnapshot().open, w.library.getSnapshot().focusProjectId, w.library.getSnapshot().trigger], [true, projectA, trigger]);
  w.library.closeDialog();
  assert.deepEqual([w.library.getSnapshot().open, w.library.getSnapshot().focusProjectId, w.library.getSnapshot().trigger], [false, null, null]);
});

test("in-flight loads are shared per project and stale responses never win", async () => {
  const pending: Array<ReturnType<typeof deferred<GenerationSummary[]>>> = [];
  const w = world((_id) => { const next = deferred<GenerationSummary[]>(); pending.push(next); return next.promise; });
  const first = w.library.loadProject(projectA);
  const second = w.library.loadProject(projectA);
  assert.equal(first, second);
  assert.equal(pending.length, 1, "deduplicated");
  const other = w.library.loadProject(projectB);
  assert.equal(pending.length, 2, "another project loads independently");
  pending[1]!.resolve([]);
  pending[0]!.resolve([a2]);
  await Promise.all([first, other]);
  assert.deepEqual(w.library.getSnapshot().entries[projectA]!.items.map((item) => item.id), [generationTwo]);
  assert.equal(w.library.getSnapshot().entries[projectB]!.status, "READY");
  // A refresh keeps the previous items visible while it runs, and the newest response wins.
  const refresh = w.library.loadProject(projectA);
  assert.equal(w.library.getSnapshot().entries[projectA]!.status, "LOADING");
  assert.equal(w.library.getSnapshot().entries[projectA]!.items.length, 1);
  pending[2]!.resolve([a3, a2]);
  await refresh;
  assert.equal(w.library.getSnapshot().entries[projectA]!.items.length, 2);
});

test("errors are per project, keep earlier items, retry works; 401 once, 5xx/network do not expire", async () => {
  let mode: "ok" | "fail" = "ok";
  let expired = 0;
  const w = world(async (id) => {
    if (id === projectB) throw new ProjectsClientError("SERVER_ERROR");
    if (mode === "fail") throw new ProjectsClientError("NETWORK_ERROR");
    return [a2];
  }, () => { expired++; });
  await w.library.loadProject(projectA);
  await w.library.loadProject(projectB);
  assert.equal(w.library.getSnapshot().entries[projectB]!.status, "ERROR");
  assert.equal(w.library.getSnapshot().entries[projectB]!.error, "SERVER_ERROR");
  assert.equal(w.library.getSnapshot().entries[projectA]!.status, "READY", "one project's error does not spill over");
  mode = "fail";
  await w.library.retry(projectA);
  const failed = w.library.getSnapshot().entries[projectA]!;
  assert.equal(failed.status, "ERROR");
  assert.equal(failed.items.length, 1, "previous items stay");
  mode = "ok";
  await w.library.retry(projectA);
  assert.equal(w.library.getSnapshot().entries[projectA]!.status, "READY");
  assert.equal(expired, 0);
  const unauthorized = world(async () => { throw new ProjectsClientError("UNAUTHORIZED"); }, () => { expired++; });
  await unauthorized.library.loadProject(projectA);
  assert.equal(expired, 1);
});

test("reset closes the dialog, clears the cache and ignores responses still in flight", async () => {
  const pending = deferred<GenerationSummary[]>();
  const w = world(() => pending.promise);
  w.library.openDialog(projectA, null);
  const load = w.library.loadProject(projectA);
  w.library.reset();
  assert.equal(w.library.getSnapshot().open, false);
  assert.deepEqual(w.library.getSnapshot().entries, {});
  pending.resolve([a1]);
  await load;
  assert.deepEqual(w.library.getSnapshot().entries, {}, "late response from the previous session is dropped");
  // A load started after the reset works normally.
  const again = world();
  await again.library.loadProject(projectA);
  again.library.reset();
  await again.library.loadProject(projectA);
  assert.equal(again.library.getSnapshot().entries[projectA]!.status, "READY");
});

// ---- Action ---------------------------------------------------------------------------------------

function actionWorld() {
  const w = world();
  const navigations: string[] = [];
  const input = (generationId: string, currentGenerationId: string | null = null) => ({
    session: w.session, library: w.library, projectId: projectA, generationId, currentGenerationId,
    hasLocalEdits: () => w.editor.getSnapshot().drafts.size > 0,
    confirmDiscard: (trigger: HTMLElement | null) => w.guard.request(trigger),
    trigger: null, openCode: () => navigations.push("code"),
  });
  return { w, navigations, input };
}

test("choosing a generation without edits opens it, closes the dialog and goes to Code", async () => {
  const { w, navigations, input } = actionWorld();
  w.library.openDialog(projectA, null);
  assert.equal(await chooseLibraryGeneration(input(generationTwo)), "OPENED");
  assert.deepEqual(w.opened, [generationTwo]);
  assert.equal(w.library.getSnapshot().open, false);
  assert.deepEqual(navigations, ["code"]);
  assert.equal(w.session.getSnapshot().generationId, generationTwo);
  assert.equal(w.guard.getSnapshot().open, false, "no prompt without edits");
});

test("choosing with edits: prompt first; Cancel keeps the dialog open and drafts; Confirm proceeds", async () => {
  const { w, navigations, input } = actionWorld();
  w.editor.setProject(generateReactProject(uiSchemaFixture));
  w.editor.edit("// unsaved");
  w.library.openDialog(projectA, null);
  const cancelled = chooseLibraryGeneration(input(generationTwo));
  assert.equal(w.guard.getSnapshot().open, true);
  assert.deepEqual(w.opened, []);
  w.guard.cancel();
  assert.equal(await cancelled, "CANCELLED");
  assert.deepEqual(w.opened, []);
  assert.deepEqual(navigations, []);
  assert.equal(w.library.getSnapshot().open, true);
  assert.equal(w.editor.getSnapshot().drafts.size, 1);
  const confirmed = chooseLibraryGeneration(input(generationTwo));
  w.guard.confirm();
  assert.equal(await confirmed, "OPENED");
  assert.deepEqual(w.opened, [generationTwo]);
  assert.deepEqual(navigations, ["code"]);
  assert.equal(w.library.getSnapshot().open, false);
});

test("the current generation just navigates; a failed restore keeps the dialog open and the work", async () => {
  const { w, navigations, input } = actionWorld();
  w.library.openDialog(projectA, null);
  assert.equal(await chooseLibraryGeneration(input(generationOne, generationOne)), "CURRENT");
  assert.deepEqual(w.opened, []);
  assert.deepEqual(navigations, ["code"]);
  const failing = world(undefined, undefined, { getGeneration: async () => { throw new ProjectsClientError("NOT_FOUND"); } });
  failing.library.openDialog(projectA, null);
  const outcome = await chooseLibraryGeneration({
    session: failing.session, library: failing.library, projectId: projectA, generationId: generationTwo, currentGenerationId: null,
    hasLocalEdits: () => false, confirmDiscard: async () => true, trigger: null, openCode: () => { throw new Error("must not navigate"); },
  });
  assert.equal(outcome, "FAILED");
  assert.equal(failing.library.getSnapshot().open, true);
  assert.equal(failing.session.getSnapshot().restoreStatus, "FAILED");
});

// ---- Dialog UI ------------------------------------------------------------------------------------

test("closed library renders nothing; open renders an accessible modal in ES and EN", async () => {
  const w = world();
  await w.projects.loadProjects();
  assert.equal(dialogHtml("en", w), "");
  w.library.openDialog(null, null);
  for (const language of ["es", "en"] as const) {
    const labels = language === "es" ? es : en;
    const out = dialogHtml(language, w);
    assert.match(out, /role="dialog" aria-modal="true" aria-labelledby="library-dialog-title"/);
    assert.ok(out.includes(`<h2 id="library-dialog-title">${labels.libraryTitle}</h2>`));
    assert.ok(out.includes(`aria-label="${labels.libraryClose}"`));
    assert.match(out, new RegExp(`class="library-project-name" title="Alpha">Alpha</span>`));
    assert.ok(out.includes(language === "es" ? "3 generaciones" : "3 generations"));
    assert.equal(out.match(/aria-expanded="false"/g)?.length, 2);
    assert.ok(out.includes(`aria-controls="library-panel-${projectA}"`));
    assert.doesNotMatch(out, /id="library-panel-/, "panels are rendered only when expanded");
  }
});

test("expanded project lists numbered generations with time, fidelity and file on separate lines", async () => {
  const w = world();
  await w.projects.loadProjects();
  await w.library.loadProject(projectA);
  await w.session.openGeneration(projectA, generationTwo);
  w.library.openDialog(projectA, null);
  for (const language of ["es", "en"] as const) {
    const labels = language === "es" ? es : en;
    const out = dialogHtml(language, w);
    assert.match(out, /aria-expanded="true" aria-controls="library-panel-/);
    assert.match(out, new RegExp(`id="library-panel-${projectA}" class="library-panel" role="region" aria-label="${labels.libraryRegion.replace("{{name}}", "Alpha")}"`));
    const order = [...out.matchAll(new RegExp(labels.historyGeneration.replace("{{number}}", "(\\d\\d)"), "g"))].map((match) => match[1]);
    assert.deepEqual(order, ["03", "02", "01"]);
    assert.equal(out.match(/aria-current="true"/g)?.length, 1);
    assert.ok(out.includes(labels.historyCurrent));
    assert.match(out, /<span class="history-entry-fidelity">[^<]+<\/span><span class="history-source" title="very-long-source-name-that-must-truncate-with-ellipsis.png">/);
  }
  assert.match(dialogHtml("en", w), /5 minutes ago/);
  assert.match(dialogHtml("es", w), /hace 5 minutos/);
});

test("per-project states: loading skeleton, no generations, error with Retry, no projects", async () => {
  const loading = world(() => new Promise(() => {}));
  await loading.projects.loadProjects();
  void loading.library.loadProject(projectA);
  loading.library.openDialog(projectA, null);
  assert.match(dialogHtml("en", loading), /class="history-log history-skeleton" aria-label="Loading generations…"/);

  const none = world(async () => []);
  await none.projects.loadProjects();
  await none.library.loadProject(projectA);
  none.library.openDialog(projectA, null);
  assert.ok(dialogHtml("es", none).includes(es.libraryNoGenerations));

  const failed = world(async () => { throw new ProjectsClientError("SERVER_ERROR"); });
  await failed.projects.loadProjects();
  await failed.library.loadProject(projectA);
  failed.library.openDialog(projectA, null);
  const out = dialogHtml("en", failed);
  assert.match(out, /role="alert"/);
  assert.ok(out.includes("generations could not be loaded") && out.includes(en.historyRetry));

  const empty = world();
  empty.library.openDialog(null, null);
  const emptyOut = dialogHtml("es", empty);
  assert.ok(emptyOut.includes(es.projectsLoading));
  await empty.projects.loadProjects();
  empty.projects.reset();
  assert.ok(dialogHtml("es", empty).includes(es.projectsLoading) || dialogHtml("es", empty).includes(es.libraryEmpty));
});

test("a failed refresh over a cached list says the list is stale, not that there is no data (ES/EN)", async () => {
  let fail = false;
  const w = world(async (id) => { if (fail) throw new ProjectsClientError("NETWORK_ERROR"); return id === projectA ? [a1, a2] : []; });
  await w.projects.loadProjects();
  await w.library.loadProject(projectA);
  fail = true;
  await w.library.loadProject(projectA);
  w.library.openDialog(projectA, null);
  for (const [language, labels] of [["es", es], ["en", en]] as const) {
    const out = dialogHtml(language, w);
    const escaped = (value: string) => value.replaceAll("'", "&#x27;");
    assert.ok(out.includes(escaped(labels.libraryStale)), language);
    assert.ok(!out.includes(escaped(labels.libraryError)), "not the empty-load message");
    assert.ok(out.includes(labels.historyRetry), "Retry stays available");
    assert.equal((out.match(/class="history-entry"/g) ?? []).length, 2, "cached entries stay visible");
  }
  assert.equal(es.libraryStale, "No se pudo actualizar. Mostrando lo último cargado.");
});

test("accordion expands lazily: only the expanded project is requested, one open at a time", async () => {
  const w = world();
  await w.projects.loadProjects();
  w.library.openDialog(null, null);
  const { d, render } = mount("en", w);
  let tree = render();
  d.flushEffects();
  assert.deepEqual(w.requested, [], "nothing expanded, nothing requested");
  toggles(tree)[0].props.onClick();
  tree = render();
  d.flushEffects();
  await settle();
  assert.deepEqual(w.requested, [projectA]);
  assert.equal(toggles(tree)[0].props["aria-expanded"], true);
  toggles(tree)[1].props.onClick();
  tree = render();
  d.flushEffects();
  await settle();
  assert.deepEqual(w.requested, [projectA, projectB]);
  assert.deepEqual(toggles(tree).map((n) => n.props["aria-expanded"]), [false, true]);
});

test("focus: close button first, Esc closes, focus returns to the trigger, picks go through the guard", async () => {
  const w = world();
  await w.projects.loadProjects();
  await w.library.loadProject(projectA);
  const log: string[] = [];
  const trigger = fakeNode("trigger", log) as unknown as HTMLElement;
  w.library.openDialog(projectA, trigger);
  const navigations: string[] = [];
  const { d, render } = mount("en", w, () => navigations.push("code"));
  const tree = render();
  const [sheetRef, closeRef] = d.refs;
  sheetRef!.current = fakeNode("sheet", log);
  closeRef!.current = fakeNode("close", log);
  d.flushEffects();
  assert.deepEqual(log, ["close"], "initial focus on the close button");
  const dialog = findAll(tree, (n) => n.props?.role === "dialog")[0];
  assert.equal(dialog.props["aria-modal"], "true");
  let prevented = false;
  dialog.props.onKeyDown({ key: "Escape", shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(w.library.getSnapshot().open, false, "Esc closes");
  d.unmount();
  assert.deepEqual(log, ["close", "trigger"], "focus returns to the opener");

  // Picking with edits goes through the shared discard dialog and keeps the library open on Cancel.
  w.library.openDialog(projectA, null);
  w.editor.setProject(generateReactProject(uiSchemaFixture));
  w.editor.edit("// unsaved");
  const session = mount("en", w, () => navigations.push("code"));
  const picked = entries(session.render())[1];
  picked.props.onClick({ currentTarget: {} });
  await settle();
  assert.equal(w.guard.getSnapshot().open, true);
  w.guard.cancel();
  await settle();
  assert.deepEqual(w.opened, []);
  assert.equal(w.library.getSnapshot().open, true);
  entries(session.render())[1].props.onClick({ currentTarget: {} });
  await settle();
  w.guard.confirm();
  await settle();
  assert.deepEqual(w.opened, [generationTwo]);
  assert.deepEqual(navigations, ["code"]);
  assert.equal(w.library.getSnapshot().open, false);
});

test("a second pick while a restore is in flight is ignored", async () => {
  const pending = deferred<ReturnType<typeof storedGeneration>>();
  let requests = 0;
  const w = world(undefined, undefined, { getGeneration: () => { requests++; return pending.promise; } });
  await w.projects.loadProjects();
  await w.library.loadProject(projectA);
  w.library.openDialog(projectA, null);
  const { render } = mount("en", w);
  const buttons = entries(render());
  buttons[0].props.onClick({ currentTarget: {} });
  buttons[1].props.onClick({ currentTarget: {} });
  await settle();
  assert.equal(requests, 1);
  const busy = entries(render());
  assert.equal(busy[0].props["aria-busy"], true);
  assert.equal(busy[1].props.disabled, true);
  pending.resolve(storedGeneration(projectA, g3));
  await settle();
});

// ---- Chip, nav, shell -----------------------------------------------------------------------------

test("Code view project chip is a button that opens the library with that project", async () => {
  const w = world();
  await w.projects.loadProjects();
  await w.projects.selectProject(projectA);
  const trayExports = loadModule("projects/GenerationHistoryTray.tsx", "en", React);
  const history = { getSnapshot: () => ({ projectId: projectA, status: "READY", items: [], error: null, revision: 0 }), subscribe: () => () => {} };
  const calls: Array<[string | null, unknown]> = [];
  const props = { editor: w.editor, session: w.session, projects: w.projects, history, discardGuard: w.guard,
    onOpenLibrary: (id: string | null, trigger: HTMLElement | null) => calls.push([id, trigger]) };
  const extra = { "/GenerationHistoryTray": trayExports };
  const out = html("workspace/CodeContext.tsx", "CodeContext", "en", props, extra);
  assert.match(out, /<button type="button" class="code-identity-name" title="Alpha" aria-haspopup="dialog" aria-label="Open library: Alpha">Alpha<\/button>/);
  assert.ok(html("workspace/CodeContext.tsx", "CodeContext", "es", props, extra).includes('aria-label="Abrir biblioteca: Alpha"'));
  const d = driver("workspace/CodeContext.tsx", "CodeContext", "en", extra);
  const tree = d.render(props);
  const chip = findAll(tree, (n) => n.props?.className === "code-identity-name")[0];
  const element = {} as HTMLElement;
  chip.props.onClick({ currentTarget: element });
  assert.deepEqual(calls, [[projectA, element]]);
});

test("Library rail entry opens the dialog without changing view and is active only while open", () => {
  const w = world();
  const out = (language: Lang) => html("workspace/LibraryNavButton.tsx", "LibraryNavButton", language, { library: w.library });
  assert.match(out("es"), /aria-haspopup="dialog" aria-expanded="false" aria-label="Biblioteca" title="Biblioteca"/);
  assert.doesNotMatch(out("es"), /aria-current/);
  assert.doesNotMatch(out("es"), /disabled/);
  const d = driver("workspace/LibraryNavButton.tsx", "LibraryNavButton", "en");
  const button = d.render({ library: w.library });
  const trigger = {} as HTMLElement;
  button.props.onClick({ currentTarget: trigger });
  assert.equal(w.library.getSnapshot().open, true);
  assert.equal(w.library.getSnapshot().trigger, trigger);
  assert.match(out("en"), /aria-expanded="true" aria-current="true"/);
});

function shellHtml(language: Lang, props: Record<string, unknown>) {
  const extra = {
    "./Workspace": { Workspace: () => React.createElement("div", { id: "workspace" }) },
    "../editor/EditorWorkspace": { EditorWorkspace: () => React.createElement("div", { id: "code-workspace" }) },
    "../settings/SettingsScreen": { SettingsScreen: () => React.createElement("main", { id: "settings-workspace" }) },
    "../editor/editorModel": { createEditorModel: () => ({}) },
    "../preview/previewModel": { createPreviewModel: () => ({}) },
    "../preview/PreviewPanel": { PreviewPanel: () => null },
    "../preview/previewSync": { syncEditorToPreview: () => ({ dispose() {} }) },
    "../projects/ProjectVault": { ProjectVault: () => React.createElement("main", { id: "project-vault" }) },
  };
  const exports = loadModule("workspace/ApplicationShell.tsx", language, { ...React, useEffect: () => {} }, {}, extra);
  return renderToStaticMarkup(React.createElement(exports.ApplicationShell, props));
}

test("shell: disabled Library placeholder by default; slot enables it; dialog host receives openCode", () => {
  assert.match(shellHtml("en", { onLogin() {} }), /disabled="" aria-label="Library, coming soon"/);
  const slotHtml = shellHtml("en", { onLogin() {}, libraryNav: React.createElement("button", { id: "library-nav" }, "Library") });
  assert.match(slotHtml, /id="library-nav"/);
  assert.doesNotMatch(slotHtml, /Library, coming soon/);
  let received: unknown = null;
  const hosted = shellHtml("en", {
    onLogin() {},
    libraryDialog: (navigation: { openCode: () => void }) => { received = navigation.openCode; return React.createElement("div", { id: "library-host" }); },
  });
  assert.equal(typeof received, "function");
  assert.match(hosted, /id="library-host"/);
});

test("rail labels are short and never break mid-word; full names stay in aria-label and title", () => {
  const user = { id: "u", email: "designer@example.com", emailVerified: true };
  const spanish = shellHtml("es", { onLogin() {}, user });
  assert.match(spanish, /<small>Ajustes<\/small>/);
  assert.match(spanish, /<small>Salir<\/small>/);
  assert.match(spanish, /aria-label="Configuración"/);
  assert.match(spanish, /aria-label="Cerrar sesión"/);
  const english = shellHtml("en", { onLogin() {}, user });
  assert.match(english, /<small>Settings<\/small>/);
  assert.match(english, /<small>Sign out<\/small>/);
  const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  const rule = css.split("\n").find((line) => line.trimStart().startsWith(".navigation-item small { font-family")) ?? "";
  assert.doesNotMatch(rule, /overflow-wrap:\s*anywhere|word-break:\s*break-all/);
  assert.match(rule, /overflow-wrap: normal;/);
});

test("polish: tray lines separate with ellipsis, vault cards align by content start", () => {
  const css = readFileSync(new URL("../src/features/projects/vault.css", import.meta.url), "utf8");
  const rule = (selector: string) => css.split("\n").find((line) => line.trimStart().startsWith(selector + " {")) ?? "";
  assert.match(rule(".history-source"), /display: block;[^}]*overflow: hidden;[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
  assert.match(rule(".history-entry-fidelity"), /color: var\(--color-muted\)/);
  assert.match(rule(".vault-card"), /align-content: start;/);
  const tray = readFileSync(new URL("../src/features/projects/GenerationHistoryTray.tsx", import.meta.url), "utf8");
  assert.match(tray, /<span className="history-entry-fidelity">[^]*<span className="history-source" title=\{source\}>/);
});

// ---- Isolation and lifecycle ------------------------------------------------------------------------

test("the library never imports AI, analysis, the generator, auth, toasts or the single-project history", () => {
  for (const file of ["libraryModel.ts", "libraryActions.ts", "LibraryDialog.tsx"]) {
    const source = readFileSync(new URL("../src/features/projects/" + file, import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import .*from "([^"]+)";$/gm)].map((match) => match[1]!);
    for (const specifier of imports) {
      assert.doesNotMatch(specifier, /generateReactProject|analysis|features\/auth|\/auth\/|feedback|toast|generationHistoryModel|openai|supabase/i, `${file}: ${specifier}`);
    }
  }
  const model = readFileSync(new URL("../src/features/projects/libraryModel.ts", import.meta.url), "utf8");
  assert.match(model, /Pick<ProjectsClient, "listGenerations">/);
});

test("sign-out and session expiry close the library and clear its cache", async () => {
  for (const leave of ["signOut", "expireSession"] as const) {
    const auth = createAuthModel({
      restoreSession: async () => null,
      signIn: async () => ({ user: { id: "user-a", email: "a@example.com", emailVerified: true } }),
      signUp: async () => { throw new Error("unused"); },
      signOut: async () => {},
      getAccessToken: async () => "token",
    }, { autoRestore: false });
    const services = createWorkspaceServices({
      getAccessToken: auth.getAccessToken,
      onUnauthorized: () => {},
      transport: (async (input: string | URL | Request) => {
        if (String(input).endsWith("/generations")) return Response.json([a1]);
        return Response.json([summaryA]);
      }) as typeof fetch,
      editorModel: createEditorModel(),
      previewModel: createPreviewModel({ kind: "placeholder", render: async () => ({ documentHtml: "" }) }),
    });
    const unbind = bindWorkspaceToAuth(auth, services);
    await auth.signIn({ email: "a@example.com", password: "correct-horse" });
    await services.projectsModel.loadProjects();
    services.library.openDialog(projectA, null);
    await services.library.loadProject(projectA);
    assert.equal(services.library.getSnapshot().entries[projectA]!.items.length, 1);
    await auth[leave]();
    assert.equal(services.library.getSnapshot().open, false);
    assert.deepEqual(services.library.getSnapshot().entries, {});
    unbind();
  }
});

test("App hosts one library dialog and wires the rail entry, the chip and the shared discard dialog", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal((app.match(/<LibraryDialog/g) ?? []).length, 1);
  assert.match(app, /libraryNav=\{<LibraryNavButton/);
  assert.match(app, /onOpenLibrary=\{/);
  assert.match(app, /confirmDiscard=\{\(trigger\) => services\.discardGuard\.request\(trigger\)\}/);
  assert.equal((app.match(/<DiscardDialog/g) ?? []).length, 1, "the existing discard dialog is reused, not duplicated");
});
