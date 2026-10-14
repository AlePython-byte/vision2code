import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import ts from "typescript";
import type { ProjectSummary } from "@vision2code/contracts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { createProjectsModel } from "../src/features/projects/projectsModel.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import * as actions from "../src/features/projects/projectTargetActions.ts";
import * as keyboard from "../src/features/projects/vaultKeyboard.ts";
import { deferred, fakeClient, projectA, summaryA } from "./generation-fixtures.ts";

function harness(projects: ReturnType<typeof createProjectsModel>) {
  const source = readFileSync(new URL("../src/features/projects/NewProjectDialog.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  const state: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let closed = 0;
  let navigated = 0;
  const react = {
    ...React,
    useState(initial: unknown) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(state[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    },
    useEffect() {},
  };
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return react;
    if (name.endsWith("/useLabels")) return { useLabels: () => ({ t: i18n.getFixedT("en") }) };
    if (name.endsWith("/projectTargetActions")) return actions;
    if (name.endsWith("/vaultKeyboard")) return keyboard;
    return require(name);
  } });
  function render() {
    stateIndex = 0;
    refIndex = 0;
    return exports.NewProjectDialog({ projects, trigger: { current: null }, onClose: () => { closed++; }, onCreated: () => { navigated++; } });
  }
  function find(node: any, type: string, buttonType?: string): any {
    if (node?.type === type && (!buttonType || node.props?.type === buttonType)) return node;
    for (const child of React.Children.toArray(node?.props?.children)) {
      const match = find(child, type, buttonType);
      if (match) return match;
    }
    return null;
  }
  return { render, find, get closed() { return closed; }, get navigated() { return navigated; } };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("dialog validates blank and overlong names inline without calling the API", async () => {
  let calls = 0;
  const { client } = fakeClient({ createProject: async () => { calls++; return summaryA; } });
  const projects = createProjectsModel(client);
  const view = harness(projects);
  let tree = view.render();
  view.find(tree, "form").props.onSubmit({ preventDefault() {} });
  tree = view.render();
  assert.equal(view.find(tree, "input").props["aria-invalid"], true);
  assert.equal(calls, 0);
  view.find(tree, "input").props.onChange({ currentTarget: { value: "x".repeat(101) } });
  tree = view.render();
  view.find(tree, "form").props.onSubmit({ preventDefault() {} });
  tree = view.render();
  assert.equal(view.find(tree, "input").props.value, "x".repeat(101));
  assert.equal(view.find(tree, "input").props["aria-invalid"], true);
  assert.equal(calls, 0);
});

test("dialog keeps input, selection, and list after create failure", async () => {
  const { client } = fakeClient({ createProject: async () => { throw new ProjectsClientError("SERVER_ERROR"); } });
  const projects = createProjectsModel(client);
  await projects.loadProjects();
  await projects.selectProject(projectA);
  const before = projects.getSnapshot().projects;
  const view = harness(projects);
  let tree = view.render();
  view.find(tree, "input").props.onChange({ currentTarget: { value: "  New work  " } });
  tree = view.render();
  view.find(tree, "form").props.onSubmit({ preventDefault() {} });
  await flush();
  tree = view.render();
  assert.equal(view.find(tree, "input").props.value, "  New work  ");
  assert.equal(view.find(tree, "input").props["aria-invalid"], true);
  assert.equal(projects.getSnapshot().selectedProjectId, projectA);
  assert.deepEqual(projects.getSnapshot().projects, before);
  assert.equal(view.closed, 0);
  assert.equal(view.navigated, 0);
});

test("dialog submits once, then selects explicitly before closing and navigating", async () => {
  const created: ProjectSummary = { ...summaryA, id: "423e4567-e89b-42d3-a456-426614174000", name: "New work" };
  const pending = deferred<ProjectSummary>();
  let creates = 0;
  let selected = 0;
  const { client } = fakeClient({
    createProject: () => { creates++; return pending.promise; },
    getProject: async (id) => { selected++; return { ...created, id, generations: [] }; },
  });
  const projects = createProjectsModel(client);
  await projects.loadProjects();
  const view = harness(projects);
  let tree = view.render();
  view.find(tree, "input").props.onChange({ currentTarget: { value: " New work " } });
  tree = view.render();
  view.find(tree, "form").props.onSubmit({ preventDefault() {} });
  view.find(tree, "form").props.onSubmit({ preventDefault() {} });
  assert.equal(creates, 1);
  tree = view.render();
  const submit = view.find(tree, "button", "submit");
  assert.equal(submit.props.disabled, true);
  pending.resolve(created);
  await flush();
  assert.equal(selected, 1);
  assert.equal(projects.getSnapshot().selectedProjectId, created.id);
  assert.equal(view.closed, 1);
  assert.equal(view.navigated, 1);
});
