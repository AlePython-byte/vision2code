/**
 * Prints schema metrics for every UISchema fixture in desktop/tests/fixtures/ui-schemas, and what
 * generator v1 and v2 emit for each, so a change to the prompt or the generator can be compared
 * before and after.
 *
 *   npm run report:fidelity
 */
import { readdirSync, readFileSync } from "node:fs";
import { UISchemaSchema } from "@vision2code/contracts";
import { computeOutputMetrics } from "../desktop/src/features/fidelity/outputMetrics.ts";
import { computeSchemaMetrics } from "../desktop/src/features/fidelity/schemaMetrics.ts";
import { generateReactProject } from "../desktop/src/features/generation/generateReactProject.ts";
import { generateReactProjectV1 } from "../desktop/src/features/generation/generateReactProjectV1.ts";
import { planLayout } from "../desktop/src/features/generation/layoutInference.ts";

const folder = new URL("../desktop/tests/fixtures/ui-schemas/", import.meta.url);
const names = readdirSync(folder).filter((name) => name.endsWith(".json")).sort();

if (names.length === 0) {
  console.log("No fixtures in desktop/tests/fixtures/ui-schemas (see the README there to save one from the dev inspector).");
  process.exit(0);
}

function table(columns: string[], rows: string[][]) {
  const widths = columns.map((column, index) => Math.max(column.length, ...rows.map((row) => row[index]!.length)));
  const line = (cells: string[]) => cells.map((cell, index) => (index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!))).join("  ");
  console.log(line(columns));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(line(row));
}

const inputRows: string[][] = [];
const outputRows: string[][] = [];
let invalid = 0;
for (const name of names) {
  const parsed = UISchemaSchema.safeParse(JSON.parse(readFileSync(new URL(name, folder), "utf8")));
  if (!parsed.success) {
    invalid++;
    inputRows.push([name, ...Array(10).fill("INVALID")]);
    continue;
  }
  const schema = parsed.data;
  const m = computeSchemaMetrics(schema);
  inputRows.push([name, m.nodeCount, m.maxDepth, m.containersWithoutLayout, m.rowCandidates, m.textClampRisk, m.placeholderCount,
    m.confidence.toFixed(2), m.warningCount, m.jsonBytes, generateReactProject(schema).files.length].map(String));

  const short = name.replace(".v1.json", "");
  const stats = planLayout(schema).stats;
  for (const [version, project] of [["1", generateReactProjectV1(schema)], ["2", generateReactProject(schema)]] as const) {
    const o = computeOutputMetrics(project);
    const v2 = version === "2";
    outputRows.push([short, `v${version}`, o.noWrapText, o.wrapText, v2 ? 0 : m.textClampRisk, o.forcedFullWidth, o.flexWrapRows, o.noWrapRows,
      o.rowChildBasis, o.fixedWidthChildren, o.selfAlignments, o.spacingMargins,
      v2 ? stats.gaps : 0, v2 ? stats.paddings : 0, v2 ? stats.justifyOverrides : 0].map(String));
  }
}

console.log("INPUT (UISchema)");
table(["fixture", "nodes", "depth", "noLayout", "rows", "textRisk", "placeholders", "conf", "warn", "bytes", "files"], inputRows);
console.log("\nOUTPUT (what each generator version emitted for the same schema)");
table(["fixture", "gen", "noWrapText", "wrapText", "riskWraps", "wFull", "wrapRows", "oneLineRows", "rowBasis", "fixedW", "selfAlign", "margins", "infGap", "infPad", "justifyFix"], outputRows);
console.log(`\n${names.length} fixture(s), ${invalid} invalid.
Input: noLayout = containers with 2+ children and layout NONE; rows = row candidates; textRisk = single-line text estimated wider than its bounds.
Output: noWrapText = text that never wraps; riskWraps = clamp-risk text that still wraps; wFull = children forced to full width (root excluded);
wrapRows/oneLineRows = rows allowed to wrap / kept on one line; rowBasis = row children keeping their own width; fixedW = column children keeping their width;
selfAlign / margins = per-child alignment and residual spacing inferred from bounds; infGap / infPad = container gap and padding inferred; justifyFix = declared justify replaced because bounds contradict it.`);
process.exit(invalid > 0 ? 1 : 0);
