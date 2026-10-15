import type { UINode, UISchema } from "@vision2code/contracts";

/**
 * Deterministic measurements of a UISchema, used by the development-only schema inspector and by
 * `npm run report:fidelity` to see *why* a result comes out flat. Pure: no AI, generator, auth,
 * toast, clock or randomness; the same schema always yields the same numbers.
 */

export type NodeType = UINode["type"];
export type LayoutMode = UINode["layout"]["mode"];
export type LayoutDirection = UINode["layout"]["direction"];

export const NODE_TYPES = ["FRAME", "TEXT", "IMAGE", "ICON", "BUTTON", "INPUT", "DIVIDER"] as const satisfies readonly NodeType[];
export const LAYOUT_MODES = ["NONE", "FLEX", "GRID", "ABSOLUTE"] as const satisfies readonly LayoutMode[];
export const LAYOUT_DIRECTIONS = ["NONE", "ROW", "COLUMN"] as const satisfies readonly LayoutDirection[];

/** Average glyph width as a fraction of the font size; a rough, documented approximation. */
export const TEXT_WIDTH_FACTOR = 0.55;
/** Font size assumed when the schema has none (the browser default). */
export const DEFAULT_FONT_SIZE = 16;
/** Line height assumed, as a multiple of the font size, when the schema has none. */
export const DEFAULT_LINE_HEIGHT_FACTOR = 1.2;
/** A text box up to this many line heights tall is treated as a single line. */
export const SINGLE_LINE_MAX_LINES = 1.5;
/** Fraction of the smaller height that two siblings must share vertically to sit in the same row. */
export const ROW_VERTICAL_OVERLAP = 0.5;
/** Horizontal overlap (in px) tolerated between neighbours, to absorb rounding in bounds. */
export const ROW_HORIZONTAL_TOLERANCE_PX = 1;

export interface SchemaMetrics {
  readonly nodeCount: number;
  /** The root counts as depth 1; a lone root has maxDepth 1. */
  readonly maxDepth: number;
  readonly nodesByType: Readonly<Record<NodeType, number>>;
  /** Nodes with at least one child. */
  readonly containerCount: number;
  readonly containersByMode: Readonly<Record<LayoutMode, number>>;
  readonly containersByDirection: Readonly<Record<LayoutDirection, number>>;
  /** Containers with 2+ children whose layout.mode is NONE: the generator has no flow to apply. */
  readonly containersWithoutLayout: number;
  /** Containers with 2+ children, not declared FLEX/ROW, whose children are laid out in a row by bounds. */
  readonly rowCandidates: number;
  /** Nodes that carry a text object (TEXT, and BUTTON/INPUT with text). */
  readonly textNodes: number;
  /** Text nodes that look like one line (see isSingleLineText). */
  readonly singleLineTextNodes: number;
  /** Single-line text whose estimated width exceeds its own bounds.width. */
  readonly textClampRisk: number;
  /** IMAGE and ICON nodes: the generator can only draw placeholders for them. */
  readonly placeholderCount: number;
  readonly confidence: number;
  readonly warningCount: number;
  /** Size of the compact JSON serialization, in UTF-8 bytes. */
  readonly jsonBytes: number;
}

function countBy<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

/**
 * Row criterion (rowCandidates). A container qualifies when:
 *   1. it has two or more children, and
 *   2. its own layout is NOT { mode: FLEX, direction: ROW }, and
 *   3. sorting the children by bounds.x (ties by bounds.y), EVERY pair of neighbours satisfies:
 *      a. no horizontal overlap: min(right edges) - max(left edges) <= ROW_HORIZONTAL_TOLERANCE_PX (1 px), and
 *      b. vertical alignment: the vertical overlap, min(bottoms) - max(tops), is at least
 *         ROW_VERTICAL_OVERLAP (50%) of the smaller of the two heights, and the smaller height is > 0.
 * (b) is the operational form of "same vertical centre": two boxes that overlap by half of the
 * shorter one sit on the same horizontal band. Bounds are the model's own estimate, not pixels.
 */
export function childrenFormRow(children: readonly UINode[]): boolean {
  if (children.length < 2) return false;
  const sorted = [...children].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  for (let index = 1; index < sorted.length; index++) {
    const left = sorted[index - 1]!.bounds;
    const right = sorted[index]!.bounds;
    const horizontalOverlap = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
    if (horizontalOverlap > ROW_HORIZONTAL_TOLERANCE_PX) return false;
    const smaller = Math.min(left.height, right.height);
    if (smaller <= 0) return false;
    const verticalOverlap = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
    if (verticalOverlap < smaller * ROW_VERTICAL_OVERLAP) return false;
  }
  return true;
}

/**
 * Single-line text: the content has no line break and the box is at most 1.5 line heights tall,
 * where the line height is text.lineHeight (px) or, when absent, 1.2 x the font size.
 */
export function isSingleLineText(node: UINode): boolean {
  const text = node.text;
  if (text === null || /[\r\n]/.test(text.content)) return false;
  const fontSize = text.fontSize ?? DEFAULT_FONT_SIZE;
  const lineHeight = text.lineHeight ?? fontSize * DEFAULT_LINE_HEIGHT_FACTOR;
  return node.bounds.height <= lineHeight * SINGLE_LINE_MAX_LINES;
}

/**
 * Estimated rendered width of the text on one line:
 * characters (code points) x fontSize x 0.55, rounded to 2 decimals so float noise never decides
 * a comparison. An approximation, not a font measurement.
 */
export function estimateTextWidth(node: UINode): number {
  const text = node.text;
  if (text === null) return 0;
  const width = [...text.content].length * (text.fontSize ?? DEFAULT_FONT_SIZE) * TEXT_WIDTH_FACTOR;
  return Math.round(width * 100) / 100;
}

export function computeSchemaMetrics(schema: UISchema): SchemaMetrics {
  const nodesByType = countBy(NODE_TYPES);
  const containersByMode = countBy(LAYOUT_MODES);
  const containersByDirection = countBy(LAYOUT_DIRECTIONS);
  let nodeCount = 0;
  let maxDepth = 0;
  let containerCount = 0;
  let containersWithoutLayout = 0;
  let rowCandidates = 0;
  let textNodes = 0;
  let singleLineTextNodes = 0;
  let textClampRisk = 0;
  let placeholderCount = 0;

  // Iterative walk: a schema is untrusted depth-wise and recursion could overflow on a deep chain.
  const stack: { node: UINode; depth: number }[] = [{ node: schema.root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    nodeCount++;
    if (depth > maxDepth) maxDepth = depth;
    nodesByType[node.type]++;
    if (node.type === "IMAGE" || node.type === "ICON") placeholderCount++;
    if (node.text !== null) {
      textNodes++;
      if (isSingleLineText(node)) {
        singleLineTextNodes++;
        if (estimateTextWidth(node) > node.bounds.width) textClampRisk++;
      }
    }
    if (node.children.length > 0) {
      containerCount++;
      containersByMode[node.layout.mode]++;
      containersByDirection[node.layout.direction]++;
      if (node.children.length >= 2) {
        if (node.layout.mode === "NONE") containersWithoutLayout++;
        const declaredRow = node.layout.mode === "FLEX" && node.layout.direction === "ROW";
        if (!declaredRow && childrenFormRow(node.children)) rowCandidates++;
      }
      for (const child of node.children) stack.push({ node: child, depth: depth + 1 });
    }
  }

  return Object.freeze({
    nodeCount,
    maxDepth,
    nodesByType: Object.freeze(nodesByType),
    containerCount,
    containersByMode: Object.freeze(containersByMode),
    containersByDirection: Object.freeze(containersByDirection),
    containersWithoutLayout,
    rowCandidates,
    textNodes,
    singleLineTextNodes,
    textClampRisk,
    placeholderCount,
    confidence: schema.confidence,
    warningCount: schema.warnings.length,
    jsonBytes: new TextEncoder().encode(JSON.stringify(schema)).length,
  });
}

/** Label/value rows in a stable order, shared by the inspector table and the CLI report. */
export function metricRows(metrics: SchemaMetrics): readonly (readonly [string, string])[] {
  const counts = <T extends string>(record: Readonly<Record<T, number>>) =>
    (Object.entries(record) as [T, number][]).map(([key, value]) => `${key} ${value}`).join(" · ");
  return [
    ["Nodes", String(metrics.nodeCount)],
    ["Max depth", String(metrics.maxDepth)],
    ["Nodes by type", counts(metrics.nodesByType)],
    ["Containers (with children)", String(metrics.containerCount)],
    ["Containers by layout mode", counts(metrics.containersByMode)],
    ["Containers by direction", counts(metrics.containersByDirection)],
    ["Containers without layout (2+ children, NONE)", String(metrics.containersWithoutLayout)],
    ["Row candidates (row by bounds, not FLEX/ROW)", String(metrics.rowCandidates)],
    ["Text nodes", String(metrics.textNodes)],
    ["Single-line text nodes", String(metrics.singleLineTextNodes)],
    ["Text clamp risk (estimated width > bounds)", String(metrics.textClampRisk)],
    ["Placeholders (IMAGE + ICON)", String(metrics.placeholderCount)],
    ["Confidence", metrics.confidence.toFixed(2)],
    ["Warnings", String(metrics.warningCount)],
    ["JSON size (bytes)", String(metrics.jsonBytes)],
  ];
}
