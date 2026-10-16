import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { compile } from "tailwindcss";
import { GeneratedProjectSchema, GenerationDetailSchema, UISchemaSchema } from "@vision2code/contracts";
import type { GeneratedProject, UINode, UISchema } from "@vision2code/contracts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { buildRunnableExportPlan } from "../src/features/export/exportScaffold.ts";
import { computeOutputMetrics } from "../src/features/fidelity/outputMetrics.ts";
import { computeSchemaMetrics } from "../src/features/fidelity/schemaMetrics.ts";
import { MAX_FAMILIES, fontFamilyList, fontFamilyValue } from "../src/features/generation/fontFamily.ts";
import {
  PLACEHOLDER_LABEL_MIN_HEIGHT, PLACEHOLDER_LABEL_MIN_WIDTH, generateReactProject,
} from "../src/features/generation/generateReactProject.ts";
import { generateReactProjectV3 } from "../src/features/generation/generateReactProjectV3.ts";
import { GENERATOR_VERSIONS } from "../src/features/generation/generatorVersions.ts";
import { createGenerationSessionModel } from "../src/features/generation/generationSessionModel.ts";
import { planLayout } from "../src/features/generation/layoutInference.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import { STANDARD_UTILITIES, generatePreviewCss, parseArbitraryProperty } from "../src/features/preview/previewStyles.ts";
import type { PreviewEngine } from "../src/features/preview/previewTypes.ts";
import { fakeClient, generationOne, generationTwo, projectA, storedGeneration } from "./generation-fixtures.ts";

const fixturesUrl = new URL("./fixtures/ui-schemas/", import.meta.url);
const goldenUrl = new URL("./golden/", import.meta.url);
const load = (url: URL): UISchema => UISchemaSchema.parse(JSON.parse(readFileSync(url, "utf8")));
const names = readdirSync(fixturesUrl).filter((name) => name.endsWith(".json")).sort();
const short = (name: string) => name.replace(".v1.json", "");
const fixture = (name: string) => load(new URL(name + ".v1.json", fixturesUrl));
const interfaceOf = (project: GeneratedProject) => project.files.find((file) => file.path.endsWith("GeneratedInterface.tsx"))!.content;
const classLists = (source: string) =>
  [...source.matchAll(/className=\{?("(?:[^"\\]|\\.)*")\}?/g)].map((match) => (JSON.parse(match[1]!) as string).split(" "));
const classesOf = (source: string, id: string) => {
  const line = source.split("\n").find((entry) => entry.includes(`data-node-id={"${id}"}`));
  assert.ok(line, id);
  return (JSON.parse(line.match(/className=\{("(?:[^"\\]|\\.)*")\}/)![1]!) as string).split(" ");
};

// ---- Golden output (update deliberately with UPDATE_GOLDEN=1) ---------------------------------

test("golden: generator v4 output is byte-for-byte what was reviewed, for every fixture", () => {
  assert.ok(names.length >= 12, "the baseline and per-mode fixtures are present");
  mkdirSync(goldenUrl, { recursive: true });
  for (const name of names) {
    const actual = interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))));
    const golden = new URL(`${short(name)}.v4.GeneratedInterface.tsx.txt`, goldenUrl);
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, actual);
    assert.ok(existsSync(golden), `${name}: missing golden file; review the output, then create it with UPDATE_GOLDEN=1`);
    assert.equal(actual, readFileSync(golden, "utf8"), `${name} changed: review the diff, then run with UPDATE_GOLDEN=1`);
  }
});

test("every golden file belongs to a fixture and to v3 (frozen) or v4 (current)", () => {
  const expected = names.flatMap((name) => ["v3", "v4"].map((version) => `${short(name)}.${version}.GeneratedInterface.tsx.txt`)).sort();
  assert.deepEqual(readdirSync(goldenUrl).filter((name) => name.endsWith(".txt")).sort(), expected);
});

test("determinism: the same schema gives the same bytes on every run and for a deep copy", () => {
  for (const name of names) {
    const schema = load(new URL(name, fixturesUrl));
    const before = structuredClone(schema);
    const first = JSON.stringify(generateReactProject(schema));
    for (let run = 0; run < 3; run++) assert.equal(JSON.stringify(generateReactProject(schema)), first);
    assert.equal(JSON.stringify(generateReactProject(structuredClone(schema))), first);
    assert.deepEqual(schema, before, "the schema is never mutated");
    assert.equal(generateReactProject(schema).generatorVersion, "4");
    assert.doesNotMatch(first, /NaN|Infinity|undefined/);
  }
});

// ---- font-family ------------------------------------------------------------------------------

test("font-family keeps the declared families and always ends in a generic one", () => {
  const cases: [string | null, string[] | null][] = [
    ["Lato, sans-serif", ["Lato", "sans-serif"]],
    ["Inter", ["Inter", "sans-serif"]],
    ["Arial", ["Arial", "sans-serif"]],
    ["sans-serif", ["sans-serif"]],
    ["monospace", ["monospace"]],
    ["'Open Sans', Arial", ["Open Sans", "Arial", "sans-serif"]],
    ['"Helvetica Neue",  Helvetica', ["Helvetica Neue", "Helvetica", "sans-serif"]],
    ["Georgia", ["Georgia", "serif"]],
    ["Times New Roman", ["Times New Roman", "serif"]],
    ["Fira Code, Menlo", ["Fira Code", "Menlo", "monospace"]],
    ["SANS-SERIF, Lato", ["sans-serif", "Lato"]], // a generic the schema placed is respected where it is
    ["Lato, lato, LATO", ["Lato", "sans-serif"]],
    ["A, B, C, D, E, F", ["A", "B", "C", "D", "sans-serif"]],
    [null, null],
    ["", null],
  ];
  for (const [declared, expected] of cases) assert.deepEqual(fontFamilyList(declared), expected, String(declared));
  assert.equal(MAX_FAMILIES, 4);
  assert.equal(fontFamilyValue(["Open Sans", "Arial", "sans-serif"]), "'Open_Sans','Arial',sans-serif");
});

test("hostile font-family values can never inject CSS, URLs or quotes", () => {
  const hostile = [
    "Lato; color: red", "Lato}body{display:none", "url(https://evil.test/x.woff)", "Lato'; background:url(x)",
    "\"Lato\" !important", "<script>alert(1)</script>", "Lato\\, sans-serif", "expression(alert(1))", "Lato\nsans-serif",
    "'Lato", "Lato_Bold", "[Lato]", "Lato/*x*/", "a".repeat(65), "@import x", "Ｌａｔｏ",
  ];
  for (const value of hostile) {
    const families = fontFamilyList(value);
    if (families === null) continue;
    for (const family of families) assert.match(family, /^[A-Za-z][A-Za-z0-9 -]{0,63}$/, value);
    const css = fontFamilyValue(families);
    assert.doesNotMatch(css, /[;{}()<>"\\\n@/[\]]|url|import/i, value);
  }
  assert.deepEqual(fontFamilyList("Lato; color: red, serif"), ["serif"], "only the valid entries survive");
  assert.deepEqual(fontFamilyList("url(x), Inter"), ["Inter", "sans-serif"]);
  assert.equal(fontFamilyList("};body{"), null, "nothing usable: the element inherits its font");
});

test("v4 emits a generic fallback for every text node; v3 did not", () => {
  for (const name of names) {
    const schema = load(new URL(name, fixturesUrl));
    assert.equal(computeOutputMetrics(generateReactProject(schema)).fontsWithoutGeneric, 0, name);
  }
  const lato = interfaceOf(generateReactProject(fixture("codepen-login.balanced.p11")));
  assert.ok(classesOf(lato, "heading").includes("[font-family:'Lato',sans-serif]"), "\"Lato, sans-serif\" is kept, not dropped");
  assert.ok(!interfaceOf(generateReactProjectV3(fixture("codepen-login.balanced.p11"))).includes("[font-family:'Lato'"), "v3 dropped it");
  assert.ok(classesOf(interfaceOf(generateReactProject(fixture("linear-landing.precise.p11"))), "product").includes("[font-family:'Inter',sans-serif]"),
    "a lone family gets the fallback v3 lacked");
});

// ---- Placeholders -----------------------------------------------------------------------------

const placeholder = (type: "IMAGE" | "ICON", width: number, height: number): UISchema => ({
  schemaVersion: "1.0", source: { width: 1000, height: 800 }, confidence: 0.9,
  designTokens: { colors: [], typography: [], spacing: [], radii: [] }, warnings: [],
  root: {
    id: "root", type: "FRAME", name: "root", bounds: { x: 0, y: 0, width: 1000, height: 800 },
    layout: { mode: "FLEX", direction: "COLUMN", justify: "START", align: "START", gap: null, columns: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    style: { background: null, color: null, border: null, radius: null, shadow: null, opacity: 1 }, text: null, image: null,
    children: [{
      id: "asset", type, name: "asset", bounds: { x: 0, y: 0, width, height },
      layout: { mode: "NONE", direction: "NONE", justify: "START", align: "START", gap: null, columns: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      style: { background: null, color: null, border: null, radius: null, shadow: null, opacity: 1 }, text: null,
      image: { description: "Company logo", fit: "CONTAIN" }, children: [],
    } satisfies UINode],
  },
});

test("a placeholder shows its label only when the box can hold it; the description stays accessible", () => {
  assert.deepEqual([PLACEHOLDER_LABEL_MIN_WIDTH, PLACEHOLDER_LABEL_MIN_HEIGHT], [140, 40]);
  for (const [type, width, height, label] of [
    ["IMAGE", 400, 300, true], ["IMAGE", 140, 40, true], ["IMAGE", 139, 300, false], ["IMAGE", 400, 39, false],
    ["IMAGE", 180, 33, false], ["ICON", 24, 24, false], ["ICON", 200, 200, true],
  ] as const) {
    const source = interfaceOf(generateReactProject(placeholder(type, width, height)));
    const text = type === "IMAGE" ? "Imagen sin recurso" : "Icono sin recurso";
    assert.equal(source.includes(`{"${text}"}`), label, `${type} ${width}x${height}`);
    assert.match(source, /role="img" aria-label=\{"Company logo"\}/, "the description is always the accessible name");
    assert.match(source, /border-dashed/, "the dashed box is always there");
    if (!label) assert.match(source, /<span aria-hidden="true" className="pointer-events-none absolute \[inset:0\] border border-dashed border-current" \/>/);
    assert.ok(classesOf(source, "asset").some((token) => token === "relative" || token === "absolute"), "the outline has a positioning box");
    // v3 always showed it: stored projects keep their bytes.
    assert.ok(interfaceOf(generateReactProjectV3(placeholder(type, width, height))).includes(`{"${text}"}`));
  }
});

test("v4 shows fewer placeholder labels than v3 and never more", () => {
  let fewer = 0;
  for (const name of names) {
    const schema = load(new URL(name, fixturesUrl));
    const three = computeOutputMetrics(generateReactProjectV3(schema)).placeholderLabels;
    const four = computeOutputMetrics(generateReactProject(schema)).placeholderLabels;
    assert.equal(three, computeSchemaMetrics(schema).placeholderCount, `${name}: v3 labels every placeholder`);
    assert.ok(four <= three, name);
    if (four < three) fewer++;
  }
  assert.ok(fewer >= 10, `labels hidden on ${fewer} fixtures`);
});

// ---- Declared grids that auto-placement cannot reproduce ---------------------------------------

test("a declared GRID whose children span rows or columns gets explicit tracks in v4", () => {
  const schema = fixture("tremor-dashboard.fast.p11");
  const find = (node: UINode, id: string): UINode | null => node.id === id ? node : node.children.reduce<UINode | null>((found, child) => found ?? find(child, id), null);
  const dashboard = find(schema.root, "dashboard")!;
  assert.equal(dashboard.layout.mode, "GRID");
  assert.equal(dashboard.layout.columns, 3, "three column starts: the column count alone looks right");
  assert.equal(planLayout(schema, "v3").container(dashboard), null, "v3 kept the declared grid");
  const tracks = planLayout(schema, "v4").container(dashboard)?.tracks;
  assert.ok(tracks, "v4 builds tracks");
  const plan = planLayout(schema, "v4");
  const cell = (id: string) => plan.child(find(schema.root, id)!)?.cell;
  assert.deepEqual(cell("sidebar"), { columnStart: 1, columnEnd: 2, rowStart: 1, rowEnd: 4 }, "the sidebar spans both rows");
  assert.deepEqual(cell("holdings"), { columnStart: 3, columnEnd: 6, rowStart: 3, rowEnd: 4 }, "holdings sits beside it, under the charts");
  assert.equal(planLayout(schema, "v4").free.columnOverrides, 1);
});

test("a declared GRID that auto-placement reproduces is left as declared", () => {
  const cellNode = (id: string, x: number, y: number): UINode => ({
    id, type: "FRAME", name: id, bounds: { x, y, width: 300, height: 100 },
    layout: { mode: "NONE", direction: "NONE", justify: "START", align: "START", gap: null, columns: null, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    style: { background: null, color: null, border: null, radius: null, shadow: null, opacity: 1 }, text: null, image: null, children: [],
  });
  const grid: UINode = {
    ...cellNode("grid", 0, 0), bounds: { x: 0, y: 0, width: 940, height: 220 },
    layout: { mode: "GRID", direction: "NONE", justify: "START", align: "START", gap: 20, columns: 3, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
    children: [cellNode("a", 0, 0), cellNode("b", 320, 0), cellNode("c", 640, 0), cellNode("d", 0, 120), cellNode("e", 320, 120)],
  };
  const schema: UISchema = { schemaVersion: "1.0", source: { width: 940, height: 220 }, confidence: 0.9,
    designTokens: { colors: [], typography: [], spacing: [], radii: [] }, warnings: [], root: grid };
  assert.equal(planLayout(schema, "v4").container(grid), null);
  // The same grid with the last child moved under the third column cannot be auto-placed.
  const moved: UINode = { ...grid, children: [...grid.children.slice(0, 4), cellNode("e", 640, 120)] };
  assert.ok(planLayout({ ...schema, root: moved }, "v4").container(moved)?.tracks);
});

// ---- Valid, safe output -----------------------------------------------------------------------

function assertCompiles(project: GeneratedProject) {
  const files = new Map(project.files.map((file) => [resolve(file.path).replaceAll("\\", "/"), file.content]));
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, types: ["react"],
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.readFile = (path) => files.get(resolve(path).replaceAll("\\", "/")) ?? readFile(path);
  host.fileExists = (path) => files.has(resolve(path).replaceAll("\\", "/")) || exists(path);
  const directoryExists = host.directoryExists!.bind(host);
  host.directoryExists = (path) => path.replaceAll("\\", "/").endsWith("/src/generated") || directoryExists(path);
  host.getSourceFile = (path, version) => {
    const content = host.readFile(path);
    return content === undefined ? undefined : ts.createSourceFile(path, content, version, true);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
}

test("every fixture's v4 output type-checks as React TSX", () => {
  for (const name of names) assertCompiles(generateReactProject(load(new URL(name, fixturesUrl))));
});

test("every class v4 emits is a Tailwind utility the real compiler accepts", async () => {
  const theme = readFileSync(new URL("../../node_modules/tailwindcss/theme.css", import.meta.url), "utf8");
  const compiler = await compile(theme + "\n@tailwind utilities;");
  const empty = compiler.build([]).length;
  const tokens = new Set<string>();
  for (const name of names) for (const list of classLists(interfaceOf(generateReactProject(load(new URL(name, fixturesUrl)))))) list.forEach((token) => tokens.add(token));
  for (const token of ["grid", "flex-nowrap", "[grid-column:2/4]", "[grid-row:1/3]", "[margin-top:-3px]", "[inset:0]", "pointer-events-none",
    "[font-family:'Open_Sans','Arial',sans-serif]", "[font-family:'Fira_Code',monospace]"]) tokens.add(token);
  assert.ok(tokens.size > 60);
  for (const token of tokens) assert.ok(compiler.build([token]).length > empty, `not a Tailwind utility: ${token}`);
  const css = compiler.build(["[font-family:'Open_Sans','Arial',sans-serif]"]);
  assert.match(css, /font-family: 'Open Sans','Arial',sans-serif/, "underscores become spaces inside the quoted name");
});

test("the preview understands every class v3 and v4 emit, so it renders what the export renders", () => {
  for (const name of names) {
    for (const generate of [generateReactProjectV3, generateReactProject]) {
      const source = interfaceOf(generate(load(new URL(name, fixturesUrl))));
      for (const list of classLists(source)) {
        for (const token of list) assert.ok(STANDARD_UTILITIES[token] !== undefined || parseArbitraryProperty(token) !== null, `${name}: preview ignores ${token}`);
      }
    }
  }
  const css = generatePreviewCss([interfaceOf(generateReactProject(fixture("codepen-login.balanced.p11")))]);
  assert.match(css, /\.whitespace-pre \{ white-space: pre; \}/, "the 84 px heading keeps \"Log In\" on one line in the preview");
  assert.match(css, /font-family: 'Lato',sans-serif;/);
});

test("v4 keeps the safety properties: no inline styles, assets, links, handlers or remote resources", () => {
  for (const name of names) {
    const source = interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))));
    assert.doesNotMatch(source, /style=\{|<img|<link|https?:|src=|url\(|@import|@font-face|dangerouslySetInnerHTML|onClick|javascript:/, name);
    assert.ok(!source.includes("\r") && source.endsWith("\n"));
  }
});

test("no element is both flex and grid, and a track grid carries no gap or justify", () => {
  for (const name of names) {
    for (const tokens of classLists(interfaceOf(generateReactProject(load(new URL(name, fixturesUrl)))))) {
      assert.ok(!(tokens.includes("grid") && tokens.includes("flex")), `${name}: flex + grid`);
      if (tokens.some((token) => token.startsWith("[grid-template-columns:minmax(0,") && token.includes("fr)"))) {
        assert.ok(!tokens.some((token) => token.startsWith("[gap:") || token.startsWith("justify-") || token.startsWith("items-")), `${name}: track grid with flow classes`);
      }
    }
  }
});

test("v4 vs v3: every single-line text unwrapped, no more forced widths or wrapping rows, the fallback no more often", () => {
  for (const name of names) {
    const schema = load(new URL(name, fixturesUrl));
    const input = computeSchemaMetrics(schema);
    const three = computeOutputMetrics(generateReactProjectV3(schema));
    const four = computeOutputMetrics(generateReactProject(schema));
    assert.equal(four.noWrapText, input.singleLineTextNodes, `${name}: every single-line text is no-wrap in v4`);
    assert.equal(four.noWrapText, three.noWrapText);
    assert.ok(four.forcedFullWidth <= three.forcedFullWidth, `${name}: ${four.forcedFullWidth} vs ${three.forcedFullWidth}`);
    assert.ok(four.flexWrapRows <= three.flexWrapRows, `${name}: no more wrapping rows`);
    assert.ok(planLayout(schema, "v4").free.positioned <= planLayout(schema, "v3").free.positioned, name);
  }
});

test("text with runs of spaces keeps them: v4 never uses the collapsing nowrap", () => {
  const source = names.map((name) => interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))))).join("\n");
  assert.doesNotMatch(source, /\bwhitespace-nowrap\b/);
  assert.match(source, /"[^"]*\S {2,}\S[^"]*"/, "fixtures do contain padded single-line text");
});

// ---- Versions: only v3 is kept; stored projects of every version keep working -----------------

const simple = load(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url));
/** What an old stored generation looks like to the app: the same shape, labelled with its version. */
const stored = (version: "1" | "2" | "3"): GeneratedProject => ({ ...generateReactProjectV3(simple), generatorVersion: version });

test("only the immediately previous generator is kept, and only the comparison tools use it", () => {
  assert.deepEqual(GENERATOR_VERSIONS.map((entry) => entry.version), ["3"]);
  for (const gone of ["generateReactProjectV1.ts", "generateReactProjectV2.ts"]) {
    assert.equal(existsSync(new URL("../src/features/generation/" + gone, import.meta.url)), false, `${gone} is gone: stored projects are data`);
  }
  const offenders: string[] = [];
  const walk = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(entry.name) && !["generateReactProjectV3.ts", "generatorVersions.ts"].includes(entry.name)
        && /from\s+["'][^"']*(generateReactProjectV\d|generatorVersions)(?:\.ts)?["']/.test(readFileSync(child, "utf8"))) offenders.push(entry.name);
    }
  };
  walk(new URL("../src/", import.meta.url));
  assert.deepEqual(offenders, [], "an application module imports a legacy generator");
});

test("the contract accepts versions 1 to 4 and nothing else", () => {
  const files = [{ path: "src/App.tsx", content: "export default function App() { return null; }", language: "typescript" }];
  for (const version of ["1", "2", "3", "4"]) assert.equal(GeneratedProjectSchema.safeParse({ target: "react-tailwind", generatorVersion: version, files }).success, true, version);
  for (const version of ["0", "5", 1, 4, null]) assert.equal(GeneratedProjectSchema.safeParse({ target: "react-tailwind", generatorVersion: version, files }).success, false, String(version));
  for (const project of [stored("1"), stored("2"), stored("3"), generateReactProject(simple)]) {
    const detail = { id: generationOne, projectId: projectA, sourceImagePath: null, sourceImageName: null, sourceImageMimeType: null,
      generationTarget: "REACT_TAILWIND", fidelityMode: "BALANCED", createdAt: "2026-10-14T10:00:00.000Z", uiSchema: simple, generatedProject: project };
    assert.equal(GenerationDetailSchema.safeParse(detail).success, true, project.generatorVersion);
  }
});

test("restoring a stored generation of any version works and never regenerates", async () => {
  for (const [id, project] of [[generationOne, stored("1")], [generationTwo, stored("2")], [generationOne, stored("3")]] as const) {
    const { client } = fakeClient({ getGeneration: async (projectId, generationId) => storedGeneration(projectId, generationId, project) });
    const loaded: GeneratedProject[] = [];
    const session = createGenerationSessionModel({ client, loadProject: (restored) => { loaded.push(restored); } });
    assert.equal(await session.openGeneration(projectA, id), true);
    assert.deepEqual(session.getSnapshot().artifact?.generatedProject, project, "exactly what was stored");
    assert.equal(session.getSnapshot().artifact?.generatedProject.generatorVersion, project.generatorVersion);
    assert.deepEqual(loaded, [project]);
  }
});

test("editor, preview and export accept projects of every version", () => {
  const engine: PreviewEngine = { kind: "placeholder", render: async () => ({ documentHtml: "<html></html>" }) };
  for (const project of [stored("1"), stored("2"), stored("3"), generateReactProject(simple)]) {
    const editor = createEditorModel();
    editor.setProject(project);
    assert.equal(editor.getSnapshot().project?.generatorVersion, project.generatorVersion);
    const preview = createPreviewModel(engine);
    preview.setProject(project);
    assert.equal(preview.getSnapshot().project?.generatorVersion, project.generatorVersion);
    const plan = buildRunnableExportPlan(project.files.map(({ path, content }) => ({ path, content })), "Alpha");
    assert.ok(plan.ok, project.generatorVersion);
    assert.ok(plan.ok && plan.plan.files.some((file) => file.path === "package.json"));
  }
});

test("preview, export and the editor receive version 4 like any other", () => {
  const project = generateReactProject(load(new URL(names[0]!, fixturesUrl)));
  assert.equal(project.generatorVersion, "4");
  assert.deepEqual(project.files.map((file) => file.path), ["src/App.tsx", "src/generated/GeneratedInterface.tsx"]);
});

// ---- The browser measurement harness is opt-in tooling ----------------------------------------

test("measure:layout is opt-in, needs V2C_BROWSER, and adds no dependency", () => {
  const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string>; dependencies?: object; devDependencies?: object };
  assert.match(root.scripts["measure:layout"]!, /scripts\/measure-layout\.mts/);
  assert.doesNotMatch(root.scripts.test!, /measure/);
  assert.equal(root.dependencies, undefined);
  const source = readFileSync(new URL("../../scripts/measure-layout.mts", import.meta.url), "utf8");
  assert.match(source, /process\.env\.V2C_BROWSER/);
  const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]!);
  for (const specifier of imports) {
    assert.ok(specifier.startsWith("node:") || specifier.startsWith("../desktop/src/") || specifier === "@vision2code/contracts", `unexpected import ${specifier}`);
  }
  assert.doesNotMatch(source, /from "(playwright|puppeteer)/, "no browser-automation dependency");
});
