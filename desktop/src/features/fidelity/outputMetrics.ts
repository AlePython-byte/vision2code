import type { GeneratedProject } from "../generation/generatedProject.ts";

/**
 * Measurements of what a generator actually emitted (as opposed to schemaMetrics, which measures the
 * input). Used by `npm run report:fidelity` and the tests to compare generator versions on the same
 * UISchema. Pure: it only reads the emitted class lists.
 */
export interface OutputMetrics {
  /** Elements whose text never wraps (`whitespace-pre`). */
  readonly noWrapText: number;
  /** Elements whose text wraps (`whitespace-pre-wrap`). */
  readonly wrapText: number;
  /** Elements forced to the parent's full width (`w-full`), excluding the root. */
  readonly forcedFullWidth: number;
  /** Rows allowed to wrap / rows kept on one line. */
  readonly flexWrapRows: number;
  readonly noWrapRows: number;
  /** Row children that keep their own width (`flex: 0 1 <width>`). */
  readonly rowChildBasis: number;
  /** Per-child cross-axis alignment overrides (`self-*`). */
  readonly selfAlignments: number;
  /** Residual spacing margins (`margin-top` / `margin-left`). */
  readonly spacingMargins: number;
  /** Column children that keep a fixed width instead of `w-full`. */
  readonly fixedWidthChildren: number;
}

const classLists = (source: string): string[][] =>
  [...source.matchAll(/className=\{("(?:[^"\\]|\\.)*")\}/g)].map((match) => (JSON.parse(match[1]!) as string).split(" "));

export function computeOutputMetrics(project: GeneratedProject): OutputMetrics {
  const source = project.files.find((file) => file.path.endsWith("GeneratedInterface.tsx"))?.content ?? "";
  const lists = classLists(source);
  const count = (predicate: (tokens: string[]) => boolean) => lists.filter(predicate).length;
  return Object.freeze({
    noWrapText: count((tokens) => tokens.includes("whitespace-pre")),
    wrapText: count((tokens) => tokens.includes("whitespace-pre-wrap")),
    // The first list is the root, which is always `w-full` by design; it is not a forced child.
    forcedFullWidth: lists.slice(1).filter((tokens) => tokens.includes("w-full")).length,
    flexWrapRows: count((tokens) => tokens.includes("flex-wrap")),
    noWrapRows: count((tokens) => tokens.includes("flex-nowrap")),
    rowChildBasis: count((tokens) => tokens.some((token) => token.startsWith("[flex:0_1_"))),
    selfAlignments: count((tokens) => tokens.some((token) => token === "self-start" || token === "self-center" || token === "self-end")),
    spacingMargins: count((tokens) => tokens.some((token) => token.startsWith("[margin-top:") || token.startsWith("[margin-left:"))),
    fixedWidthChildren: count((tokens) => tokens.includes("[max-width:100%]")),
  });
}
