/**
 * Prints schema metrics for every UISchema fixture in desktop/tests/fixtures/ui-schemas, so a
 * change to the prompt or the generator can be compared before and after.
 *
 *   npm run report:fidelity
 */
import { readdirSync, readFileSync } from "node:fs";
import { UISchemaSchema } from "@vision2code/contracts";
import { computeSchemaMetrics } from "../desktop/src/features/fidelity/schemaMetrics.ts";
import { generateReactProject } from "../desktop/src/features/generation/generateReactProject.ts";

const folder = new URL("../desktop/tests/fixtures/ui-schemas/", import.meta.url);
const names = readdirSync(folder).filter((name) => name.endsWith(".json")).sort();

if (names.length === 0) {
  console.log("No fixtures in desktop/tests/fixtures/ui-schemas (see the README there to save one from the dev inspector).");
  process.exit(0);
}

const columns = ["fixture", "nodes", "depth", "noLayout", "rows", "textRisk", "placeholders", "conf", "warn", "bytes", "files"];
const rows: string[][] = [];
let invalid = 0;
for (const name of names) {
  const parsed = UISchemaSchema.safeParse(JSON.parse(readFileSync(new URL(name, folder), "utf8")));
  if (!parsed.success) {
    invalid++;
    rows.push([name, ...Array(columns.length - 1).fill("INVALID")]);
    continue;
  }
  const m = computeSchemaMetrics(parsed.data);
  rows.push([name, m.nodeCount, m.maxDepth, m.containersWithoutLayout, m.rowCandidates, m.textClampRisk, m.placeholderCount,
    m.confidence.toFixed(2), m.warningCount, m.jsonBytes, generateReactProject(parsed.data).files.length].map(String));
}
const widths = columns.map((column, index) => Math.max(column.length, ...rows.map((row) => row[index]!.length)));
const line = (cells: string[]) => cells.map((cell, index) => (index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!))).join("  ");
console.log(line(columns));
console.log(widths.map((width) => "-".repeat(width)).join("  "));
for (const row of rows) console.log(line(row));
console.log(`\n${names.length} fixture(s), ${invalid} invalid. Columns: noLayout = containers with 2+ children and layout NONE; rows = row candidates; textRisk = single-line text estimated wider than its bounds.`);
process.exit(invalid > 0 ? 1 : 0);
