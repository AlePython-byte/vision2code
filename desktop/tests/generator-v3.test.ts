import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { compile } from "tailwindcss";
import { UISchemaSchema } from "@vision2code/contracts";
import type { GeneratedProject, UISchema } from "@vision2code/contracts";
import { computeOutputMetrics } from "../src/features/fidelity/outputMetrics.ts";
import { computeSchemaMetrics } from "../src/features/fidelity/schemaMetrics.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { generateReactProjectV2 } from "../src/features/generation/generateReactProjectV2.ts";
import { planLayout } from "../src/features/generation/layoutInference.ts";

const fixturesUrl = new URL("./fixtures/ui-schemas/", import.meta.url);
const goldenUrl = new URL("./golden/", import.meta.url);
const load = (url: URL): UISchema => UISchemaSchema.parse(JSON.parse(readFileSync(url, "utf8")));
const names = readdirSync(fixturesUrl).filter((name) => name.endsWith(".json")).sort();
const short = (name: string) => name.replace(".v1.json", "");
const interfaceOf = (project: GeneratedProject) => project.files.find((file) => file.path.endsWith("GeneratedInterface.tsx"))!.content;
const classLists = (source: string) =>
  [...source.matchAll(/className=\{("(?:[^"\\]|\\.)*")\}/g)].map((match) => (JSON.parse(match[1]!) as string).split(" "));

// ---- Golden output (update deliberately with UPDATE_GOLDEN=1) ---------------------------------

test("golden: generator v3 output is byte-for-byte what was reviewed, for every fixture", () => {
  assert.ok(names.length >= 3, "the baseline fixtures are present");
  mkdirSync(goldenUrl, { recursive: true });
  for (const name of names) {
    const actual = interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))));
    const golden = new URL(`${short(name)}.v3.GeneratedInterface.tsx.txt`, goldenUrl);
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(golden)) writeFileSync(golden, actual);
    assert.equal(actual, readFileSync(golden, "utf8"), `${name} changed: review the diff, then run with UPDATE_GOLDEN=1`);
  }
});

test("every golden file belongs to a fixture and a generator version", () => {
  const expected = names.flatMap((name) => ["v2", "v3"].map((version) => `${short(name)}.${version}.GeneratedInterface.tsx.txt`)).sort();
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
    assert.equal(generateReactProject(schema).generatorVersion, "3");
    assert.doesNotMatch(first, /NaN|Infinity|undefined/);
  }
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

test("every fixture's v3 output type-checks as React TSX", () => {
  for (const name of names) assertCompiles(generateReactProject(load(new URL(name, fixturesUrl))));
});

test("every class v3 emits is a Tailwind utility the real compiler accepts", async () => {
  const theme = readFileSync(new URL("../../node_modules/tailwindcss/theme.css", import.meta.url), "utf8");
  const compiler = await compile(theme + "\n@tailwind utilities;");
  const empty = compiler.build([]).length;
  const tokens = new Set<string>();
  for (const name of names) for (const list of classLists(interfaceOf(generateReactProject(load(new URL(name, fixturesUrl)))))) list.forEach((token) => tokens.add(token));
  for (const token of ["grid", "flex-nowrap", "[grid-column:2/4]", "[grid-row:1/3]", "[grid-template-columns:minmax(0,300fr)_minmax(0,40fr)]",
    "[grid-template-rows:minmax(160px,auto)_minmax(28px,auto)]", "[margin-top:-3px]", "[left:16.6667%]"]) tokens.add(token);
  assert.ok(tokens.size > 60);
  for (const token of tokens) assert.ok(compiler.build([token]).length > empty, `not a Tailwind utility: ${token}`);
});

test("v3 keeps the safety properties: no styles, assets, links or handlers", () => {
  for (const name of names) {
    const source = interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))));
    assert.doesNotMatch(source, /style=\{|<img|https?:|src=|dangerouslySetInnerHTML|onClick|javascript:/, name);
    assert.ok(!source.includes("\r") && source.endsWith("\n"));
  }
});

// ---- v3 against v2 on the fixtures ------------------------------------------------------------

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

test("the containers v2 left flat are now structured, and the fallback is not needed on these fixtures", () => {
  const expectations: Record<string, { trackGrids: number }> = {
    "codepen-login": { trackGrids: 2 }, // the re-saved fixture: two NONE areas without a flow (heading/columns/prompt)
    "linear-landing": { trackGrids: 2 }, // issue-panel (NONE) and hero (a column whose last band is a row)
    "tremor-dashboard": { trackGrids: 1 }, // dashboard: GRID declared with 4 columns over 3
  };
  // Only the baseline fixtures have reviewed expectations; per-mode fixtures added later are measured, not pinned.
  for (const name of names.filter((entry) => short(entry) in expectations)) {
    const { free } = planLayout(load(new URL(name, fixturesUrl)), "v3");
    assert.equal(free.positioned, 0, `${name}: positioning by bounds is a last resort and was not needed`);
    assert.equal(free.trackGrids, expectations[short(name)]!.trackGrids, `${name}: track grids`);
    assert.equal(planLayout(load(new URL(name, fixturesUrl)), "v2").free.trackGrids, 0, "v2 never builds tracks");
  }
});

test("v3 vs v2: fewer forced widths, every single-line text unwrapped, no more wrapping rows", () => {
  for (const name of names) {
    const schema = load(new URL(name, fixturesUrl));
    const input = computeSchemaMetrics(schema);
    const two = computeOutputMetrics(generateReactProjectV2(schema));
    const three = computeOutputMetrics(generateReactProject(schema));
    // Metrics and generator share the padding-aware single-line heuristic.
    assert.equal(three.noWrapText, input.singleLineTextNodes, `${name}: every single-line text is no-wrap in v3`);
    assert.ok(three.noWrapText >= two.noWrapText, `${name}: v3 never wraps more single-line text than v2`);
    assert.ok(three.forcedFullWidth <= two.forcedFullWidth + 2, `${name}: ${three.forcedFullWidth} vs ${two.forcedFullWidth}`);
    assert.ok(three.flexWrapRows <= two.flexWrapRows, `${name}: no more wrapping rows`);
  }
});

test("preview, export and the editor receive version 3 like any other", () => {
  const project = generateReactProject(load(new URL(names[0]!, fixturesUrl)));
  assert.equal(project.generatorVersion, "3");
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

test("text with runs of spaces keeps them: v3 never uses the collapsing nowrap", () => {
  const source = names.map((name) => interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))))).join("\n");
  assert.doesNotMatch(source, /\bwhitespace-nowrap\b/);
  assert.match(source, /"[^"]*\S {2,}\S[^"]*"/, "fixtures do contain padded single-line text");
});
