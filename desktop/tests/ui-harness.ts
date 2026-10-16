import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import { toSourceImageName } from "../src/features/generation/generationArtifact.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import * as discardGuardModule from "../src/features/projects/discardGuard.ts";
import * as historyActions from "../src/features/projects/historyActions.ts";
import * as historySelectors from "../src/features/projects/historySelectors.ts";
import * as libraryActions from "../src/features/projects/libraryActions.ts";
import * as actions from "../src/features/projects/projectTargetActions.ts";
import * as vaultKeyboard from "../src/features/projects/vaultKeyboard.ts";

export type Lang = "es" | "en";
export type Node = any;

/** Loads one .tsx feature file through the same CommonJS shim pattern the existing UI tests use. */
export function loadModule(file: string, language: Lang, react: unknown, globals: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  const table: Record<string, unknown> = {
    "/historySelectors": historySelectors, "/historyActions": historyActions, "/discardGuard": discardGuardModule,
    "/libraryActions": libraryActions, "/projectTargetActions": actions, "/vaultKeyboard": vaultKeyboard,
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

export function html(file: string, component: string, language: Lang, props: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const exports = loadModule(file, language, React, {}, extra);
  return renderToStaticMarkup(React.createElement(exports[component], props));
}

/** Renders a component as a plain function with stateful fake hooks so handlers can be driven without a DOM. */
export function driver(file: string, component: string, language: Lang, extra: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let pending: Array<() => void | (() => void)> = [];
  let cleanups: Array<() => void> = [];
  let stateIndex = 0;
  let refIndex = 0;
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
  const document = { activeElement: null as unknown, addEventListener() {}, removeEventListener() {} };
  const exports = loadModule(file, language, react, { document, ...globals }, extra);
  return {
    refs, document,
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

export function walk(node: Node, visit: (item: Node) => void) {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const child of React.Children.toArray(node.props?.children)) walk(child as Node, visit);
}
export function findAll(node: Node, predicate: (item: Node) => boolean): Node[] {
  const result: Node[] = [];
  walk(node, (item) => { if (predicate(item)) result.push(item); });
  return result;
}
export function text(node: Node): string {
  let value = "";
  walk(node, (item) => { for (const child of [item.props?.children].flat()) if (typeof child === "string" || typeof child === "number") value += String(child); });
  return value;
}
export const fakeNode = (label: string, log: string[]) => ({
  label, isConnected: true, focus() { log.push(label); }, contains: () => false, querySelectorAll: () => [] as unknown[],
});
export const settle = () => new Promise((resolve) => setImmediate(resolve));
