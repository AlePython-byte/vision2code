import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ProjectSummary } from "@vision2code/contracts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createGenerationArtifact } from "../src/features/generation/generationArtifact.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import type { PreviewEngine } from "../src/features/preview/previewTypes.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { deriveResultChip } from "../src/features/projects/historySelectors.ts";
import { PROJECT_MANAGE_TOAST_KEY, createProjectManager } from "../src/features/projects/projectManageActions.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import { createWorkspaceServices } from "../src/features/workspace/workspaceServices.ts";
import { saveToastFor } from "../src/features/feedback/generationToasts.ts";
import * as vaultActions from "../src/features/projects/vaultActions.ts";
import * as vaultSelectors from "../src/features/projects/vaultSelectors.ts";
import {
  deferred, fakeClient, generationOne, projectA, projectB, screenshot, storedGeneration, summaryA, summaryB, summaryOf, uiSchemaFixture,
} from "./generation-fixtures.ts";
import { driver, fakeNode, findAll, html, settle, text, type Node } from "./ui-harness.ts";

const engine: PreviewEngine = { kind: "placeholder", render: async () => ({ documentHtml: "<html></html>" }) };
const alpha: ProjectSummary = { ...summaryA, generationCount: 2, latestGenerationId: generationOne };
const renamedAt = "2026-10-14T09:00:00.000Z";

// ---- Fake API -------------------------------------------------------------------------------

type Handler = () => Response | Promise<Response>;
/** Real ProjectsClient over a routed transport; each mutation route can be overridden or deferred. */
function api() {
  const calls: string[] = [];
  const routes: { rename: Handler; remove: Handler; save: Handler; restore: Handler; listGenerations: Handler } = {
    rename: () => Response.json({ id: projectA, name: "Alpha 2", createdAt: summaryA.createdAt, updatedAt: renamedAt }),
    remove: () => new Response(null, { status: 204 }),
    save: () => new Response(null, { status: 404 }),
    restore: () => Response.json(storedGeneration(projectA, generationOne)),
    listGenerations: () => Response.json([summaryOf(generationOne, "2026-10-12T09:00:00.000Z")]),
  };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace("/api/v1", "");
    const method = init?.method ?? "GET";
    calls.push(`${method} ${path}`);
    if (method === "GET" && path === "/projects") return Response.json([alpha, summaryB]);
    if (method === "GET" && path === `/projects/${projectA}`) return Response.json({ id: projectA, name: alpha.name, createdAt: alpha.createdAt, updatedAt: alpha.updatedAt, generations: [] });
    if (method === "GET" && path === `/projects/${projectB}`) return Response.json({ id: projectB, name: "Beta", createdAt: summaryB.createdAt, updatedAt: summaryB.updatedAt, generations: [] });
    if (method === "PATCH") return routes.rename();
    if (method === "DELETE") return routes.remove();
    if (method === "POST" && path.endsWith("/generations")) return routes.save();
    if (method === "GET" && path.endsWith("/generations")) return routes.listGenerations();
    if (method === "GET" && path.includes("/generations/")) return routes.restore();
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls, routes };
}

async function workspace() {
  const net = api();
  let expired = 0;
  const services = createWorkspaceServices({
    getAccessToken: async () => "token", onUnauthorized: () => { expired++; },
    baseUrl: "http://localhost:3000/api/v1", transport: net.fetcher,
    editorModel: createEditorModel(), previewModel: createPreviewModel(engine),
  });
  await services.projectsModel.loadProjects();
  return { services, net, expired: () => expired };
}
type World = Awaited<ReturnType<typeof workspace>>;

function artifactFor(targetProjectId: string | null) {
  return createGenerationArtifact({
    uiSchema: uiSchemaFixture, generatedProject: generateReactProject(uiSchemaFixture),
    fidelity: "balanced", screenshot: screenshot(), targetProjectId,
  });
}
const toast = (w: World, key: string) => w.services.toasts.getSnapshot().toasts.find((item) => item.key === key) ?? null;
const count = (w: World, call: string) => w.net.calls.filter((item) => item === call).length;
const deleteCall = `DELETE /projects/${projectA}`;

// ---- Projects model: pessimistic mutations with explicit results -----------------------------

test("delete is pessimistic: the project stays listed and selected until the server confirms", async () => {
  const pending = deferred<void>();
  const { client } = fakeClient({ listProjects: async () => [alpha, summaryB], deleteProject: () => pending.promise });
  const projects = createProjectsModel(client);
  await projects.loadProjects();
  await projects.selectProject(projectA);
  const running = projects.deleteProject(projectA);
  assert.deepEqual(projects.getSnapshot().projects.map((item) => item.id), [projectA, projectB]);
  assert.equal(projects.getSnapshot().selectedProjectId, projectA);
  pending.resolve();
  assert.deepEqual(await running, { ok: true });
  assert.deepEqual(projects.getSnapshot().projects.map((item) => item.id), [projectB]);
  assert.equal(projects.getSnapshot().selectedProjectId, null);
  assert.equal(projects.getSnapshot().selectedProject, null);
});

test("delete 404 means already gone: success, removed locally; 5xx/network keep everything and never expire", async () => {
  let expired = 0;
  for (const code of ["NOT_FOUND", "SERVER_ERROR", "NETWORK_ERROR", "UNAUTHORIZED"] as const) {
    const { client } = fakeClient({ listProjects: async () => [alpha, summaryB], deleteProject: async () => { throw new ProjectsClientError(code); } });
    const projects = createProjectsModel(client, () => { expired++; });
    await projects.loadProjects();
    await projects.selectProject(projectA);
    const before = projects.getSnapshot();
    const result = await projects.deleteProject(projectA);
    if (code === "NOT_FOUND") {
      assert.deepEqual(result, { ok: true });
      assert.equal(projects.getSnapshot().projects.some((item) => item.id === projectA), false);
      continue;
    }
    assert.deepEqual(result, { ok: false, code });
    assert.equal(projects.getSnapshot().projects, before.projects, `${code}: list untouched`);
    assert.equal(projects.getSnapshot().selectedProjectId, projectA);
    assert.equal(projects.getSnapshot().status, before.status, "the Vault's list status is not turned into an error");
    assert.equal(projects.getSnapshot().error, null);
  }
  assert.equal(expired, 1, "only the 401 expires the session, exactly once");
});

test("rename keeps generation counts, follows updatedAt and renames the selected detail; 404 removes it locally", async () => {
  const { client } = fakeClient({
    listProjects: async () => [summaryB, alpha],
    renameProject: async (id, input) => ({ id, name: input.name, createdAt: alpha.createdAt, updatedAt: renamedAt }),
  });
  const projects = createProjectsModel(client);
  await projects.loadProjects();
  await projects.selectProject(projectA);
  assert.deepEqual(await projects.renameProject(projectA, "Alpha 2"), { ok: true });
  const [first] = projects.getSnapshot().projects;
  assert.equal(first?.id, projectA, "rename bumps updatedAt, so Recent puts it first");
  assert.equal(first?.name, "Alpha 2");
  assert.equal(first?.generationCount, 2);
  assert.equal(first?.latestGenerationId, generationOne);
  assert.equal(projects.getSnapshot().selectedProject?.name, "Alpha 2");

  const gone = createProjectsModel(fakeClient({ listProjects: async () => [alpha, summaryB], renameProject: async () => { throw new ProjectsClientError("NOT_FOUND"); } }).client);
  await gone.loadProjects();
  await gone.selectProject(projectA);
  assert.deepEqual(await gone.renameProject(projectA, "Ghost"), { ok: false, code: "NOT_FOUND" });
  assert.deepEqual(gone.getSnapshot().projects.map((item) => item.id), [projectB]);
  assert.equal(gone.getSnapshot().selectedProjectId, null);
});

test("a mutation answering after reset is ignored and reports null", async () => {
  const pending = deferred<void>();
  const projects = createProjectsModel(fakeClient({ listProjects: async () => [alpha], deleteProject: () => pending.promise }).client);
  await projects.loadProjects();
  const running = projects.deleteProject(projectA);
  projects.reset();
  pending.resolve();
  assert.equal(await running, null);
  assert.deepEqual(projects.getSnapshot().projects, []);
});

// ---- Delete through the workspace services ---------------------------------------------------

test("deleting the selected project empties the selection, updates the Vault list and shows a transient toast", async () => {
  const w = await workspace();
  await w.services.projectsModel.selectProject(projectA);
  assert.equal(w.services.projectManager.requestDelete(projectA, null), true);
  assert.deepEqual(w.services.projectManager.getSnapshot().dialog?.generationCount, 2);
  assert.equal(await w.services.projectManager.confirmDelete(), "DONE");
  const projects = w.services.projectsModel.getSnapshot();
  assert.deepEqual(projects.projects.map((item) => item.id), [projectB]);
  assert.equal(projects.selectedProjectId, null);
  assert.equal(w.services.projectManager.getSnapshot().dialog, null);
  const notice = toast(w, PROJECT_MANAGE_TOAST_KEY);
  assert.equal(notice?.message, "projectDeleted");
  assert.equal(notice?.tone, "success");
  assert.equal(notice?.persistent, false);
});

test("deleting the current result's project keeps code and edits, detaches it to local only, and asks no discard", async () => {
  for (const edited of [true, false]) {
    const w = await workspace();
    await w.services.projectsModel.selectProject(projectA);
    w.net.routes.save = () => Response.json({ ...storedGeneration(projectA, generationOne), createdAt: "2026-10-13T12:00:00.000Z" }, { status: 201 });
    await w.services.generationSession.complete(artifactFor(projectA));
    assert.equal(w.services.generationSession.getSnapshot().saveStatus, "SAVED");
    if (edited) w.services.editorModel.edit("// my local edit");
    const editorBefore = w.services.editorModel.getSnapshot();
    const artifactBefore = w.services.generationSession.getSnapshot().artifact;
    let discardRequests = 0;
    const off = w.services.discardGuard.subscribe(() => { if (w.services.discardGuard.getSnapshot().open) discardRequests++; });
    w.services.projectManager.requestDelete(projectA, null);
    assert.equal(await w.services.projectManager.confirmDelete(), "DONE");
    off();
    const session = w.services.generationSession.getSnapshot();
    assert.equal(session.artifact, artifactBefore, "same result, same code");
    assert.equal(session.projectId, null);
    assert.equal(session.generationId, null);
    assert.equal(session.saveStatus, "DETACHED");
    assert.equal(w.services.editorModel.getSnapshot(), editorBefore, "editor files and drafts are untouched");
    assert.equal(w.services.editorModel.getSnapshot().drafts.size, edited ? 1 : 0);
    assert.equal(discardRequests, 0, "nothing is discarded, so no confirmation");
    assert.equal(w.services.history.getSnapshot().projectId, null, "no history for a local-only result");
    assert.equal(w.services.history.getSnapshot().items.length, 0);
    assert.deepEqual(deriveResultChip({ origin: session.origin, saveStatus: session.saveStatus, draftCount: edited ? 1 : 0, generationNumber: null })?.label, "chipLocal");
    assert.equal(count(w, `POST /projects/${projectA}/generations`), 1, "never saved again or recreated");
    assert.equal(w.net.calls.some((call) => call.startsWith("POST /projects") && !call.includes("/generations")), false, "the project is never recreated");
  }
});

test("a save in flight for the deleted project answers late and is ignored: no SAVE_FAILED, no save toast", async () => {
  for (const late of [() => new Response(null, { status: 404 }), () => Response.json({ ...storedGeneration(projectA, generationOne) }, { status: 201 })]) {
    const w = await workspace();
    const save = deferred<Response>();
    w.net.routes.save = () => save.promise;
    const saving = w.services.generationSession.complete(artifactFor(projectA));
    assert.equal(w.services.generationSession.getSnapshot().saveStatus, "SAVING");
    w.services.projectManager.requestDelete(projectA, null);
    assert.equal(await w.services.projectManager.confirmDelete(), "DONE");
    save.resolve(late());
    await saving;
    await settle();
    const session = w.services.generationSession.getSnapshot();
    assert.equal(session.saveStatus, "DETACHED");
    assert.equal(session.generationId, null);
    assert.equal(toast(w, "generation-save"), null, "no confusing save toast");
    assert.equal(w.services.projectsModel.getSnapshot().projects.some((item) => item.id === projectA), false, "a late success never resurrects it");
    assert.equal(w.services.generationSession.getSnapshot().projectId, null);
    await w.services.generationSession.retrySave();
    assert.equal(count(w, `POST /projects/${projectA}/generations`), 1, "retry is not offered for a detached result");
  }
});

test("an analysis that targeted a deleted project completes local only and is never saved there", async () => {
  const w = await workspace();
  w.services.projectManager.requestDelete(projectA, null);
  await w.services.projectManager.confirmDelete();
  await w.services.generationSession.complete(artifactFor(projectA));
  assert.equal(w.services.generationSession.getSnapshot().saveStatus, "DETACHED");
  assert.equal(count(w, `POST /projects/${projectA}/generations`), 0);
  assert.equal(saveToastFor(w.services.generationSession.getSnapshot(), () => {}), null);
});

test("a restore in flight for the deleted project is ignored when it answers", async () => {
  const w = await workspace();
  const restore = deferred<Response>();
  w.net.routes.restore = () => restore.promise;
  const opening = w.services.generationSession.openGeneration(projectA, generationOne);
  w.services.projectManager.requestDelete(projectA, null);
  await w.services.projectManager.confirmDelete();
  restore.resolve(Response.json(storedGeneration(projectA, generationOne)));
  assert.equal(await opening, false);
  const session = w.services.generationSession.getSnapshot();
  assert.equal(session.artifact, null);
  assert.equal(session.restoreStatus, "IDLE", "no restore error toast for a project that is gone");
});

test("the library forgets the deleted project's cache and focus; other projects stay cached", async () => {
  const w = await workspace();
  await w.services.library.loadProject(projectA);
  await w.services.library.loadProject(projectB);
  w.services.library.openDialog(projectA, null);
  const pending = deferred<Response>();
  w.net.routes.listGenerations = () => pending.promise;
  const refreshing = w.services.library.loadProject(projectA);
  w.services.projectManager.requestDelete(projectA, null);
  await w.services.projectManager.confirmDelete();
  pending.resolve(Response.json([summaryOf(generationOne, "2026-10-12T09:00:00.000Z")]));
  await refreshing;
  const library = w.services.library.getSnapshot();
  assert.equal(projectA in library.entries, false, "a late list response cannot repopulate it");
  assert.equal(library.focusProjectId, null);
  assert.equal(projectB in library.entries, true);
});

test("a failed delete keeps list, selection and result; the dialog shows the error and retry succeeds", async () => {
  const w = await workspace();
  await w.services.projectsModel.selectProject(projectA);
  w.net.routes.save = () => Response.json({ ...storedGeneration(projectA, generationOne) }, { status: 201 });
  await w.services.generationSession.complete(artifactFor(projectA));
  w.net.routes.remove = () => new Response(null, { status: 503 });
  const before = { projects: w.services.projectsModel.getSnapshot().projects, session: w.services.generationSession.getSnapshot() };
  w.services.projectManager.requestDelete(projectA, null);
  assert.equal(await w.services.projectManager.confirmDelete(), "FAILED");
  assert.equal(w.services.projectsModel.getSnapshot().projects, before.projects);
  assert.equal(w.services.projectsModel.getSnapshot().selectedProjectId, projectA);
  assert.equal(w.services.generationSession.getSnapshot(), before.session);
  const dialog = w.services.projectManager.getSnapshot().dialog;
  assert.equal(dialog?.status, "ERROR");
  assert.equal(dialog?.error, "SERVER_ERROR");
  assert.equal(toast(w, PROJECT_MANAGE_TOAST_KEY), null, "the failure stays in the dialog");
  assert.equal(w.expired(), 0, "5xx never expires the session");
  w.net.routes.remove = () => new Response(null, { status: 204 });
  assert.equal(await w.services.projectManager.confirmDelete(), "DONE");
  assert.deepEqual(w.services.projectsModel.getSnapshot().projects.map((item) => item.id), [projectB]);
});

test("double click and simultaneous actions send a single request", async () => {
  const w = await workspace();
  const pending = deferred<Response>();
  w.net.routes.remove = () => pending.promise;
  w.services.projectManager.requestDelete(projectA, null);
  const first = w.services.projectManager.confirmDelete();
  const second = w.services.projectManager.confirmDelete();
  assert.equal(first, second, "the second click shares the running request");
  assert.equal(w.services.projectManager.cancel(), "CANCELLED");
  assert.ok(w.services.projectManager.getSnapshot().dialog, "cancel is ignored while the request runs");
  assert.equal(w.services.projectManager.requestRename(projectA, null), false, "no second action on the project meanwhile");
  assert.equal(w.services.projectManager.requestDelete(projectB, null), false);
  pending.resolve(new Response(null, { status: 204 }));
  assert.equal(await first, "DONE");
  assert.equal(count(w, deleteCall), 1);
});

test("401 expires the session exactly once and reports UNAUTHORIZED", async () => {
  const w = await workspace();
  w.net.routes.remove = () => new Response(null, { status: 401 });
  w.services.projectManager.requestDelete(projectA, null);
  assert.equal(await w.services.projectManager.confirmDelete(), "UNAUTHORIZED");
  assert.equal(w.expired(), 1);
  assert.equal(w.services.projectManager.getSnapshot().dialog?.error, "UNAUTHORIZED");
  assert.equal(w.services.projectsModel.getSnapshot().projects.length, 2);
});

test("reset (sign-out/expiry) closes the dialog and ignores the late answer: no removal callbacks, no toast", async () => {
  const w = await workspace();
  const pending = deferred<Response>();
  w.net.routes.remove = () => pending.promise;
  w.services.projectManager.requestDelete(projectA, null);
  const running = w.services.projectManager.confirmDelete();
  w.services.reset();
  assert.equal(w.services.projectManager.getSnapshot().dialog, null);
  pending.resolve(new Response(null, { status: 204 }));
  assert.equal(await running, "CANCELLED");
  assert.equal(toast(w, PROJECT_MANAGE_TOAST_KEY), null);
  // The next session can use the same project id again: nothing stays detached across sessions.
  await w.services.projectsModel.loadProjects();
  w.net.routes.save = () => Response.json({ ...storedGeneration(projectA, generationOne) }, { status: 201 });
  await w.services.generationSession.complete(artifactFor(projectA));
  assert.equal(w.services.generationSession.getSnapshot().saveStatus, "SAVED");
});

// ---- Rename through the workspace services ---------------------------------------------------

test("rename updates the name everywhere it is read: list, selection, chip, library and code identity", async () => {
  const w = await workspace();
  await w.services.projectsModel.selectProject(projectA);
  w.services.projectManager.requestRename(projectA, null);
  assert.equal(w.services.projectManager.getSnapshot().dialog?.name, "Alpha");
  assert.equal(await w.services.projectManager.confirmRename("  Alpha 2  "), "DONE");
  const state = w.services.projectsModel.getSnapshot();
  assert.equal(state.projects.find((item) => item.id === projectA)?.name, "Alpha 2");
  assert.equal(state.selectedProject?.name, "Alpha 2");
  assert.equal(toast(w, PROJECT_MANAGE_TOAST_KEY)?.message, "projectRenamed");
  const chip = html("projects/ProjectChip.tsx", "ProjectChip", "en", { projects: w.services.projectsModel, session: w.services.generationSession, analysisTargetProjectId: undefined, onChange: () => {} });
  assert.ok(chip.includes("Alpha 2"));
  w.services.library.openDialog(projectA, null);
  const library = html("projects/LibraryDialog.tsx", "LibraryDialog", "en", {
    library: w.services.library, projects: w.services.projectsModel, session: w.services.generationSession, openCode: () => {},
    now: () => new Date(), hasLocalEdits: () => false, confirmDiscard: async () => true,
  });
  assert.ok(library.includes(">Alpha 2<"));
  const identity = html("workspace/CodeContext.tsx", "CodeContext", "en", {
    editor: w.services.editorModel, session: w.services.generationSession, projects: w.services.projectsModel,
    history: w.services.history, discardGuard: w.services.discardGuard, now: () => new Date(),
  }, { "/GenerationHistoryTray": { GenerationHistoryTray: () => null } });
  assert.ok(identity.includes(">Alpha 2</button>"));
});

test("rename validation matches project creation; an invalid or unchanged name sends nothing", async () => {
  const w = await workspace();
  w.services.projectManager.requestRename(projectA, null);
  for (const name of ["", "    ", "X".repeat(101)]) assert.equal(await w.services.projectManager.confirmRename(name), "FAILED");
  assert.equal(count(w, `PATCH /projects/${projectA}`), 0);
  assert.equal(await w.services.projectManager.confirmRename(" Alpha "), "CANCELLED", "same name after trim closes without a request");
  assert.equal(count(w, `PATCH /projects/${projectA}`), 0);
});

test("rename failure keeps the dialog open with the error; 404 removes the project and warns with a toast", async () => {
  const w = await workspace();
  w.net.routes.rename = () => new Response(null, { status: 500 });
  w.services.projectManager.requestRename(projectA, null);
  assert.equal(await w.services.projectManager.confirmRename("Alpha 2"), "FAILED");
  assert.equal(w.services.projectManager.getSnapshot().dialog?.status, "ERROR");
  assert.equal(w.services.projectsModel.getSnapshot().projects.find((item) => item.id === projectA)?.name, "Alpha");
  w.net.routes.rename = () => new Response(null, { status: 404 });
  await w.services.library.loadProject(projectA);
  assert.equal(await w.services.projectManager.confirmRename("Alpha 2"), "NOT_FOUND");
  assert.equal(w.services.projectManager.getSnapshot().dialog, null);
  assert.equal(w.services.projectsModel.getSnapshot().projects.some((item) => item.id === projectA), false);
  assert.equal(projectA in w.services.library.getSnapshot().entries, false);
  const notice = toast(w, PROJECT_MANAGE_TOAST_KEY);
  assert.equal(notice?.message, "projectManageGone");
  assert.equal(notice?.persistent, false);
});

test("the manager never opens for an unknown project and cancel changes nothing", () => {
  const manager = createProjectManager({
    projects: createProjectsModel(fakeClient().client), toasts: { show: () => { throw new Error("no toast"); } },
    onProjectRemoved: () => { throw new Error("nothing removed"); },
  });
  assert.equal(manager.requestDelete(projectA, null), false);
  assert.equal(manager.getSnapshot().dialog, null);
  assert.equal(manager.cancel(), "CANCELLED");
});

// ---- UI ---------------------------------------------------------------------------------------

const vaultModules = { "/NewProjectDialog": { NewProjectDialog: () => null }, "/vaultActions": vaultActions, "/vaultSelectors": vaultSelectors };
async function vaultWorld() {
  const w = await workspace();
  const managed: string[] = [];
  const props = {
    projects: w.services.projectsModel, session: w.services.generationSession, toasts: w.services.toasts,
    onCapture: () => {}, onEditor: () => {}, now: () => new Date("2026-10-14T12:00:00.000Z"),
    onManageProject: (kind: string, projectId: string, trigger: HTMLElement) => managed.push(`${kind}:${projectId}:${(trigger as unknown as { label: string }).label}`),
  };
  return { w, managed, props };
}

test("Vault cards offer Rename and Delete as sibling buttons (never nested), labelled, without opening the project", async () => {
  const { w, managed, props } = await vaultWorld();
  for (const [language, labels] of [["es", es], ["en", en]] as const) {
    const out = html("projects/ProjectVault.tsx", "ProjectVault", language, props, vaultModules);
    for (const button of out.split("<button").slice(1)) {
      assert.ok(button.indexOf("</button>") < (button.indexOf("<button") === -1 ? Infinity : button.indexOf("<button")), "no button inside a button");
    }
    const rename = labels.vaultRenameProject.replace("{{name}}", "Alpha");
    const remove = labels.vaultDeleteProject.replace("{{name}}", "Alpha");
    assert.ok(out.includes(`aria-label="${rename}" title="${rename}"`), language);
    assert.ok(out.includes(`aria-label="${remove}" title="${remove}"`), language);
  }
  const d = driver("projects/ProjectVault.tsx", "ProjectVault", "en", vaultModules);
  const tree = d.render(props);
  const tools = findAll(tree, (node: Node) => node.props?.className === "vault-card-tool");
  assert.equal(tools.length, 4, "two tools per card");
  const selections = w.net.calls.length;
  const tool = (label: string) => tools.find((node: Node) => node.props["aria-label"] === label);
  tool("Rename Alpha").props.onClick({ currentTarget: fakeNode("rename-alpha", []) });
  tool("Delete Alpha").props.onClick({ currentTarget: fakeNode("delete-alpha", []) });
  assert.deepEqual(managed, [`RENAME:${projectA}:rename-alpha`, `DELETE:${projectA}:delete-alpha`]);
  assert.equal(w.net.calls.length, selections, "no project was opened or selected");
  assert.equal(findAll(d.render({ ...props, onManageProject: undefined }), (node: Node) => node.props?.className === "vault-card-tool").length, 0);
});

function deleteDialog(language: "es" | "en", w: World) {
  const dialog = w.services.projectManager.getSnapshot().dialog!;
  return html("projects/ProjectManageDialogs.tsx", "DeleteProjectDialog", language, { manager: w.services.projectManager, dialog });
}

test("delete dialog (ES/EN) names the project and its generations, is irreversible, and uses the error tone", async () => {
  const w = await workspace();
  w.services.projectManager.requestDelete(projectA, null);
  for (const [language, labels] of [["es", es], ["en", en]] as const) {
    const out = deleteDialog(language, w);
    assert.match(out, /role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description"/);
    assert.ok(out.includes(labels.deleteTitle.replace("{{name}}", "Alpha")), language);
    assert.ok(out.includes(labels.deleteGenerations_other.replace("{{count}}", "2")), language);
    assert.ok(out.includes(labels.deleteIrreversible));
    assert.match(out, /class="action-button danger-action"[^>]*>[^<]*<\/button>/);
    assert.ok(out.includes(`class="action-button danger-action">${labels.deleteConfirm}</button>`));
  }
  w.services.projectManager.cancel();
  w.services.projectManager.requestDelete(projectB, null);
  assert.ok(deleteDialog("en", w).includes(en.deleteGenerationsUnknown), "no count reported → generic wording");
});

test("delete dialog focuses Cancel, Esc cancels (not while pending), focus returns to the trigger or the Vault", async () => {
  const w = await workspace();
  const log: string[] = [];
  w.services.projectManager.requestDelete(projectA, fakeNode("trigger", log) as unknown as HTMLElement);
  const d = driver("projects/ProjectManageDialogs.tsx", "DeleteProjectDialog", "en");
  const render = () => d.render({ manager: w.services.projectManager, dialog: w.services.projectManager.getSnapshot().dialog });
  render();
  d.refs[1]!.current = fakeNode("cancel", log);
  d.flushEffects();
  assert.deepEqual(log, ["cancel"]);
  const dialog = findAll(render(), (node: Node) => node.props?.role === "dialog")[0];
  const pending = deferred<Response>();
  w.net.routes.remove = () => pending.promise;
  const running = w.services.projectManager.confirmDelete();
  let prevented = 0;
  findAll(render(), (node: Node) => node.props?.role === "dialog")[0].props.onKeyDown({ key: "Escape", preventDefault: () => { prevented++; } });
  assert.ok(w.services.projectManager.getSnapshot().dialog, "Esc is ignored while the request runs");
  const pendingTree = render();
  assert.ok(text(pendingTree).includes(en.deletePending));
  assert.ok(findAll(pendingTree, (node: Node) => node.type === "button").every((node: Node) => node.props.disabled === true));
  pending.resolve(new Response(null, { status: 503 }));
  await running;
  assert.ok(text(render()).includes(en.deleteFailed) && text(render()).includes(en.historyRetry));
  dialog.props.onKeyDown({ key: "Escape", preventDefault: () => { prevented++; } });
  assert.equal(w.services.projectManager.getSnapshot().dialog, null);
  assert.equal(prevented, 1);
  d.unmount();
  assert.deepEqual(log, ["cancel", "trigger"]);

  const gone = { ...fakeNode("removed", log), isConnected: false };
  w.services.projectManager.requestDelete(projectA, gone as unknown as HTMLElement);
  const vault = fakeNode("vault", log);
  (d.document as Record<string, unknown>).getElementById = (id: string) => id === "project-vault" ? vault : null;
  render();
  d.flushEffects();
  d.unmount();
  assert.equal(log.at(-1), "vault", "a removed trigger hands focus to the Vault region");
});

test("rename dialog (ES/EN) starts with the name, validates like creation, and keeps the text and error on failure", async () => {
  const w = await workspace();
  w.services.projectManager.requestRename(projectA, null);
  for (const [language, labels] of [["es", es], ["en", en]] as const) {
    const out = html("projects/ProjectManageDialogs.tsx", "RenameProjectDialog", language, { manager: w.services.projectManager, dialog: w.services.projectManager.getSnapshot().dialog });
    assert.match(out, /role="dialog" aria-modal="true" aria-labelledby="rename-dialog-title"/);
    assert.ok(out.includes('value="Alpha"') && out.includes(labels.renameTitle) && out.includes(labels.renameConfirm));
  }
  const d = driver("projects/ProjectManageDialogs.tsx", "RenameProjectDialog", "en");
  const render = () => d.render({ manager: w.services.projectManager, dialog: w.services.projectManager.getSnapshot().dialog });
  const input = () => findAll(render(), (node: Node) => node.type === "input")[0];
  const form = () => findAll(render(), (node: Node) => node.type === "form")[0];
  input().props.onChange({ currentTarget: { value: "   " } });
  form().props.onSubmit({ preventDefault() {} });
  assert.ok(text(render()).includes(en.projectNameRequired));
  assert.equal(count(w, `PATCH /projects/${projectA}`), 0, "invalid names never reach the server");
  w.net.routes.rename = () => new Response(null, { status: 503 });
  input().props.onChange({ currentTarget: { value: "Alpha renamed" } });
  form().props.onSubmit({ preventDefault() {} });
  await settle(); await settle();
  assert.equal(count(w, `PATCH /projects/${projectA}`), 1);
  assert.equal(input().props.value, "Alpha renamed", "the typed text survives the failure");
  assert.ok(text(render()).includes(en.renameFailed));
  assert.ok(text(render()).includes(en.historyRetry));
});

test("one app-level host renders the right dialog; the shell and Vault reach it only through props", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.equal((app.match(/<ProjectManageDialog /g) ?? []).length, 1);
  const shell = readFileSync(new URL("../src/features/workspace/ApplicationShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /onManageProject=\{\(kind, projectId, trigger\) => \{/);
  assert.doesNotMatch(shell, /import .*ProjectManage/, "shell keeps the shim-friendly imports");
  const vault = readFileSync(new URL("../src/features/projects/ProjectVault.tsx", import.meta.url), "utf8");
  assert.match(vault, /import type \{ ProjectManageKind \} from "\.\/projectManageActions";/);
  assert.doesNotMatch(vault, /ProjectManageDialog|renameProject|deleteProject/, "the Vault never mutates projects itself");
});

test("project management never imports AI, analysis, the generator, auth or a toast implementation", () => {
  for (const file of ["projects/projectManageActions.ts", "projects/ProjectManageDialogs.tsx"]) {
    const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import (type )?.* from "([^"]+)";$/gm)];
    for (const [, typeOnly, path] of imports) {
      assert.doesNotMatch(path!, /analysis|generation|generateReact|openai|\/auth|ai-provider/, `${file} → ${path}`);
      if (/feedback/.test(path!)) assert.equal(typeOnly, "type ", `${file} may only reference toast types`);
    }
  }
});

test("styles: card tools and the delete dialog use tokens only and respect reduced motion", () => {
  const css = readFileSync(new URL("../src/features/projects/vault.css", import.meta.url), "utf8");
  const lines = css.split("\n").filter((line) => /\.(vault-card-tool|delete-dialog)/.test(line));
  assert.ok(lines.length >= 10);
  for (const line of lines) assert.doesNotMatch(line, /#[0-9a-fA-F]{3,8}\b/, `hard-coded color: ${line}`);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.vault-card-tool \{ transition: none; \}/);
  assert.match(css, /\.danger-action \{[^}]*color: var\(--color-error\)/, "destructive confirm uses the error tone");
});
