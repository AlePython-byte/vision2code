import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import test from "node:test";
import { GeneratedProjectSchema, GenerationDetailSchema, UISchemaSchema } from "@vision2code/contracts";
import type { GeneratedProject, UISchema } from "@vision2code/contracts";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { buildRunnableExportPlan } from "../src/features/export/exportScaffold.ts";
import { generateReactProjectV2 } from "../src/features/generation/generateReactProjectV2.ts";
import { GENERATOR_VERSIONS } from "../src/features/generation/generatorVersions.ts";
import { createGenerationSessionModel } from "../src/features/generation/generationSessionModel.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import type { PreviewEngine } from "../src/features/preview/previewTypes.ts";
import { fakeClient, projectA, generationOne, generationTwo, storedGeneration } from "./generation-fixtures.ts";

// Generator v2 is frozen: it is the "before" side of the v3 comparison, and what it emitted for the
// fixtures is pinned byte for byte by the golden files below.
const fixturesUrl = new URL("./fixtures/ui-schemas/", import.meta.url);
const goldenUrl = new URL("./golden/", import.meta.url);
const load = (url: URL): UISchema => UISchemaSchema.parse(JSON.parse(readFileSync(url, "utf8")));
// v2 is the frozen "before" of the baseline fixtures only; per-mode (`.p11.`) fixtures have no v2 golden.
const names = readdirSync(fixturesUrl).filter((name) => name.endsWith(".json") && !name.includes(".p11.")).sort();
const simple = load(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url));
const interfaceOf = (project: GeneratedProject) => project.files.find((file) => file.path.endsWith("GeneratedInterface.tsx"))!.content;
/** What an old stored generation looks like to the app: the same shape, labelled with its version. */
const stored = (version: "1" | "2"): GeneratedProject => ({ ...generateReactProjectV2(simple), generatorVersion: version });

test("golden: frozen generator v2 output is byte-for-byte what was reviewed, for every fixture", () => {
  assert.ok(names.length >= 3, "the baseline fixtures are present");
  mkdirSync(goldenUrl, { recursive: true });
  for (const name of names) {
    const actual = interfaceOf(generateReactProjectV2(load(new URL(name, fixturesUrl))));
    const golden = new URL(`${name.replace(".v1.json", "")}.v2.GeneratedInterface.tsx.txt`, goldenUrl);
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, actual);
    assert.ok(existsSync(golden), `${name}: missing golden file; review the output, then create it with UPDATE_GOLDEN=1`);
    assert.equal(actual, readFileSync(golden, "utf8"), `${name}: generator v2 is frozen and must not change`);
  }
});

test("v2 stays deterministic and emits generatorVersion 2", () => {
  for (const name of names) {
    const schema = load(new URL(name, fixturesUrl));
    const before = structuredClone(schema);
    const first = JSON.stringify(generateReactProjectV2(schema));
    assert.equal(JSON.stringify(generateReactProjectV2(structuredClone(schema))), first);
    assert.deepEqual(schema, before);
    assert.equal(generateReactProjectV2(schema).generatorVersion, "2");
  }
});

test("only the immediately previous generator is kept, and only the comparison tools use it", () => {
  assert.deepEqual(GENERATOR_VERSIONS.map((entry) => entry.version), ["2"]);
  assert.equal(existsSync(new URL("../src/features/generation/generateReactProjectV1.ts", import.meta.url)), false, "v1 is gone: stored v1 projects are data");
  const offenders: string[] = [];
  const walk = (directory: URL) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(entry.name) && !["generateReactProjectV2.ts", "generatorVersions.ts"].includes(entry.name)
        && /from\s+["'][^"']*(generateReactProjectV2|generatorVersions)(?:\.ts)?["']/.test(readFileSync(child, "utf8"))) offenders.push(entry.name);
    }
  };
  walk(new URL("../src/", import.meta.url));
  assert.deepEqual(offenders, [], "an application module imports a legacy generator");
});

test("the contract accepts versions 1, 2 and 3 and nothing else", () => {
  const files = [{ path: "src/App.tsx", content: "export default function App() { return null; }", language: "typescript" }];
  for (const version of ["1", "2", "3"]) assert.equal(GeneratedProjectSchema.safeParse({ target: "react-tailwind", generatorVersion: version, files }).success, true, version);
  for (const version of ["0", "4", 1, 2, 3, null]) assert.equal(GeneratedProjectSchema.safeParse({ target: "react-tailwind", generatorVersion: version, files }).success, false, String(version));
  for (const project of [stored("1"), stored("2")]) {
    const detail = { id: generationOne, projectId: projectA, sourceImagePath: null, sourceImageName: null, sourceImageMimeType: null,
      generationTarget: "REACT_TAILWIND", fidelityMode: "BALANCED", createdAt: "2026-10-14T10:00:00.000Z", uiSchema: simple, generatedProject: project };
    assert.equal(GenerationDetailSchema.safeParse(detail).success, true, project.generatorVersion);
  }
});

test("restoring a stored generation of any version works and never regenerates", async () => {
  for (const [id, project] of [[generationOne, stored("1")], [generationTwo, stored("2")]] as const) {
    const { client } = fakeClient({ getGeneration: async (projectId, generationId) => storedGeneration(projectId, generationId, project) });
    const loaded: GeneratedProject[] = [];
    const session = createGenerationSessionModel({ client, loadProject: (restored) => { loaded.push(restored); } });
    assert.equal(await session.openGeneration(projectA, id), true);
    assert.deepEqual(session.getSnapshot().artifact?.generatedProject, project, "exactly what was stored");
    assert.equal(session.getSnapshot().artifact?.generatedProject.generatorVersion, project.generatorVersion);
    assert.deepEqual(loaded, [project]);
  }
});

test("editor, preview and export accept stored projects of every version", () => {
  const engine: PreviewEngine = { kind: "placeholder", render: async () => ({ documentHtml: "<html></html>" }) };
  for (const project of [stored("1"), stored("2")]) {
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
