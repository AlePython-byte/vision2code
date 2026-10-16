import assert from "node:assert/strict";
import test from "node:test";
import type { UINode, UISchema } from "@vision2code/contracts";
// These tests pin the v2 profile of the inference, so they run through the frozen v2 generator.
import { generateReactProjectV2 as generateReactProject } from "../src/features/generation/generateReactProjectV2.ts";
import { INFERENCE_TOLERANCE_PX, planLayout } from "../src/features/generation/layoutInference.ts";

// ---- Synthetic schema builders ----------------------------------------------------------------

interface NodeOptions {
  type?: UINode["type"];
  x?: number; y?: number; width?: number; height?: number;
  mode?: UINode["layout"]["mode"];
  direction?: UINode["layout"]["direction"];
  justify?: UINode["layout"]["justify"];
  align?: UINode["layout"]["align"];
  gap?: number | null;
  padding?: [number, number, number, number];
  children?: UINode[];
  text?: { content: string; fontSize?: number | null; lineHeight?: number | null } | null;
}

function node(id: string, options: NodeOptions = {}): UINode {
  const { type = "FRAME", x = 0, y = 0, width = 100, height = 40, mode = "NONE", direction = "NONE", justify = "START",
    align = "START", gap = null, padding = [0, 0, 0, 0], children = [], text = null } = options;
  return {
    id, type, name: id,
    bounds: { x, y, width, height },
    layout: { mode, direction, justify, align, gap, columns: null,
      padding: { top: padding[0], right: padding[1], bottom: padding[2], left: padding[3] } },
    style: { background: null, color: null, border: null, radius: null, shadow: null, opacity: 1 },
    text: text === null ? null : { content: text.content, fontSize: text.fontSize === undefined ? 16 : text.fontSize,
      fontWeight: null, lineHeight: text.lineHeight ?? null, letterSpacing: null, fontFamily: null, textAlign: "START" },
    image: type === "IMAGE" || type === "ICON" ? { description: "placeholder", fit: "CONTAIN" } : null,
    children,
  };
}

function schema(root: UINode): UISchema {
  return {
    schemaVersion: "1.0", source: { width: 1000, height: 800 }, confidence: 0.9,
    designTokens: { colors: [], typography: [], spacing: [], radii: [] }, root, warnings: [],
  };
}

/** A FLEX column at (0,0) 400x600 whose children are laid out by `boxes` ([x, y, width, height]). */
function column(boxes: [number, number, number, number][], options: NodeOptions = {}): UINode {
  return node("col", { mode: "FLEX", direction: "COLUMN", width: 400, height: 600, ...options,
    children: boxes.map(([x, y, width, height], index) => node(`c${index}`, { x, y, width, height })) });
}
/** A FLEX row at (0,0) 800x100 whose children are laid out by `boxes`. */
function row(boxes: [number, number, number, number][], options: NodeOptions = {}): UINode {
  return node("row", { mode: "FLEX", direction: "ROW", width: 800, height: 100, ...options,
    children: boxes.map(([x, y, width, height], index) => node(`r${index}`, { x, y, width, height })) });
}

const plan = (root: UINode) => planLayout(schema(root));
const kid = (root: UINode, index: number) => plan(root).child(root.children[index]!);
const classesOf = (root: UINode, id: string) => {
  const source = generateReactProject(schema(root)).files[1]!.content;
  const line = source.split("\n").find((entry) => entry.includes(`data-node-id={"${id}"}`));
  assert.ok(line, id);
  return (JSON.parse(line.match(/className=\{("(?:[^"\\]|\\.)*")\}/)![1]!) as string).split(" ");
};

// ---- Gap -------------------------------------------------------------------------------------

test("gap: inferred from regular spacing only when the schema declares none", () => {
  const regular = column([[0, 0, 400, 50], [0, 70, 400, 50], [0, 140, 400, 50]]);
  assert.equal(plan(regular).container(regular)?.gap, 20);
  assert.ok(classesOf(regular, "col").includes("[gap:20px]"));
  // Within tolerance of each other (20 and 22): still one gap, the rounded mean.
  const near = column([[0, 0, 400, 50], [0, 70, 400, 50], [0, 142, 400, 50]]);
  assert.equal(plan(near).container(near)?.gap, 21);
  // Declared gap wins, even when the bounds disagree.
  const declared = column([[0, 0, 400, 50], [0, 70, 400, 50]], { gap: 8 });
  assert.equal(plan(declared).container(declared)?.gap, null);
  assert.ok(classesOf(declared, "col").includes("[gap:8px]"));
  assert.ok(!classesOf(declared, "col").includes("[gap:20px]"));
});

test("gap: irregular or negligible spacing is not turned into a gap (doubt)", () => {
  const irregular = column([[0, 0, 400, 50], [0, 70, 400, 50], [0, 180, 400, 50]]);
  assert.equal(plan(irregular).container(irregular)?.gap, null, "20 then 60");
  const tight = column([[0, 0, 400, 50], [0, 51, 400, 50]]);
  assert.equal(plan(tight).container(tight)?.gap, null, "1 px is rounding, not a gap");
  assert.ok(!classesOf(tight, "col").some((token) => token.startsWith("[gap:")));
});

test("residual spacing: a measured gap that differs from the base becomes a margin on that child", () => {
  const uneven = column([[0, 0, 400, 50], [0, 70, 400, 50], [0, 180, 400, 50]]);
  assert.equal(kid(uneven, 0)?.marginTop, 0);
  assert.equal(kid(uneven, 1)?.marginTop, 20, "no gap inferred, so the full 20 px is kept");
  assert.equal(kid(uneven, 2)?.marginTop, 60);
  assert.ok(classesOf(uneven, "c2").includes("[margin-top:60px]"));
  const declared = column([[0, 0, 400, 50], [0, 74, 400, 50], [0, 200, 400, 50]], { gap: 24 });
  assert.equal(kid(declared, 1)?.marginTop, 0, "24 px measured = declared gap: nothing extra");
  assert.equal(kid(declared, 2)?.marginTop, 76 - 24, "the surplus over the declared gap");
});

// ---- Padding ---------------------------------------------------------------------------------

test("padding: inferred from the offsets of the children when none is declared", () => {
  const padded = column([[16, 12, 368, 50], [16, 80, 368, 50]]);
  assert.deepEqual(plan(padded).container(padded)?.padding, { top: 12, right: 16, bottom: 0, left: 16 });
  const classes = classesOf(padded, "col");
  assert.ok(classes.includes("[padding:12px_16px_0px_16px]"));
  // The inferred padding makes both children fill the content box, so they stay `w-full`.
  assert.equal(kid(padded, 0)?.width, "FILL");
});

test("padding: offsets within tolerance are not padding; declared padding is never replaced", () => {
  const flush = column([[2, 1, 396, 50], [2, 60, 396, 50]]);
  assert.equal(plan(flush).container(flush)?.padding, null);
  const declared = column([[16, 12, 368, 50]], { padding: [4, 4, 4, 4] });
  assert.equal(plan(declared).container(declared)?.padding, null);
  assert.ok(classesOf(declared, "col").includes("[padding:4px_4px_4px_4px]"));
});

test("padding: the first-child offset is not padding when justify distributes space", () => {
  const centered = column([[0, 275, 400, 50]], { justify: "CENTER" });
  assert.equal(plan(centered).container(centered)?.padding, null, "top offset is justify's free space, not padding");
  assert.equal(plan(centered).container(centered)?.justify, null, "275 above and 275 below: CENTER is consistent");
  const betweenEdges = column([[0, 0, 400, 50], [0, 550, 400, 50]], { justify: "SPACE_BETWEEN" });
  assert.equal(plan(betweenEdges).container(betweenEdges)?.padding, null);
});

// ---- Alignment -------------------------------------------------------------------------------

test("alignment: a narrower child centered, end-aligned or offset in a column", () => {
  const container = column([[100, 0, 200, 50], [200, 70, 200, 50], [40, 140, 200, 50], [0, 210, 400, 50]], { align: "START" });
  assert.equal(kid(container, 0)?.alignSelf, "CENTER");
  assert.equal(kid(container, 0)?.width, "FIXED");
  assert.equal(kid(container, 1)?.alignSelf, "END");
  assert.equal(kid(container, 2)?.marginLeft, 40);
  assert.equal(kid(container, 2)?.alignSelf, null, "START container: the offset is a margin");
  assert.equal(kid(container, 3)?.width, "FILL");
  const c0 = classesOf(container, "c0");
  assert.ok(c0.includes("self-center") && c0.includes("[width:200px]") && c0.includes("[max-width:100%]") && !c0.includes("w-full"));
  assert.ok(classesOf(container, "c1").includes("self-end"));
  assert.ok(classesOf(container, "c2").includes("[margin-left:40px]"));
  assert.ok(classesOf(container, "c3").includes("w-full"));
});

test("alignment: ±2 px counts as equal; a declared center container needs no override for centered children", () => {
  // 101 px left and 99 px right differ by exactly the tolerance: symmetric, so it is centered. With a
  // single child the symmetric offsets become padding and the child simply fills the content box.
  const nearCenter = column([[101, 0, 200, 50]]);
  assert.deepEqual(plan(nearCenter).container(nearCenter)?.padding, { top: 0, right: 99, bottom: 0, left: 101 });
  assert.equal(kid(nearCenter, 0)?.width, "FILL");
  const mixed = column([[101, 0, 200, 50], [0, 70, 400, 50]]);
  assert.equal(kid(mixed, 0)?.alignSelf, "CENTER", "101 left vs 99 right is within tolerance");
  const declaredCenter = column([[100, 0, 200, 50], [0, 70, 400, 50]], { align: "CENTER" });
  assert.equal(kid(declaredCenter, 0)?.alignSelf, null);
  const startUnderCenter = column([[0, 0, 200, 50], [0, 70, 400, 50]], { align: "CENTER" });
  assert.equal(kid(startUnderCenter, 0)?.alignSelf, "START", "bounds say start while the container centers");
  const declaredEnd = column([[200, 0, 200, 50], [0, 70, 400, 50]], { align: "END" });
  assert.equal(kid(declaredEnd, 0)?.alignSelf, null);
});

test("alignment in a row: exact start/center/end are inferred; any other vertical offset is left alone", () => {
  const centered = row([[0, 0, 100, 100], [110, 30, 100, 40]], { align: "STRETCH" });
  assert.equal(kid(centered, 0)?.alignSelf, null, "fills the row height");
  assert.equal(kid(centered, 1)?.alignSelf, "CENTER");
  const end = row([[0, 0, 100, 100], [110, 60, 100, 40]], { align: "STRETCH" });
  assert.equal(kid(end, 1)?.alignSelf, "END");
  const start = row([[0, 0, 100, 100], [110, 0, 100, 40]], { align: "STRETCH" });
  assert.equal(kid(start, 1)?.alignSelf, "START", "a stretching row would otherwise grow the child");
  const ambiguous = row([[0, 0, 100, 100], [110, 10, 100, 30]], { align: "STRETCH" });
  assert.equal(kid(ambiguous, 1)?.alignSelf, null, "10 px from the top, 60 from the bottom: ambiguous, no margin");
  assert.equal(kid(ambiguous, 1)?.marginTop, 0);
  const declaredCenter = row([[0, 0, 100, 100], [110, 30, 100, 40]], { align: "CENTER" });
  assert.equal(kid(declaredCenter, 1)?.alignSelf, null, "already what the container declares");
});

// ---- Rows ------------------------------------------------------------------------------------

test("rows: children keep their own width and a row that fits one line does not wrap", () => {
  const container = row([[0, 0, 200, 100], [210, 0, 300, 100]]);
  assert.equal(plan(container).container(container)?.singleLine, true);
  const rowClasses = classesOf(container, "row");
  assert.ok(rowClasses.includes("flex-nowrap") && !rowClasses.includes("flex-wrap"));
  const child = classesOf(container, "r0");
  assert.ok(child.includes("[flex:0_1_200px]") && !child.includes("w-full"));
  assert.equal(kid(container, 1)?.marginLeft, 0, "10 px = inferred gap");
  assert.equal(plan(container).container(container)?.gap, 10);
});

test("rows: every FLEX row child keeps its own width, planned or not; unplanned rows keep wrapping", () => {
  const overlapping = row([[0, 0, 300, 100], [200, 0, 300, 100]]);
  assert.equal(plan(overlapping).container(overlapping), null);
  assert.ok(classesOf(overlapping, "r0").includes("[flex:0_1_300px]"));
  assert.ok(classesOf(overlapping, "row").includes("flex-wrap"));
  const lone = row([[0, 0, 300, 100]]);
  assert.ok(classesOf(lone, "row").includes("flex-wrap"), "a single child is not a row to infer");
});

test("justify: kept when the bounds agree, replaced by START plus margins when they contradict it", () => {
  const spread = row([[0, 0, 100, 100], [350, 0, 100, 100], [700, 0, 100, 100]], { justify: "SPACE_BETWEEN" });
  assert.equal(plan(spread).container(spread)?.justify, null, "equal gaps from edge to edge");
  assert.ok(classesOf(spread, "row").includes("justify-between"));
  assert.equal(plan(spread).container(spread)?.gap, null, "justify distributes the space: no rigid gap");
  assert.ok(!classesOf(spread, "row").some((token) => token.startsWith("[gap:")));
  const pair = row([[0, 0, 100, 100], [700, 0, 100, 100]], { justify: "SPACE_BETWEEN" });
  assert.equal(plan(pair).container(pair)?.gap, null, "a pair spread to both edges is not a 600 px gap");

  const groups = row([[0, 0, 100, 100], [120, 0, 100, 100], [700, 0, 100, 100]], { justify: "SPACE_BETWEEN" });
  assert.equal(plan(groups).container(groups)?.justify, "START");
  const classes = classesOf(groups, "row");
  assert.ok(classes.includes("justify-start") && !classes.includes("justify-between"));
});

test("justify: contradicted SPACE_BETWEEN reproduces the measured gaps through margins", () => {
  const groups = row([[0, 0, 100, 100], [120, 0, 100, 100], [700, 0, 100, 100]], { justify: "SPACE_BETWEEN" });
  const margins = [0, 1, 2].map((index) => kid(groups, index)?.marginLeft);
  assert.deepEqual(margins, [0, 20, 480]);
  const centered = row([[300, 0, 100, 100], [410, 0, 90, 100]], { justify: "CENTER" });
  assert.equal(plan(centered).container(centered)?.justify, null, "free space 300 left, 300 right");
  const notCentered = row([[0, 0, 100, 100], [110, 0, 90, 100]], { justify: "CENTER" });
  assert.equal(plan(notCentered).container(notCentered)?.justify, "START");
  const notEnd = row([[0, 0, 100, 100]], { justify: "END" });
  assert.equal(plan(notEnd).container(notEnd)?.justify, "START");
});

// ---- Doubt: nothing inferred -----------------------------------------------------------------

test("doubt: overlapping, out-of-order, escaping or text-carrying containers are left as declared", () => {
  const overlapping = column([[0, 0, 400, 100], [0, 50, 400, 100]]);
  const outOfOrder = column([[0, 200, 400, 50], [0, 0, 400, 50]]);
  const escaping = column([[0, 0, 400, 50], [0, 100, 500, 50]]);
  const withText = column([[16, 112, 368, 50]]);
  withText.text = { content: "Title\nSubtitle", fontSize: 16, fontWeight: null, lineHeight: null, letterSpacing: null, fontFamily: null, textAlign: "START" };
  const empty = column([[16, 12, 368, 50]], { width: 0 });
  for (const [name, container] of Object.entries({ overlapping, outOfOrder, escaping, withText, empty })) {
    const result = plan(container);
    assert.equal(result.container(container), null, name);
    assert.equal(result.child(container.children[0]!), null, name);
    // Declared layout, `w-full` children and no invented spacing.
    const classes = classesOf(container, "c0");
    assert.ok(!classes.some((token) => token.startsWith("[margin-") || token.startsWith("self-")), name);
  }
  assert.ok(classesOf(withText, "c0").includes("w-full"));
});

test("doubt: NONE, GRID and ABSOLUTE containers are never planned", () => {
  for (const mode of ["NONE", "GRID", "ABSOLUTE"] as const) {
    const container = column([[16, 12, 100, 50], [16, 80, 100, 50]], { mode });
    assert.equal(plan(container).container(container), null, mode);
    assert.equal(plan(container).stats.plannedContainers, 0, mode);
  }
  const absolute = column([[10, 20, 100, 50]], { mode: "ABSOLUTE" });
  assert.ok(classesOf(absolute, "c0").includes("absolute"), "absolute children keep their percentages");
});

test("tolerance constant is the documented 2 px and decides the boundaries", () => {
  assert.equal(INFERENCE_TOLERANCE_PX, 2);
  const atLimit = column([[2, 0, 396, 50]]);
  assert.equal(plan(atLimit).container(atLimit)?.padding, null);
  const overLimit = column([[3, 0, 395, 50]]);
  assert.deepEqual(plan(overLimit).container(overLimit)?.padding, { top: 0, right: 0, bottom: 0, left: 3 });
});

// ---- Text and placeholders -------------------------------------------------------------------

test("text: a single line never wraps and keeps its spaces; multi-line text keeps wrapping", () => {
  const single = node("single", { type: "TEXT", width: 80, height: 20, text: { content: "Blocks     Templates", fontSize: 16, lineHeight: 20 } });
  const tall = node("tall", { type: "TEXT", width: 80, height: 80, text: { content: "A long paragraph", fontSize: 16, lineHeight: 20 } });
  const broken = node("broken", { type: "TEXT", width: 80, height: 20, text: { content: "one\ntwo", fontSize: 16, lineHeight: 20 } });
  const root = node("root", { mode: "FLEX", direction: "COLUMN", width: 400, height: 400, children: [single, tall, broken] });
  const singleClasses = classesOf(root, "single");
  assert.ok(singleClasses.includes("whitespace-pre") && !singleClasses.includes("whitespace-pre-wrap") && !singleClasses.includes("break-words"));
  assert.ok(!singleClasses.includes("overflow-hidden"), "overflowing text is visible, never clipped");
  for (const id of ["tall", "broken"]) {
    const classes = classesOf(root, id);
    assert.ok(classes.includes("whitespace-pre-wrap") && classes.includes("break-words"), id);
  }
  assert.ok(generateReactProject(schema(root)).files[1]!.content.includes('"Blocks     Templates"'), "spaces are data, untouched");
});

test("placeholders keep their label and cannot push the layout past their bounds", () => {
  const icon = node("icon", { type: "ICON", width: 25, height: 25 });
  const image = node("image", { type: "IMAGE", width: 300, height: 120 });
  const root = node("root", { mode: "FLEX", direction: "COLUMN", width: 400, height: 400, children: [icon, image] });
  const source = generateReactProject(schema(root)).files[1]!.content;
  for (const id of ["icon", "image"]) {
    const classes = classesOf(root, id);
    assert.ok(classes.includes("overflow-hidden") && classes.some((token) => token.startsWith("[max-height:")), id);
  }
  assert.ok(classesOf(root, "icon").includes("[max-height:25px]"));
  assert.match(source, /Icono sin recurso/);
  assert.match(source, /Imagen sin recurso/);
  assert.match(source, /role="img" aria-label=/);
  assert.doesNotMatch(source, /<img|https?:|src=/, "no invented assets");
});

// ---- Determinism -----------------------------------------------------------------------------

test("same input, same bytes; the schema is never mutated", () => {
  const root = node("root", { mode: "FLEX", direction: "COLUMN", width: 800, height: 600, children: [
    row([[0, 0, 100, 40], [120, 0, 100, 40], [700, 0, 100, 40]], { justify: "SPACE_BETWEEN" }),
    column([[40, 0, 200, 50], [100, 70, 200, 50]], { y: 80 }),
    node("t", { type: "TEXT", y: 500, width: 90, height: 24, text: { content: "Dakingo", fontSize: 28, lineHeight: 34 } }),
  ] });
  const input = schema(root);
  const before = structuredClone(input);
  const first = generateReactProject(input);
  for (let run = 0; run < 5; run++) assert.equal(JSON.stringify(generateReactProject(input)), JSON.stringify(first));
  assert.equal(JSON.stringify(generateReactProject(structuredClone(input))), JSON.stringify(first));
  assert.deepEqual(input, before);
  assert.equal(first.generatorVersion, "2");
});

test("the plan can be inspected without generating and reports what it inferred", () => {
  const container = row([[0, 0, 100, 100], [120, 0, 100, 100], [700, 0, 100, 100]], { justify: "SPACE_BETWEEN" });
  const { stats } = plan(container);
  assert.deepEqual(stats, { flexContainers: 1, plannedContainers: 1, gaps: 0, paddings: 0, margins: 2, alignments: 0, justifyOverrides: 1, fixedWidths: 0 });
});
