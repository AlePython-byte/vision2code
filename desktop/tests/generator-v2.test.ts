import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { compile } from "tailwindcss";
import { GeneratedProjectSchema, GenerationDetailSchema, UISchemaSchema } from "@vision2code/contracts";
import type { GeneratedProject, UISchema } from "@vision2code/contracts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { buildRunnableExportPlan } from "../src/features/export/exportScaffold.ts";
import { computeOutputMetrics } from "../src/features/fidelity/outputMetrics.ts";
import { computeSchemaMetrics } from "../src/features/fidelity/schemaMetrics.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { generateReactProjectV1 } from "../src/features/generation/generateReactProjectV1.ts";
import { createGenerationSessionModel } from "../src/features/generation/generationSessionModel.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import type { PreviewEngine } from "../src/features/preview/previewTypes.ts";
import { fakeClient, projectA, generationOne, generationTwo, storedGeneration } from "./generation-fixtures.ts";

const fixturesUrl = new URL("./fixtures/ui-schemas/", import.meta.url);
const goldenUrl = new URL("./golden/", import.meta.url);
const load = (url: URL): UISchema => UISchemaSchema.parse(JSON.parse(readFileSync(url, "utf8")));
const names = readdirSync(fixturesUrl).filter((name) => name.endsWith(".json")).sort();
const simple = load(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url));
const interfaceOf = (project: GeneratedProject) => project.files.find((file) => file.path.endsWith("GeneratedInterface.tsx"))!.content;

// ---- Golden output (update deliberately with UPDATE_GOLDEN=1) ---------------------------------

test("golden: generator v2 output is byte-for-byte what was reviewed, for every fixture", () => {
  assert.ok(names.length >= 3, "the baseline fixtures are present");
  mkdirSync(goldenUrl, { recursive: true });
  for (const name of names) {
    const actual = interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))));
    const golden = new URL(`${name.replace(".v1.json", "")}.v2.GeneratedInterface.tsx.txt`, goldenUrl);
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(golden)) writeFileSync(golden, actual);
    assert.equal(actual, readFileSync(golden, "utf8"), `${name} changed: review the diff, then run with UPDATE_GOLDEN=1`);
  }
});

test("golden files are the only snapshots and each belongs to a fixture", () => {
  const expected = names.map((name) => `${name.replace(".v1.json", "")}.v2.GeneratedInterface.tsx.txt`).sort();
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
    assert.doesNotMatch(first, /NaN|Infinity|undefined|null\b.*px/);
  }
});

// ---- Version compatibility --------------------------------------------------------------------

test("v1 stays reproducible byte for byte (stored generations are immutable)", () => {
  // Hashes of generator v1's files taken from the generator as it was before v2 existed.
  const expected: Record<string, string> = {
    "simple-interface.json": "b90bc432274a06d9715fa536557a2d85a151d14adbab0c4d80be57440331e94c",
    "codepen-login.v1.json": "05708c21741835c9e97b38807a03d87aae1fdebcd1a1bf8de6cbac052190b511",
    "linear-landing.v1.json": "f34e818edbea006aede714a9a9e4f2ebdb6938e968864ce3f5c93a066ddf0a14",
    "tremor-dashboard.v1.json": "93f016095bec36c9a841df1c0e1a39b5a5814b3ca16345b114b7d0a9bee4e6cb",
  };
  const inputs: [string, UISchema][] = [["simple-interface.json", simple], ...names.map((name): [string, UISchema] => [name, load(new URL(name, fixturesUrl))])];
  for (const [name, schema] of inputs) {
    const project = generateReactProjectV1(schema);
    assert.equal(project.generatorVersion, "1");
    const hash = createHash("sha256").update(project.files.map((file) => file.content).join("\n---\n")).digest("hex");
    assert.equal(hash, expected[name], name);
  }
  assert.equal(generateReactProject(simple).generatorVersion, "2");
});

test("the application never calls generator v1: only tests and scripts import it", () => {
  const offenders: string[] = [];
  const walk = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== "generateReactProjectV1.ts"
        && /from\s+["'][^"']*generateReactProjectV1(?:\.ts)?["']/.test(readFileSync(child, "utf8"))) offenders.push(entry.name);
    }
  };
  walk(new URL("../src/", import.meta.url));
  assert.deepEqual(offenders, [], "an application module imports the legacy generator");
});

test("the contract accepts versions 1 and 2 and nothing else", () => {
  const files = [{ path: "src/App.tsx", content: "export default function App() { return null; }", language: "typescript" }];
  for (const version of ["1", "2"]) assert.equal(GeneratedProjectSchema.safeParse({ target: "react-tailwind", generatorVersion: version, files }).success, true, version);
  for (const version of ["0", "3", 1, 2, null]) assert.equal(GeneratedProjectSchema.safeParse({ target: "react-tailwind", generatorVersion: version, files }).success, false, String(version));
  for (const project of [generateReactProjectV1(simple), generateReactProject(simple)]) {
    assert.equal(GeneratedProjectSchema.safeParse(project).success, true);
    const detail = { id: generationOne, projectId: projectA, sourceImagePath: null, sourceImageName: null, sourceImageMimeType: null,
      generationTarget: "REACT_TAILWIND", fidelityMode: "BALANCED", createdAt: "2026-10-14T10:00:00.000Z", uiSchema: simple, generatedProject: project };
    assert.equal(GenerationDetailSchema.safeParse(detail).success, true, project.generatorVersion);
  }
});

test("restoring a stored generation works for both versions and never regenerates", async () => {
  for (const [id, project] of [[generationOne, generateReactProjectV1(simple)], [generationTwo, generateReactProject(simple)]] as const) {
    const { client } = fakeClient({ getGeneration: async (projectId, generationId) => storedGeneration(projectId, generationId, project) });
    const loaded: GeneratedProject[] = [];
    const session = createGenerationSessionModel({ client, loadProject: (restored) => { loaded.push(restored); } });
    assert.equal(await session.openGeneration(projectA, id), true);
    assert.deepEqual(session.getSnapshot().artifact?.generatedProject, project, "exactly what was stored");
    assert.equal(session.getSnapshot().artifact?.generatedProject.generatorVersion, project.generatorVersion);
    assert.deepEqual(loaded, [project]);
  }
});

test("editor, preview and export accept projects of either version", async () => {
  const engine: PreviewEngine = { kind: "placeholder", render: async () => ({ documentHtml: "<html></html>" }) };
  for (const project of [generateReactProjectV1(simple), generateReactProject(simple)]) {
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

// ---- The v2 output is valid, safe and measurably better ---------------------------------------

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

test("every fixture's v2 output type-checks as React TSX", () => {
  for (const name of names) assertCompiles(generateReactProject(load(new URL(name, fixturesUrl))));
});

test("every class v2 emits is a Tailwind utility the real compiler accepts", async () => {
  const theme = readFileSync(new URL("../../node_modules/tailwindcss/theme.css", import.meta.url), "utf8");
  const compiler = await compile(theme + "\n@tailwind utilities;");
  const empty = compiler.build([]).length;
  const tokens = new Set<string>();
  for (const name of names) {
    const source = interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))));
    for (const match of source.matchAll(/className=\{("(?:[^"\\]|\\.)*")\}/g)) for (const token of (JSON.parse(match[1]!) as string).split(" ")) tokens.add(token);
  }
  for (const token of ["whitespace-pre", "self-center", "self-end", "self-start", "flex-nowrap", "overflow-hidden",
    "[flex:0_1_224px]", "[margin-top:-3px]", "[margin-left:14px]", "[width:180px]", "[max-width:100%]", "[max-height:25px]"]) tokens.add(token);
  assert.ok(tokens.size > 40);
  for (const token of tokens) assert.ok(compiler.build([token]).length > empty, `not a Tailwind utility: ${token}`);
});

test("v2 output keeps the safety properties: no styles, assets, links or handlers", () => {
  for (const name of names) {
    const source = interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))));
    assert.doesNotMatch(source, /style=\{|<img|https?:|src=|dangerouslySetInnerHTML|onClick|javascript:/, name);
    assert.ok(!source.includes("\r"));
    assert.ok(source.endsWith("\n"));
  }
});

test("v2 vs v1 on the fixtures: no clamp-risk text wraps, rows keep their children side by side, fewer forced widths", () => {
  for (const name of names) {
    const schema = load(new URL(name, fixturesUrl));
    const input = computeSchemaMetrics(schema);
    const one = computeOutputMetrics(generateReactProjectV1(schema));
    const two = computeOutputMetrics(generateReactProject(schema));
    assert.equal(one.noWrapText, 0, `${name}: v1 wraps every text`);
    assert.equal(two.noWrapText, input.singleLineTextNodes, `${name}: every single-line text is no-wrap in v2`);
    assert.equal(two.noWrapText + two.wrapText, input.textNodes, `${name}: every text node is accounted for`);
    assert.ok(two.forcedFullWidth < one.forcedFullWidth, `${name}: ${two.forcedFullWidth} < ${one.forcedFullWidth}`);
    assert.ok(two.rowChildBasis > 0 && two.noWrapRows > 0, `${name}: rows keep one line`);
    assert.equal(one.rowChildBasis + one.noWrapRows + one.fixedWidthChildren, 0, `${name}: v1 has none of the v2 features`);
  }
});

test("text with runs of spaces keeps them: v2 never uses the collapsing nowrap", () => {
  const source = names.map((name) => interfaceOf(generateReactProject(load(new URL(name, fixturesUrl))))).join("\n");
  assert.doesNotMatch(source, /\bwhitespace-nowrap\b/);
  assert.match(source, /"[^"]*\S {2,}\S[^"]*"/, "fixtures do contain padded single-line text");
});
