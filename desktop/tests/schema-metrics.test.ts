import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { UISchemaSchema } from "@vision2code/contracts";
import type { UINode, UISchema } from "@vision2code/contracts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import {
  ROW_HORIZONTAL_TOLERANCE_PX, childrenFormRow, computeSchemaMetrics, estimateTextWidth, isSingleLineText, metricRows,
} from "../src/features/fidelity/schemaMetrics.ts";

// ---- Synthetic schema builders ----------------------------------------------------------------

interface NodeOptions {
  type?: UINode["type"];
  x?: number; y?: number; width?: number; height?: number;
  mode?: UINode["layout"]["mode"];
  direction?: UINode["layout"]["direction"];
  children?: UINode[];
  text?: { content: string; fontSize?: number | null; lineHeight?: number | null } | null;
}

function node(id: string, options: NodeOptions = {}): UINode {
  const { type = "FRAME", x = 0, y = 0, width = 100, height = 40, mode = "NONE", direction = "NONE", children = [], text = null } = options;
  return {
    id, type, name: id,
    bounds: { x, y, width, height },
    layout: { mode, direction, justify: "START", align: "START", gap: null, columns: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    style: { background: null, color: null, border: null, radius: null, shadow: null, opacity: 1 },
    text: text === null ? null : { content: text.content, fontSize: text.fontSize === undefined ? 16 : text.fontSize,
      fontWeight: null, lineHeight: text.lineHeight ?? null, letterSpacing: null, fontFamily: null, textAlign: "START" },
    image: type === "IMAGE" || type === "ICON" ? { description: "placeholder", fit: "CONTAIN" } : null,
    children,
  };
}

function schema(root: UINode, extra: Partial<UISchema> = {}): UISchema {
  return {
    schemaVersion: "1.0", source: { width: 640, height: 480 }, confidence: 0.9,
    designTokens: { colors: [], typography: [], spacing: [], radii: [] }, root, warnings: [], ...extra,
  };
}

/** Four siblings laid out on one horizontal band. */
const fourInARow = (options: NodeOptions = {}) => node("nav", {
  width: 400, height: 40, ...options,
  children: [0, 1, 2, 3].map((index) => node(`item-${index}`, { x: index * 100, y: 0, width: 90, height: 40 })),
});

// ---- Counts -----------------------------------------------------------------------------------

test("nodeCount, maxDepth (root is depth 1) and counts by type", () => {
  assert.equal(computeSchemaMetrics(schema(node("root"))).maxDepth, 1);
  const tree = node("root", { children: [
    node("a", { type: "TEXT", children: [] }),
    node("b", { children: [node("c", { type: "BUTTON" }), node("d", { type: "INPUT" })] }),
    node("e", { type: "DIVIDER" }),
    node("f", { type: "IMAGE" }),
    node("g", { type: "ICON" }),
  ] });
  const metrics = computeSchemaMetrics(schema(tree));
  assert.equal(metrics.nodeCount, 8);
  assert.equal(metrics.maxDepth, 3);
  assert.deepEqual(metrics.nodesByType, { FRAME: 2, TEXT: 1, IMAGE: 1, ICON: 1, BUTTON: 1, INPUT: 1, DIVIDER: 1 });
});

test("containers are counted by layout mode and direction; leaves are not containers", () => {
  const tree = node("root", { mode: "FLEX", direction: "COLUMN", children: [
    node("row", { mode: "FLEX", direction: "ROW", children: [node("x"), node("y")] }),
    node("grid", { mode: "GRID", children: [node("z")] }),
    node("abs", { mode: "ABSOLUTE", children: [node("w")] }),
    node("plain", { children: [node("v")] }),
    node("leaf", { mode: "FLEX", direction: "ROW" }),
  ] });
  const metrics = computeSchemaMetrics(schema(tree));
  assert.equal(metrics.containerCount, 5);
  assert.deepEqual(metrics.containersByMode, { NONE: 1, FLEX: 2, GRID: 1, ABSOLUTE: 1 });
  assert.deepEqual(metrics.containersByDirection, { NONE: 3, ROW: 1, COLUMN: 1 });
});

test("containersWithoutLayout: only 2+ children with layout NONE", () => {
  const tree = node("root", { mode: "FLEX", direction: "COLUMN", children: [
    node("two-none", { children: [node("a"), node("b")] }),
    node("one-none", { children: [node("c")] }),
    node("two-flex", { mode: "FLEX", direction: "ROW", children: [node("d"), node("e")] }),
    node("two-grid", { mode: "GRID", children: [node("f"), node("g")] }),
    node("three-none", { children: [node("h"), node("i"), node("j")] }),
  ] });
  assert.equal(computeSchemaMetrics(schema(tree)).containersWithoutLayout, 2);
});

// ---- rowCandidates (criterion documented in schemaMetrics.ts) -----------------------------------

test("a row of 4 siblings with layout NONE is a row candidate and also lacks a layout", () => {
  const metrics = computeSchemaMetrics(schema(node("root", { width: 400, children: [fourInARow()] })));
  assert.equal(metrics.rowCandidates, 1);
  assert.equal(metrics.containersWithoutLayout, 1);
});

test("a container already declared FLEX/ROW is never a row candidate; FLEX/COLUMN or GRID with a row of children is", () => {
  const count = (options: NodeOptions) => computeSchemaMetrics(schema(fourInARow(options))).rowCandidates;
  assert.equal(count({ mode: "FLEX", direction: "ROW" }), 0);
  assert.equal(count({ mode: "FLEX", direction: "COLUMN" }), 1);
  assert.equal(count({ mode: "FLEX", direction: "NONE" }), 1);
  assert.equal(count({ mode: "GRID" }), 1);
  assert.equal(count({ mode: "ABSOLUTE" }), 1);
});

test("stacked, overlapping and single children are not rows", () => {
  const stacked = node("stack", { children: [0, 1, 2].map((index) => node(`s${index}`, { x: 0, y: index * 50, width: 100, height: 40 })) });
  const overlapping = node("overlap", { children: [node("a", { x: 0, width: 100 }), node("b", { x: 50, width: 100 })] });
  const single = node("single", { children: [node("only")] });
  for (const container of [stacked, overlapping, single]) {
    assert.equal(computeSchemaMetrics(schema(container)).rowCandidates, 0, container.id);
  }
});

test("row boundaries: 50% vertical overlap, 1 px horizontal tolerance, order independence, zero height", () => {
  const pair = (second: { x?: number; y?: number; height?: number }, first: { height?: number } = {}) => [
    node("a", { x: 0, y: 0, width: 100, height: first.height ?? 20 }),
    node("b", { x: 100, y: second.y ?? 0, width: 100, height: second.height ?? 20, ...(second.x === undefined ? {} : { x: second.x }) }),
  ];
  assert.equal(childrenFormRow(pair({ y: 10 })), true, "exactly 50% of the smaller height");
  assert.equal(childrenFormRow(pair({ y: 11 })), false, "just under 50%");
  assert.equal(childrenFormRow(pair({ y: 0, height: 100 })), true, "a short box inside a tall band overlaps 100% of the smaller one");
  assert.equal(childrenFormRow(pair({ x: 100 - ROW_HORIZONTAL_TOLERANCE_PX })), true, "1 px overlap is rounding");
  assert.equal(childrenFormRow(pair({ x: 100 - ROW_HORIZONTAL_TOLERANCE_PX - 1 })), false, "2 px overlap is not");
  assert.equal(childrenFormRow([...pair({})].reverse()), true, "document order does not matter, x order does");
  assert.equal(childrenFormRow(pair({ height: 0 })), false, "a zero-height box has no band");
  assert.equal(childrenFormRow([node("alone")]), false);
});

// ---- Text clamp risk ----------------------------------------------------------------------------

test("Dakingo case: 28 px text in a 97 px wide node is a clamp risk", () => {
  // "Dakingo" = 7 characters x 28 px x 0.55 = 107.8 px of text in a 97 px box.
  const title = node("title", { type: "TEXT", width: 97, height: 34, text: { content: "Dakingo", fontSize: 28, lineHeight: 34 } });
  assert.equal(estimateTextWidth(title), 107.8);
  assert.equal(isSingleLineText(title), true);
  const metrics = computeSchemaMetrics(schema(node("root", { children: [title] })));
  assert.equal(metrics.textNodes, 1);
  assert.equal(metrics.singleLineTextNodes, 1);
  assert.equal(metrics.textClampRisk, 1);
});

test("text clamp risk is strict, needs a single line, and counts characters (code points)", () => {
  const risk = (options: NodeOptions) => computeSchemaMetrics(schema(node("root", { children: [node("t", { type: "TEXT", ...options })] }))).textClampRisk;
  const text = (content: string, fontSize: number | null = 20, lineHeight: number | null = 24) => ({ content, fontSize, lineHeight });
  assert.equal(risk({ width: 110, height: 24, text: text("0123456789") }), 0, "estimated 110 in 110 fits (strictly greater is required)");
  assert.equal(risk({ width: 109, height: 24, text: text("0123456789") }), 1);
  assert.equal(risk({ width: 50, height: 120, text: text("0123456789") }), 0, "a tall box is multi-line, not a single-line clamp");
  assert.equal(risk({ width: 50, height: 24, text: text("line one\nline two") }), 0, "explicit line break");
  assert.equal(risk({ width: 50, height: 36, text: text("0123456789") }), 1, "up to 1.5 line heights is still one line");
  assert.equal(risk({ width: 50, height: 37, text: text("0123456789") }), 0);
  assert.equal(risk({ width: 50, height: 19, text: text("0123456789", null, null) }), 1, "defaults: 16 px font, 1.2 line height");
  assert.equal(risk({ width: 20, height: 24, text: text("🚀🚀🚀") }), 1, "3 emoji = 3 characters x 20 x 0.55 = 33 > 20");
  assert.equal(risk({ width: 40, height: 24, text: text("🚀🚀🚀") }), 0);
  assert.equal(risk({ width: 1, height: 24, text: text("") }), 0, "empty text never overflows");
});

test("buttons and inputs with text count as text nodes; nodes without text do not", () => {
  const tree = node("root", { children: [
    node("b", { type: "BUTTON", text: { content: "Ok" } }),
    node("i", { type: "INPUT", text: { content: "email" } }),
    node("f"),
    node("img", { type: "IMAGE" }),
  ] });
  assert.equal(computeSchemaMetrics(schema(tree)).textNodes, 2);
});

// ---- Placeholders, scalars, determinism --------------------------------------------------------

test("placeholders count IMAGE and ICON; confidence, warnings and JSON bytes are reported", () => {
  const tree = node("root", { children: [node("i", { type: "IMAGE" }), node("c", { type: "ICON" }), node("t", { type: "TEXT" }), node("ñ", { type: "TEXT" })] });
  const input = schema(tree, { confidence: 0.4, warnings: ["texto ilegible", "icono sin recurso"] });
  const metrics = computeSchemaMetrics(input);
  assert.equal(metrics.placeholderCount, 2);
  assert.equal(metrics.confidence, 0.4);
  assert.equal(metrics.warningCount, 2);
  assert.equal(metrics.jsonBytes, Buffer.byteLength(JSON.stringify(input), "utf8"), "UTF-8 bytes, not characters");
  assert.ok(metrics.jsonBytes > JSON.stringify(input).length, "multi-byte characters are present");
});

test("metrics are deterministic, do not mutate the schema, and survive deep trees", () => {
  const input = schema(node("root", { width: 400, children: [fourInARow(), node("t", { type: "TEXT", width: 20, height: 20, text: { content: "long text here" } })] }));
  const frozen = structuredClone(input);
  const deepFreeze = (value: unknown): void => { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(deepFreeze); } };
  deepFreeze(frozen);
  assert.deepEqual(computeSchemaMetrics(frozen), computeSchemaMetrics(input));
  assert.deepEqual(computeSchemaMetrics(input), computeSchemaMetrics(structuredClone(input)));
  assert.deepEqual(frozen, input, "the input was not changed");
  assert.ok(Object.isFrozen(computeSchemaMetrics(input)));

  let deep = node("leaf");
  for (let level = 0; level < 2_000; level++) deep = node(`n${level}`, { children: [deep] });
  const metrics = computeSchemaMetrics(schema(deep));
  assert.equal(metrics.nodeCount, 2_001);
  assert.equal(metrics.maxDepth, 2_001);
});

test("metricRows lists every measurement in a stable order", () => {
  const rows = metricRows(computeSchemaMetrics(schema(node("root", { width: 400, children: [fourInARow()] }))));
  assert.deepEqual(rows.map(([label]) => label).slice(0, 3), ["Nodes", "Max depth", "Nodes by type"]);
  assert.equal(rows.find(([label]) => label.startsWith("Row candidates"))?.[1], "1");
  assert.equal(rows.length, 15);
});

test("the shipped contract fixture measures consistently with the generator output", () => {
  const fixture = UISchemaSchema.parse(JSON.parse(readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8")));
  const metrics = computeSchemaMetrics(fixture);
  const interfaceFile = generateReactProject(fixture).files.find((file) => file.path.endsWith("GeneratedInterface.tsx"))!;
  assert.equal([...interfaceFile.content.matchAll(/data-node-id=/g)].length, metrics.nodeCount, "one rendered element per schema node");
  assert.ok(metrics.nodeCount > 1 && metrics.jsonBytes > 0);
});
