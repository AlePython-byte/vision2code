import assert from "node:assert/strict";
import test from "node:test";
import type { UINode, UISchema } from "@vision2code/contracts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { generateReactProjectV2 } from "../src/features/generation/generateReactProjectV2.ts";
import { MAX_TRACKS, planLayout } from "../src/features/generation/layoutInference.ts";
import { isSingleLineText } from "../src/features/generation/textLayout.ts";

// ---- Builders ----------------------------------------------------------------------------------

interface NodeOptions {
  type?: UINode["type"];
  x?: number; y?: number; width?: number; height?: number;
  mode?: UINode["layout"]["mode"];
  direction?: UINode["layout"]["direction"];
  justify?: UINode["layout"]["justify"];
  align?: UINode["layout"]["align"];
  gap?: number | null;
  columns?: number | null;
  padding?: [number, number, number, number];
  children?: UINode[];
  text?: { content: string; fontSize?: number | null; lineHeight?: number | null } | null;
}

function node(id: string, options: NodeOptions = {}): UINode {
  const { type = "FRAME", x = 0, y = 0, width = 100, height = 40, mode = "NONE", direction = "NONE", justify = "START",
    align = "START", gap = null, columns = null, padding = [0, 0, 0, 0], children = [], text = null } = options;
  return {
    id, type, name: id,
    bounds: { x, y, width, height },
    layout: { mode, direction, justify, align, gap, columns,
      padding: { top: padding[0], right: padding[1], bottom: padding[2], left: padding[3] } },
    style: { background: null, color: null, border: null, radius: null, shadow: null, opacity: 1 },
    text: text === null ? null : { content: text.content, fontSize: text.fontSize === undefined ? 16 : text.fontSize,
      fontWeight: null, lineHeight: text.lineHeight ?? null, letterSpacing: null, fontFamily: null, textAlign: "START" },
    image: type === "IMAGE" || type === "ICON" ? { description: "placeholder", fit: "CONTAIN" } : null,
    children,
  };
}
const schema = (root: UINode): UISchema => ({
  schemaVersion: "1.0", source: { width: 1000, height: 800 }, confidence: 0.9,
  designTokens: { colors: [], typography: [], spacing: [], radii: [] }, root, warnings: [],
});
const boxes = (list: [number, number, number, number][]) => list.map(([x, y, width, height], index) => node(`c${index}`, { x, y, width, height }));
/** A container at (0,0) 1000x600 holding children laid out by `list` ([x, y, width, height]). */
const container = (list: [number, number, number, number][], options: NodeOptions = {}) =>
  node("box", { width: 1000, height: 600, ...options, children: boxes(list) });
const plan = (root: UINode) => planLayout(schema(root), "v3");
const classesOf = (root: UINode, id: string, generate = generateReactProject) => {
  const line = generate(schema(root)).files[1]!.content.split("\n").find((entry) => entry.includes(`data-node-id={"${id}"}`));
  assert.ok(line, id);
  return (JSON.parse(line.match(/className=\{("(?:[^"\\]|\\.)*")\}/)![1]!) as string).split(" ");
};

// ---- NONE: clean flows become flex ------------------------------------------------------------

test("NONE with a clean column or row is rendered as that flex flow", () => {
  const column = container([[0, 0, 1000, 100], [0, 120, 1000, 100], [0, 240, 1000, 100]]);
  const planned = plan(column);
  assert.equal(planned.container(column)?.inferredFlex, "COLUMN");
  assert.equal(planned.container(column)?.gap, 20);
  assert.equal(planned.free.flexInferred, 1);
  const classes = classesOf(column, "box");
  for (const token of ["flex", "flex-col", "justify-start", "items-start", "[gap:20px]"]) assert.ok(classes.includes(token), token);
  assert.ok(!classes.includes("grid"));

  const row = container([[0, 0, 200, 100], [220, 0, 200, 100], [440, 0, 200, 100]]);
  assert.equal(plan(row).container(row)?.inferredFlex, "ROW");
  const rowClasses = classesOf(row, "box");
  assert.ok(rowClasses.includes("flex-row") && rowClasses.includes("flex-nowrap"));
  assert.ok(classesOf(row, "c0").includes("[flex:0_1_200px]"), "row children keep their width");
  assert.ok(!classesOf(row, "c0").includes("w-full"));
});

test("v2 keeps NONE exactly as before; the v3 profile is the only one that infers it", () => {
  const column = container([[0, 0, 1000, 100], [0, 120, 1000, 100]]);
  assert.equal(planLayout(schema(column), "v2").container(column), null);
  assert.deepEqual(generateReactProjectV2(schema(column)).files[1]!.content.includes("flex-col"), false);
});

// ---- NONE: explicit tracks --------------------------------------------------------------------

/** The CodePen login shape: a heading, a row of three columns, and a prompt below. */
function bands() {
  return container([[100, 50, 300, 90], [100, 160, 390, 170], [530, 160, 50, 380], [620, 162, 370, 340], [350, 560, 250, 26]],
    { height: 700, padding: [0, 0, 0, 0] });
}

test("NONE whose children are not a flow gets explicit tracks and every child its cells", () => {
  const root = bands();
  const planned = plan(root);
  const own = planned.container(root);
  assert.ok(own?.tracks, "tracks inferred");
  assert.equal(own?.positioned, false);
  assert.equal(planned.free.trackGrids, 1);
  assert.equal(planned.free.positioned, 0);
  // Tracks add up to the content box.
  assert.equal(own!.tracks!.columns.reduce((sum, width) => sum + width, 0), 1000);
  const heading = planned.child(root.children[0]!)?.cell;
  const social = planned.child(root.children[1]!)?.cell;
  assert.ok(heading && social);
  assert.equal(heading!.columnStart, social!.columnStart, "same left edge, same first column");
  assert.ok(heading!.rowEnd <= social!.rowStart, "the heading sits above the row");
  const classes = classesOf(root, "box");
  assert.ok(classes.includes("grid"));
  assert.ok(classes.some((token) => token.startsWith("[grid-template-columns:minmax(0,")));
  assert.ok(classes.some((token) => token.startsWith("[grid-template-rows:minmax(")));
  assert.ok(!classes.some((token) => token.startsWith("[gap:")) && !classes.includes("flex"), "tracks replace the flow");
  const child = classesOf(root, "c1");
  assert.ok(child.some((token) => token.startsWith("[grid-column:")) && child.some((token) => token.startsWith("[grid-row:")));
});

test("track edges within 2 px merge; 3 px apart stay separate", () => {
  // A and B share a band, C sits below: not a flow, so tracks. C starts at x=2 (or 3) and ends with A.
  const shape = (cStart: number) => container([[0, 0, 200, 100], [300, 0, 200, 50], [cStart, 150, 500 - cStart, 50]], { width: 500, height: 300 });
  const columnsOf = (root: UINode) => plan(root).container(root)?.tracks?.columns;
  assert.deepEqual(columnsOf(shape(0)), [200, 100, 200]);
  assert.deepEqual(columnsOf(shape(2))?.length, 3, "starts 0 and 2 are one edge");
  assert.equal(columnsOf(shape(3))?.length, 4, "starts 0 and 3 are two edges");
});

// ---- NONE: last resort ------------------------------------------------------------------------

test("NONE with overlapping children falls back to positioning by bounds, and it is counted", () => {
  const root = container([[0, 0, 600, 300], [200, 100, 400, 300]]);
  const planned = plan(root);
  assert.equal(planned.container(root)?.positioned, true);
  assert.equal(planned.container(root)?.tracks, null);
  assert.equal(planned.free.positioned, 1);
  assert.equal(planned.free.trackGrids, 0);
  const child = classesOf(root, "c1");
  assert.ok(child.includes("absolute") && child.includes("[left:20%]") && child.includes("[top:16.6667%]") && child.includes("[width:40%]"), child.join(" "));
  const parent = classesOf(root, "box");
  assert.ok(parent.includes("relative") && parent.includes("[min-height:600px]"));
});

test("NONE with too many tracks does not become a grid", () => {
  const many = Array.from({ length: MAX_TRACKS + 2 }, (_, index): [number, number, number, number] => [index * 70, (index % 2) * 200, 60, 150]);
  const root = container(many, { width: 1000, height: 600 });
  root.bounds.width = 1000;
  const planned = plan(root);
  // A staggered strip of 14 columns is a row-ish layout by bounds or, failing that, positioned: never a 28-track grid.
  assert.equal(planned.container(root)?.tracks ?? null, null);
});

test("doubt: NONE with one child, with its own text, empty, or zero-sized is left as declared", () => {
  const single = node("box", { width: 300, height: 100, children: boxes([[10, 10, 100, 40]]) });
  const withText = container([[0, 0, 500, 100], [0, 120, 500, 100]]);
  withText.text = { content: "Title", fontSize: 16, fontWeight: null, lineHeight: null, letterSpacing: null, fontFamily: null, textAlign: "START" };
  const empty = node("box", { width: 300, height: 100 });
  const zero = container([[0, 0, 100, 40], [0, 50, 100, 40]], { width: 0 });
  for (const [name, root] of Object.entries({ single, withText, empty, zero })) {
    assert.equal(plan(root).container(root), null, name);
    assert.equal(plan(root).free.positioned, 0, name);
  }
});

// ---- GRID -------------------------------------------------------------------------------------

/** The Tremor dashboard shape: three columns, the last row spanning two of them, a tall left stack. */
function dashboard(options: NodeOptions = {}) {
  return node("grid", { mode: "GRID", width: 1000, height: 800, gap: 32, ...options, children: [
    node("left", { x: 0, y: 0, width: 300, height: 800 }),
    node("main", { x: 340, y: 0, width: 400, height: 500 }),
    node("side", { x: 780, y: 0, width: 220, height: 500 }),
    node("table", { x: 340, y: 540, width: 660, height: 260 }),
  ] });
}

test("GRID without columns gets tracks from the children's edges, with spans", () => {
  const root = dashboard({ columns: null });
  const planned = plan(root);
  assert.ok(planned.container(root)?.tracks);
  const cells = (index: number) => planned.child(root.children[index]!)?.cell;
  assert.deepEqual([cells(0)?.columnStart, cells(0)?.columnEnd], [1, 2]);
  assert.ok(cells(0)!.rowEnd - cells(0)!.rowStart >= cells(1)!.rowEnd - cells(1)!.rowStart, "the left stack spans the rows");
  assert.ok(cells(3)!.columnEnd - cells(3)!.columnStart > 1, "the table spans more than one column");
  assert.equal(planned.free.columnOverrides, 0);
  const classes = classesOf(root, "grid");
  assert.ok(classes.includes("grid") && !classes.some((token) => token.startsWith("[gap:")), "spacer tracks, no gap");
  assert.ok(!classes.includes("justify-start") && !classes.includes("items-start"));
});

test("GRID with a declared column count the bounds contradict is overridden; a consistent one is kept", () => {
  const contradicted = dashboard({ columns: 4 });
  assert.ok(plan(contradicted).container(contradicted)?.tracks);
  assert.equal(plan(contradicted).free.columnOverrides, 1);

  const three = node("grid", { mode: "GRID", columns: 3, width: 900, height: 200, gap: 10, children: boxes([[0, 0, 280, 90], [310, 0, 280, 90], [620, 0, 280, 90]]) });
  assert.equal(plan(three).container(three), null, "three starts, three declared columns: already right");
  assert.ok(classesOf(three, "grid").includes("[grid-template-columns:repeat(3,minmax(0,1fr))]"));
});

test("GRID: a single stacked column and overlapping children are left to the declared grid", () => {
  const stack = node("grid", { mode: "GRID", width: 400, height: 400, gap: 10, children: boxes([[0, 0, 400, 100], [0, 110, 400, 100]]) });
  assert.equal(plan(stack).container(stack), null);
  const overlap = node("grid", { mode: "GRID", width: 400, height: 400, columns: 3, children: boxes([[0, 0, 300, 200], [100, 100, 300, 200]]) });
  assert.equal(plan(overlap).container(overlap), null, "no cell assignment is unambiguous");
});

test("a GRID frame that only holds text is not a grid", () => {
  const trends = node("trends", { mode: "GRID", columns: 2, gap: 16, width: 360, height: 137, padding: [18, 56, 19, 56], justify: "CENTER", align: "CENTER",
    text: { content: "9.3% ↑     3.3% ↗\n1.9% ↘     0.5% ↗", fontSize: 18, lineHeight: 58 } });
  const root = node("root", { mode: "FLEX", direction: "COLUMN", width: 360, height: 400, children: [trends] });
  const v3 = classesOf(root, "trends");
  assert.ok(!v3.includes("grid") && !v3.some((token) => token.startsWith("[grid-template") || token.startsWith("[gap:")), v3.join(" "));
  assert.ok(classesOf(root, "trends", generateReactProjectV2).includes("grid"), "v2 keeps its behavior");
});

// ---- Declared FLEX that is not a flow ---------------------------------------------------------

test("a declared FLEX column whose last band is a row is rendered on tracks; overlap leaves it declared", () => {
  const twoBands = node("hero", { mode: "FLEX", direction: "COLUMN", width: 1000, height: 400, gap: 40, children: [
    node("headline", { x: 0, y: 0, width: 800, height: 160 }),
    node("lead", { x: 0, y: 200, width: 600, height: 28 }),
    node("action", { x: 850, y: 200, width: 150, height: 28 }),
  ] });
  const planned = plan(twoBands);
  assert.ok(planned.container(twoBands)?.tracks);
  assert.equal(planned.free.flexOverrides, 1);
  const classes = classesOf(twoBands, "hero");
  assert.ok(classes.includes("grid") && !classes.includes("flex") && !classes.includes("flex-col"), "no flex + grid mix");
  assert.ok(!classes.some((token) => token.startsWith("[gap:")), "the declared 40 px gap is not added on top of the tracks");

  const overlapping = node("hero", { mode: "FLEX", direction: "COLUMN", width: 1000, height: 400, children: [
    node("a", { x: 0, y: 0, width: 600, height: 300 }), node("b", { x: 100, y: 100, width: 600, height: 300 }),
  ] });
  assert.equal(plan(overlapping).container(overlapping), null);
  assert.equal(planLayout(schema(twoBands), "v2").container(twoBands), null, "v2 never does this");
});

// ---- Padding and text -------------------------------------------------------------------------

test("a declared padding the children sit outside of is replaced (v3 only)", () => {
  const root = node("page", { mode: "FLEX", direction: "COLUMN", align: "CENTER", width: 1000, height: 400, padding: [0, 125, 0, 125],
    children: boxes([[6, 0, 988, 80], [150, 100, 700, 80]]) });
  const v3 = plan(root).container(root);
  assert.deepEqual(v3?.padding, { top: 0, right: 6, bottom: 0, left: 6 });
  assert.equal(plan(root).free.paddingOverrides, 1);
  assert.equal(planLayout(schema(root), "v2").container(root)?.padding ?? null, null, "v2 keeps the declared padding");
  assert.equal(planLayout(schema(root), "v2").free.paddingOverrides, 0);
  const inside = node("page", { mode: "FLEX", direction: "COLUMN", width: 1000, height: 400, padding: [0, 20, 0, 20], children: boxes([[20, 0, 960, 80]]) });
  assert.equal(plan(inside).container(inside)?.padding ?? null, null);
  assert.equal(plan(inside).free.paddingOverrides, 0);
});

test("single-line text excludes the node's own vertical padding", () => {
  const button = node("signup", { type: "BUTTON", width: 91, height: 40, padding: [8, 16, 8, 16], text: { content: "Sign up", fontSize: 17, lineHeight: 24 } });
  assert.equal(isSingleLineText(button), false, "40 px > 1.5 x 24 px");
  assert.equal(isSingleLineText(button, { paddingAware: true }), true, "40 - 16 = 24 px: one line");
  const root = node("root", { mode: "FLEX", direction: "ROW", width: 400, height: 100, children: [button] });
  assert.ok(classesOf(root, "signup").includes("whitespace-pre"));
  assert.ok(classesOf(root, "signup", generateReactProjectV2).includes("whitespace-pre-wrap"));
  const tall = node("tall", { type: "TEXT", width: 91, height: 80, text: { content: "Sign up", fontSize: 17, lineHeight: 24 } });
  assert.equal(isSingleLineText(tall, { paddingAware: true }), false);
});

// ---- Determinism and safety -------------------------------------------------------------------

test("v3 is deterministic, never mutates the schema, and never mixes flex with grid", () => {
  const root = node("root", { mode: "FLEX", direction: "COLUMN", width: 1000, height: 1400, children: [
    bands(), dashboard({ columns: 4, y: 800 }), container([[0, 0, 600, 300], [200, 100, 400, 300]], { y: 100 }),
  ] });
  root.children[1]!.bounds.y = 750;
  const input = schema(root);
  const before = structuredClone(input);
  const first = JSON.stringify(generateReactProject(input));
  for (let run = 0; run < 4; run++) assert.equal(JSON.stringify(generateReactProject(input)), first);
  assert.equal(JSON.stringify(generateReactProject(structuredClone(input))), first);
  assert.deepEqual(input, before);
  assert.equal(generateReactProject(input).generatorVersion, "3");
  for (const match of generateReactProject(input).files[1]!.content.matchAll(/className=\{("(?:[^"\\]|\\.)*")\}/g)) {
    const tokens = (JSON.parse(match[1]!) as string).split(" ");
    assert.ok(!(tokens.includes("grid") && tokens.includes("flex")), "a node is flex or grid, never both");
    assert.ok(!(tokens.includes("grid") && tokens.some((token) => token.startsWith("[gap:")) && tokens.some((token) => token.startsWith("[grid-template-columns:minmax(0,") && token.includes("fr)"))),
      "track grids carry no gap");
  }
});

test("the plan reports what v3 did for tooling", () => {
  const root = node("root", { mode: "FLEX", direction: "COLUMN", width: 1000, height: 1700, children: [bands(), container([[0, 0, 600, 300], [200, 100, 400, 300]], { y: 800 })] });
  root.children[0]!.bounds.y = 0;
  const { free } = plan(root);
  assert.deepEqual(Object.keys(free).sort(), ["columnOverrides", "examined", "flexInferred", "flexOverrides", "paddingOverrides", "positioned", "trackGrids"]);
  assert.ok(free.examined >= 2 && free.trackGrids >= 1 && free.positioned >= 1);
});
