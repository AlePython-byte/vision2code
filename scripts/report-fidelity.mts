/**
 * Prints schema metrics for every UISchema fixture in desktop/tests/fixtures/ui-schemas, and what
 * the previous generator (v3) and the current one (v4) emit for each, so a change to the prompt or
 * the generator can be compared before and after. The browser-side comparison against the bounds
 * lives in `npm run measure:layout`.
 *
 *   npm run report:fidelity
 */
import { readdirSync, readFileSync } from "node:fs";
import { UISchemaSchema } from "@vision2code/contracts";
import { computeOutputMetrics } from "../desktop/src/features/fidelity/outputMetrics.ts";
import { computeSchemaMetrics } from "../desktop/src/features/fidelity/schemaMetrics.ts";
import { generateReactProject } from "../desktop/src/features/generation/generateReactProject.ts";
import { GENERATOR_VERSIONS } from "../desktop/src/features/generation/generatorVersions.ts";
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

/** `<site>.<mode>.p11[.rN].v1.json`: a prompt v1.1 analysis of one site in one mode (rN = repeated run). */
const MODE_FIXTURE = /^(?<site>[a-z0-9-]+)\.(?<mode>fast|balanced|precise)\.p11(?:\.r(?<run>\d+))?\.v1\.json$/;
interface ModeSample { nodes: number; textRisk: number; noLayout: number; rows: number; placeholders: number; warnings: number }
const byMode = new Map<string, ModeSample[]>();

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

  const match = MODE_FIXTURE.exec(name);
  if (match?.groups) {
    const key = `${match.groups.site}|${match.groups.mode}`;
    byMode.set(key, [...(byMode.get(key) ?? []), { nodes: m.nodeCount, textRisk: m.textClampRisk, noLayout: m.containersWithoutLayout,
      rows: m.rowCandidates, placeholders: m.placeholderCount, warnings: m.warningCount }]);
  }
  const short = name.replace(".v1.json", "");
  const generators = [...GENERATOR_VERSIONS.map(({ version, generate }) => ({ version, generate, profile: "v3" as const })),
    { version: "4", generate: generateReactProject, profile: "v4" as const }];
  for (const { version, generate, profile } of generators) {
    const o = computeOutputMetrics(generate(schema));
    const plan = planLayout(schema, profile);
    outputRows.push([short, `v${version}`, o.noWrapText, o.wrapText, o.forcedFullWidth, o.flexWrapRows, o.noWrapRows, o.rowChildBasis,
      o.fixedWidthChildren, o.selfAlignments, o.spacingMargins, plan.stats.gaps, plan.stats.paddings, plan.stats.justifyOverrides,
      plan.free.flexInferred, plan.free.trackGrids, plan.free.positioned, o.fontsWithoutGeneric, o.placeholderLabels].map(String));
  }
}

console.log("INPUT (UISchema)");
table(["fixture", "nodes", "depth", "noLayout", "rows", "textRisk", "placeholders", "conf", "warn", "bytes", "files"], inputRows);
console.log("\nOUTPUT (what each generator version emitted for the same schema)");
table(["fixture", "gen", "noWrapText", "wrapText", "wFull", "wrapRows", "oneLineRows", "rowBasis", "fixedW", "selfAlign", "margins",
  "infGap", "infPad", "justifyFix", "flexInf", "trackGrids", "positioned", "noGeneric", "labels"], outputRows);

const modeOrder = ["fast", "balanced", "precise"];
if (byMode.size > 0) {
  // Mean over repeated runs, with the range when there is more than one: the model is not deterministic.
  const cell = (values: number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const text = Number.isInteger(mean) ? String(mean) : mean.toFixed(1);
    return values.length > 1 ? `${text} (${Math.min(...values)}-${Math.max(...values)})` : text;
  };
  const rows = [...byMode.entries()]
    .sort(([a], [b]) => {
      const [siteA, modeA] = a.split("|");
      const [siteB, modeB] = b.split("|");
      return siteA!.localeCompare(siteB!) || modeOrder.indexOf(modeA!) - modeOrder.indexOf(modeB!);
    })
    .map(([key, samples]) => {
      const [site, mode] = key.split("|");
      const pick = (field: keyof ModeSample) => cell(samples.map((sample) => sample[field]));
      return [site!, mode!, String(samples.length), pick("nodes"), pick("textRisk"), pick("noLayout"), pick("rows"), pick("placeholders"), pick("warnings")];
    });
  console.log("\nBY MODE (prompt v1.1 fixtures <site>.<mode>.p11[.rN].v1.json; mean over runs, range in parentheses)");
  table(["site", "mode", "runs", "nodes", "textRisk", "noLayout", "rows", "placeholders", "warn"], rows);
} else {
  console.log("\nBY MODE: no prompt v1.1 fixtures yet (name them <site>.<mode>.p11.v1.json; see the fixtures README).");
}
console.log(`\n${names.length} fixture(s), ${invalid} invalid.
Input: noLayout = containers with 2+ children and layout NONE; rows = row candidates; textRisk = single-line text estimated wider than its bounds.
Output: noWrapText = text that never wraps; wFull = children forced to full width (root excluded); wrapRows/oneLineRows = rows allowed to wrap / kept on one line;
rowBasis = row children keeping their own width; fixedW = column children keeping their width; selfAlign / margins = per-child alignment and residual spacing;
infGap / infPad = container gap and padding inferred; justifyFix = declared justify replaced because bounds contradict it;
flexInf = NONE containers rendered as an inferred flex row/column; trackGrids = containers rendered on explicit grid tracks;
positioned = containers that fell back to positioning by bounds (last resort);
noGeneric = text whose font-family names no generic family (falls back to the browser's default serif); labels = placeholders showing their dashed label.`);
process.exit(invalid > 0 ? 1 : 0);
