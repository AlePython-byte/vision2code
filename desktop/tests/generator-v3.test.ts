import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import { UISchemaSchema } from "@vision2code/contracts";
import type { GeneratedProject, UISchema } from "@vision2code/contracts";
import { generateReactProjectV3 } from "../src/features/generation/generateReactProjectV3.ts";

// Generator v3 is frozen: it is the "before" side of the v4 comparison, and what it emitted for every
// fixture is pinned byte for byte by the golden files below (the same files v3 was reviewed with).
const fixturesUrl = new URL("./fixtures/ui-schemas/", import.meta.url);
const goldenUrl = new URL("./golden/", import.meta.url);
const load = (url: URL): UISchema => UISchemaSchema.parse(JSON.parse(readFileSync(url, "utf8")));
const names = readdirSync(fixturesUrl).filter((name) => name.endsWith(".json")).sort();
const interfaceOf = (project: GeneratedProject) => project.files.find((file) => file.path.endsWith("GeneratedInterface.tsx"))!.content;

test("golden: frozen generator v3 output is byte-for-byte what was reviewed, for every fixture", () => {
  assert.ok(names.length >= 12, "the baseline and per-mode fixtures are present");
  mkdirSync(goldenUrl, { recursive: true });
  for (const name of names) {
    const actual = interfaceOf(generateReactProjectV3(load(new URL(name, fixturesUrl))));
    const golden = new URL(`${name.replace(".v1.json", "")}.v3.GeneratedInterface.tsx.txt`, goldenUrl);
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, actual);
    assert.ok(existsSync(golden), `${name}: missing golden file; review the output, then create it with UPDATE_GOLDEN=1`);
    assert.equal(actual, readFileSync(golden, "utf8"), `${name}: generator v3 is frozen and must not change`);
  }
});

test("v3 stays deterministic and emits generatorVersion 3", () => {
  for (const name of names) {
    const schema = load(new URL(name, fixturesUrl));
    const before = structuredClone(schema);
    const first = JSON.stringify(generateReactProjectV3(schema));
    assert.equal(JSON.stringify(generateReactProjectV3(structuredClone(schema))), first);
    assert.deepEqual(schema, before);
    assert.equal(generateReactProjectV3(schema).generatorVersion, "3");
  }
});
