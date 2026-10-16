import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { UISchemaSchema } from "@vision2code/contracts";
import { computeSchemaMetrics } from "../src/features/fidelity/schemaMetrics.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";

const folder = new URL("./fixtures/ui-schemas/", import.meta.url);
const fixtures = readdirSync(folder).filter((name) => name.endsWith(".json")).sort();

test("the fixtures folder exists and documents how to save a schema from the dev inspector", () => {
  const readme = readFileSync(new URL("README.md", folder), "utf8");
  assert.match(readme, /Copy JSON/);
  assert.match(readme, /report:fidelity/);
});

// With no *.json files this suite registers nothing and the run still passes.
for (const name of fixtures) {
  test(`fixture ${name}: valid UISchema, non-empty and stable generation, stable metrics`, () => {
    const parsed = UISchemaSchema.safeParse(JSON.parse(readFileSync(new URL(name, folder), "utf8")));
    assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);

    const first = generateReactProject(parsed.data);
    const second = generateReactProject(structuredClone(parsed.data));
    assert.ok(first.files.length > 0);
    for (const file of first.files) assert.ok(file.path.length > 0 && file.content.trim().length > 0, `${file.path} is empty`);
    assert.deepEqual(second, first, "same input, same generated project");

    const metrics = computeSchemaMetrics(parsed.data);
    assert.ok(metrics.nodeCount >= 1 && metrics.maxDepth >= 1 && metrics.jsonBytes > 0);
    assert.deepEqual(computeSchemaMetrics(structuredClone(parsed.data)), metrics, "same input, same metrics");
  });
}
