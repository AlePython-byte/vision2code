import type { UINode, UISchema } from "@vision2code/contracts";

/**
 * Layout inference: what the UISchema bounds say about spacing, alignment and structure when the
 * declared layout does not already say it. Pure and deterministic (no I/O, clock or randomness).
 *
 * The rule is "infer only when unambiguous". A container is inferred as a whole or not at all: if
 * its children are not a clean single flow (out of order, overlapping, or leaving the container)
 * nothing is inferred for it and the generator keeps the declared layout. Every comparison uses a
 * small tolerance (INFERENCE_TOLERANCE_PX); anything within it is treated as equal.
 *
 * Two profiles: "v3" is frozen (generator v3 must keep emitting the same bytes); "v4" also checks
 * that a declared GRID whose column count matches the children can really be reproduced by CSS
 * auto-placement (one child per cell, in source order), and builds explicit tracks when it cannot.
 * Both handle NONE and GRID containers and let the bounds override a declared padding they
 * contradict (the former "v2" profile did neither; it left with generator v2).
 */

export const INFERENCE_TOLERANCE_PX = 2;
/** Fraction of the smaller height that row neighbours must share vertically (same as the metrics). */
const ROW_VERTICAL_OVERLAP = 0.5;
/** More tracks than this is not "a grid" any more: fall back instead of emitting a huge template. */
export const MAX_TRACKS = 12;

export type LayoutProfile = "v3" | "v4";
export type SelfAlignment = "START" | "CENTER" | "END";

export interface Spacing {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** A child's position in a track grid: 1-based grid lines, end exclusive (`grid-column: start / end`). */
export interface GridCell {
  readonly columnStart: number;
  readonly columnEnd: number;
  readonly rowStart: number;
  readonly rowEnd: number;
}

/** How one child sits inside a planned container. */
export interface ChildLayout {
  /**
   * Column children: FILL spans the content box (`w-full`); FIXED keeps its own width.
   * Row children: always FIXED (own width as flex basis).
   */
  readonly width: "FILL" | "FIXED";
  /** Cross-axis alignment that differs from what the container declares; null keeps the container's. */
  readonly alignSelf: SelfAlignment | null;
  /** Residual main-axis spacing (px) between the declared/inferred gap and the measured one. */
  readonly marginTop: number;
  readonly marginLeft: number;
  /** Set when the container is a track grid: where this child goes. */
  readonly cell: GridCell | null;
}

export interface Tracks {
  /** Track sizes in px (spacer tracks included), from the left of the content box. */
  readonly columns: readonly number[];
  readonly rows: readonly number[];
}

export interface ContainerLayout {
  readonly axis: "ROW" | "COLUMN";
  /** Replaces the declared padding (when none was declared or the bounds contradict it). */
  readonly padding: Spacing | null;
  /** Gap inferred from regular spacing; only when the schema declares none. */
  readonly gap: number | null;
  /** A row whose children fit one line by bounds does not wrap. */
  readonly singleLine: boolean;
  /**
   * Set to START when the declared justify (CENTER, END, SPACE_BETWEEN) is contradicted by the
   * bounds, so the declared distribution could not reproduce the measured positions.
   */
  readonly justify: "START" | null;
  /** A NONE container whose children form a clean row or column is rendered as that flex flow. */
  readonly inferredFlex: "ROW" | "COLUMN" | null;
  /** Explicit grid tracks derived from the children's edges (NONE without a flow, GRID). */
  readonly tracks: Tracks | null;
  /** Last resort: children are positioned by their bounds inside this container. */
  readonly positioned: boolean;
}

export interface InferenceStats {
  /** FLEX containers with at least one child. */
  readonly flexContainers: number;
  /** FLEX containers inferred as a whole. */
  readonly plannedContainers: number;
  readonly gaps: number;
  readonly paddings: number;
  /** Children given a residual main-axis margin. */
  readonly margins: number;
  /** Children given a cross-axis alignment or offset. */
  readonly alignments: number;
  /** Containers whose declared justify was replaced because the bounds contradict it. */
  readonly justifyOverrides: number;
  /** Column children that keep their own width instead of `w-full`. */
  readonly fixedWidths: number;
}

/** What was done to NONE and GRID containers and to FLEX containers whose children are not a flow. */
export interface FreeLayoutStats {
  /** NONE or GRID containers with 2+ children that were examined. */
  readonly examined: number;
  /** NONE containers rendered as an inferred flex row or column. */
  readonly flexInferred: number;
  /** Containers rendered as an explicit track grid. */
  readonly trackGrids: number;
  /** Containers that fell back to positioning by bounds (last resort). */
  readonly positioned: number;
  /** Declared FLEX containers whose children do not form a flow, rendered as a track grid instead. */
  readonly flexOverrides: number;
  /** Declared paddings replaced because the children sit outside the declared content box. */
  readonly paddingOverrides: number;
  /** Declared GRID column counts replaced because the bounds show another structure. */
  readonly columnOverrides: number;
}

export interface LayoutPlan {
  container(node: UINode): ContainerLayout | null;
  child(node: UINode): ChildLayout | null;
  readonly stats: InferenceStats;
  readonly free: FreeLayoutStats;
}

const near = (a: number, b: number) => Math.abs(a - b) <= INFERENCE_TOLERANCE_PX;
const snap = (value: number) => (value > INFERENCE_TOLERANCE_PX ? Math.round(value) : 0);

function isCleanFlow(kids: readonly UINode[], row: boolean): boolean {
  for (let index = 1; index < kids.length; index++) {
    const previous = kids[index - 1]!.bounds;
    const current = kids[index]!.bounds;
    const gap = row ? current.x - (previous.x + previous.width) : current.y - (previous.y + previous.height);
    if (gap < -INFERENCE_TOLERANCE_PX) return false;
    if (row) {
      const smaller = Math.min(previous.height, current.height);
      const overlap = Math.min(previous.y + previous.height, current.y + current.height) - Math.max(previous.y, current.y);
      if (smaller <= 0 || overlap < smaller * ROW_VERTICAL_OVERLAP) return false;
    }
  }
  return true;
}

function within(kids: readonly UINode[], box: UINode["bounds"]): boolean {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  return kids.every(({ bounds: b }) => b.x >= box.x - INFERENCE_TOLERANCE_PX && b.y >= box.y - INFERENCE_TOLERANCE_PX &&
    b.x + b.width <= right + INFERENCE_TOLERANCE_PX && b.y + b.height <= bottom + INFERENCE_TOLERANCE_PX);
}

interface Counters {
  flex: Record<keyof InferenceStats, number>;
  free: Record<keyof FreeLayoutStats, number>;
}

/** Plans one FLEX container (declared, or a NONE container inferred as a flex flow). */
function planFlex(
  node: UINode, layout: UINode["layout"], inferredFlex: "ROW" | "COLUMN" | null,
  containers: Map<UINode, ContainerLayout>, children: Map<UINode, ChildLayout>, counters: Counters,
): boolean {
  const { bounds: box, children: kids } = node;
  const row = layout.direction === "ROW";
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const first = kids[0]!.bounds;
  const last = kids[kids.length - 1]!.bounds;
  const mainStartOf = (b: UINode["bounds"]) => (row ? b.x : b.y);
  const mainSizeOf = (b: UINode["bounds"]) => (row ? b.width : b.height);

  // Declared justify vs bounds. A distribution the bounds contradict cannot reproduce the design,
  // so it is replaced by START plus residual spacing; anything consistent is kept as declared.
  const declaredPad = layout.padding;
  const mainStartPad = row ? declaredPad.left : declaredPad.top;
  const mainEndPad = row ? declaredPad.right : declaredPad.bottom;
  const containerMainStart = mainStartOf(box) + mainStartPad;
  const containerMainEnd = mainStartOf(box) + mainSizeOf(box) - mainEndPad;
  const lead = mainStartOf(first) - containerMainStart;
  const trail = containerMainEnd - (mainStartOf(last) + mainSizeOf(last));
  const measuredGaps = kids.slice(1).map((kid, index) => {
    const previous = kids[index]!.bounds;
    return Math.max(0, mainStartOf(kid.bounds) - (mainStartOf(previous) + mainSizeOf(previous)));
  });
  const unevenGaps = measuredGaps.length > 1 && Math.max(...measuredGaps) - Math.min(...measuredGaps) > INFERENCE_TOLERANCE_PX;
  const contradicted =
    (layout.justify === "CENTER" && Math.abs(lead - trail) > INFERENCE_TOLERANCE_PX) ||
    (layout.justify === "END" && trail > INFERENCE_TOLERANCE_PX) ||
    (layout.justify === "SPACE_BETWEEN" && (lead > INFERENCE_TOLERANCE_PX || trail > INFERENCE_TOLERANCE_PX || unevenGaps));
  const justifyStart = layout.justify === "START" || contradicted;

  // Padding: when none is declared, or when the children sit outside the declared content box,
  // which the declared padding cannot reproduce. Main-axis start padding needs justify START
  // (otherwise the free space is distributed by justify and the first child's offset says nothing).
  const declared = layout.padding;
  const declaredZero = declared.top === 0 && declared.right === 0 && declared.bottom === 0 && declared.left === 0;
  const outsideDeclaredContent = !declaredZero && !within(kids, {
    x: box.x + declared.left, y: box.y + declared.top,
    width: box.width - declared.left - declared.right, height: box.height - declared.top - declared.bottom,
  });
  let padding: Spacing = declared;
  let paddingInferred = false;
  let paddingOverridden = false;
  if (declaredZero || outsideDeclaredContent) {
    const minOffset = (pick: (b: UINode["bounds"]) => number) => Math.min(...kids.map((kid) => pick(kid.bounds)));
    const measured: Spacing = row
      ? { left: justifyStart ? snap(first.x - box.x) : 0, right: 0,
        top: snap(minOffset((b) => b.y - box.y)), bottom: snap(minOffset((b) => bottom - (b.y + b.height))) }
      : { top: justifyStart ? snap(first.y - box.y) : 0, bottom: 0,
        left: snap(minOffset((b) => b.x - box.x)), right: snap(minOffset((b) => right - (b.x + b.width))) };
    if (measured.top > 0 || measured.right > 0 || measured.bottom > 0 || measured.left > 0) {
      padding = measured;
      paddingInferred = true;
      paddingOverridden = !declaredZero;
    }
  }
  const contentLeft = box.x + padding.left;
  const contentTop = box.y + padding.top;
  const contentWidth = box.width - padding.left - padding.right;
  const contentHeight = box.height - padding.top - padding.bottom;

  // A row that does not fit one line by its own bounds is not "a single row": leave wrapping alone.
  const spanned = row ? last.x + last.width - first.x : 0;
  const singleLine = row && kids.length >= 2 && spanned <= contentWidth + INFERENCE_TOLERANCE_PX;

  // Gap: only when none is declared and the measured gaps agree with each other. With a consistent
  // SPACE_BETWEEN the free space is distributed by justify; a `gap` would be a rigid minimum equal to
  // that free space and would force overflow in a narrower viewport.
  const spaceIsDistributed = layout.justify === "SPACE_BETWEEN" && !contradicted;
  let inferredGap: number | null = null;
  if (layout.gap === null && measuredGaps.length > 0 && !spaceIsDistributed) {
    const low = Math.min(...measuredGaps);
    const high = Math.max(...measuredGaps);
    if (high - low <= INFERENCE_TOLERANCE_PX) {
      const mean = measuredGaps.reduce((sum, value) => sum + value, 0) / measuredGaps.length;
      if (mean > INFERENCE_TOLERANCE_PX) inferredGap = Math.round(mean);
    }
  }
  const effectiveGap = layout.gap ?? inferredGap ?? 0;

  // Per-child plan: residual spacing on the main axis, position on the cross axis.
  // STRETCH only matters across a row: a fixed-width column child is never stretched, so it counts as START.
  const declaredAlign: SelfAlignment | null = layout.align === "STRETCH" ? (row ? null : "START") : (layout.align as SelfAlignment);
  let cursor = row ? contentLeft : contentTop;
  let marginCount = 0;
  let alignmentCount = 0;
  let fixedCount = 0;
  const planned: [UINode, ChildLayout][] = [];
  kids.forEach((kid, index) => {
    const b = kid.bounds;
    let marginMain = 0;
    if (justifyStart) {
      const expected = index === 0 ? cursor : cursor + effectiveGap;
      const residual = mainStartOf(b) - expected;
      if (Math.abs(residual) > INFERENCE_TOLERANCE_PX) marginMain = Math.round(residual);
    }
    cursor = mainStartOf(b) + mainSizeOf(b);

    let width: ChildLayout["width"] = "FIXED";
    let alignSelf: SelfAlignment | null = null;
    let marginCross = 0;
    if (row) {
      const top = b.y - contentTop;
      const below = contentTop + contentHeight - (b.y + b.height);
      if (b.height < contentHeight - INFERENCE_TOLERANCE_PX) {
        // Only exact START / CENTER / END are inferred across a row. A vertical offset that is none of
        // them would need a margin, and a margin grows the row when the child renders taller than its
        // bounds (placeholders do), so that case is left to the declared alignment.
        let place: SelfAlignment | null = null;
        if (top <= INFERENCE_TOLERANCE_PX) place = "START";
        else if (near(top, below)) place = "CENTER";
        else if (below <= INFERENCE_TOLERANCE_PX) place = "END";
        if (place !== null && place !== declaredAlign) alignSelf = place;
      }
    } else {
      const left = b.x - contentLeft;
      const rightSpace = contentLeft + contentWidth - (b.x + b.width);
      if (b.width >= contentWidth - INFERENCE_TOLERANCE_PX) {
        width = "FILL";
      } else {
        let place: SelfAlignment = "START";
        if (near(left, rightSpace) && left > INFERENCE_TOLERANCE_PX) place = "CENTER";
        else if (rightSpace <= INFERENCE_TOLERANCE_PX && left > INFERENCE_TOLERANCE_PX) place = "END";
        else if (left > INFERENCE_TOLERANCE_PX) marginCross = Math.round(left);
        if (place !== declaredAlign) alignSelf = place;
        fixedCount++;
      }
    }
    if (marginMain !== 0) marginCount++;
    if (alignSelf !== null || marginCross !== 0) alignmentCount++;
    planned.push([kid, {
      width, alignSelf,
      marginTop: row ? marginCross : marginMain,
      marginLeft: row ? marginMain : marginCross,
      cell: null,
    }]);
  });

  const justifyOverride = contradicted && layout.justify !== "START";
  containers.set(node, {
    axis: row ? "ROW" : "COLUMN", padding: paddingInferred ? padding : null, gap: inferredGap, singleLine,
    justify: justifyOverride ? "START" : null, inferredFlex, tracks: null, positioned: false,
  });
  for (const [kid, value] of planned) children.set(kid, value);
  const flex = counters.flex;
  flex.plannedContainers!++;
  if (inferredGap !== null) flex.gaps!++;
  if (paddingInferred) flex.paddings!++;
  if (paddingOverridden) counters.free.paddingOverrides!++;
  if (justifyOverride) flex.justifyOverrides!++;
  flex.margins! += marginCount;
  flex.alignments! += alignmentCount;
  flex.fixedWidths! += fixedCount;
  return true;
}

// ---- Tracks ---------------------------------------------------------------------------------

function clusterEdges(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const edges: number[] = [];
  let group: number[] = [];
  const flush = () => { if (group.length > 0) edges.push(Math.round(group.reduce((sum, value) => sum + value, 0) / group.length)); };
  for (const value of sorted) {
    if (group.length > 0 && value - group[group.length - 1]! > INFERENCE_TOLERANCE_PX) { flush(); group = []; }
    group.push(value);
  }
  flush();
  return edges;
}

const nearestEdge = (edges: readonly number[], value: number) =>
  edges.reduce((best, edge, index) => (Math.abs(edge - value) < Math.abs(edges[best]! - value) ? index : best), 0);

/**
 * Explicit grid tracks from the children's edges. Unambiguous only when every child fits the content
 * box, no two children share a grid cell, no child is degenerate, and there are at most MAX_TRACKS
 * columns and rows. Spacer tracks keep the empty bands between children, so no `gap` is needed.
 */
function inferTracks(node: UINode, padding: Spacing): { tracks: Tracks; cells: Map<UINode, GridCell> } | null {
  const { bounds: box, children: kids } = node;
  const left = box.x + padding.left;
  const right = box.x + box.width - padding.right;
  const top = box.y + padding.top;
  for (const { bounds: b } of kids) {
    if (b.width <= INFERENCE_TOLERANCE_PX || b.height <= INFERENCE_TOLERANCE_PX) return null;
    if (b.x < left - INFERENCE_TOLERANCE_PX || b.x + b.width > right + INFERENCE_TOLERANCE_PX || b.y < top - INFERENCE_TOLERANCE_PX) return null;
  }
  const xEdges = clusterEdges([left, right, ...kids.flatMap(({ bounds: b }) => [b.x, b.x + b.width])]);
  const yEdges = clusterEdges([top, ...kids.flatMap(({ bounds: b }) => [b.y, b.y + b.height])]);
  if (xEdges.length - 1 > MAX_TRACKS || yEdges.length - 1 > MAX_TRACKS || xEdges.length < 2 || yEdges.length < 2) return null;
  const cells = new Map<UINode, GridCell>();
  for (const kid of kids) {
    const b = kid.bounds;
    const columnStart = nearestEdge(xEdges, b.x);
    const columnEnd = nearestEdge(xEdges, b.x + b.width);
    const rowStart = nearestEdge(yEdges, b.y);
    const rowEnd = nearestEdge(yEdges, b.y + b.height);
    if (columnEnd <= columnStart || rowEnd <= rowStart) return null;
    cells.set(kid, { columnStart: columnStart + 1, columnEnd: columnEnd + 1, rowStart: rowStart + 1, rowEnd: rowEnd + 1 });
  }
  const placed = [...cells.values()];
  for (let a = 0; a < placed.length; a++) {
    for (let b = a + 1; b < placed.length; b++) {
      const p = placed[a]!;
      const q = placed[b]!;
      if (p.columnStart < q.columnEnd && q.columnStart < p.columnEnd && p.rowStart < q.rowEnd && q.rowStart < p.rowEnd) return null;
    }
  }
  const sizes = (edges: readonly number[]) => edges.slice(1).map((edge, index) => edge - edges[index]!);
  return { tracks: { columns: sizes(xEdges), rows: sizes(yEdges) }, cells };
}

function startClusters(kids: readonly UINode[]): number {
  return clusterEdges(kids.map(({ bounds }) => bounds.x)).length;
}

/**
 * v4: whether CSS auto-placement of a declared `columns`-column grid puts every child where its
 * bounds are: child i in column i % columns and row floor(i / columns) (by the clustered start
 * edges), and no child reaching into the next column or row (auto-placement never spans). A child
 * that spans two rows or columns, or children out of source order, fail it.
 */
function autoPlacementMatches(kids: readonly UINode[], columns: number): boolean {
  const xStarts = clusterEdges(kids.map(({ bounds }) => bounds.x));
  const yStarts = clusterEdges(kids.map(({ bounds }) => bounds.y));
  return kids.every(({ bounds: b }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    if (nearestEdge(xStarts, b.x) !== column || nearestEdge(yStarts, b.y) !== row) return false;
    const nextX = xStarts[column + 1];
    const nextY = yStarts[row + 1];
    return (nextX === undefined || b.x + b.width <= nextX + INFERENCE_TOLERANCE_PX) &&
      (nextY === undefined || b.y + b.height <= nextY + INFERENCE_TOLERANCE_PX);
  });
}

/** NONE and GRID containers with 2+ children. */
function planFree(
  node: UINode, profile: LayoutProfile, containers: Map<UINode, ContainerLayout>, children: Map<UINode, ChildLayout>, counters: Counters,
): void {
  const { layout, children: kids, bounds: box } = node;
  if (kids.length < 2 || node.text !== null || box.width <= 0 || box.height <= 0) return;
  const grid = layout.mode === "GRID";
  if (!grid && layout.mode !== "NONE") return;
  counters.free.examined!++;
  const asContainer = (extra: Partial<ContainerLayout>): ContainerLayout => ({
    axis: "COLUMN", padding: null, gap: null, singleLine: false, justify: null, inferredFlex: null, tracks: null, positioned: false, ...extra,
  });

  const cleanColumn = isCleanFlow(kids, false);
  const cleanRow = isCleanFlow(kids, true);
  const inside = within(kids, box);

  if (grid) {
    // A declared grid whose columns match the children, or a single stacked column, is already right
    // (v4: only when auto-placement really puts each child in its own cell).
    if (layout.columns !== null && startClusters(kids) === layout.columns &&
      (profile === "v3" || autoPlacementMatches(kids, layout.columns))) return;
    if (layout.columns === null && cleanColumn && inside) return;
    const found = inferTracks(node, layout.padding);
    if (found === null) return;
    containers.set(node, asContainer({ tracks: found.tracks }));
    for (const kid of kids) {
      children.set(kid, { width: "FILL", alignSelf: null, marginTop: 0, marginLeft: 0, cell: found.cells.get(kid)! });
    }
    counters.free.trackGrids!++;
    if (layout.columns !== null) counters.free.columnOverrides!++;
    return;
  }

  // NONE: a clean row or column is the same thing as a flex flow.
  if (inside && (cleanColumn || cleanRow)) {
    const direction = cleanRow && !cleanColumn ? "ROW" : "COLUMN";
    const synthetic: UINode["layout"] = { ...layout, mode: "FLEX", direction, justify: "START", align: "START", gap: null };
    planFlex(node, synthetic, direction, containers, children, counters);
    counters.free.flexInferred!++;
    return;
  }
  // Otherwise try explicit tracks, and only then position by bounds.
  const found = inferTracks(node, layout.padding);
  if (found !== null) {
    containers.set(node, asContainer({ tracks: found.tracks }));
    for (const kid of kids) {
      children.set(kid, { width: "FILL", alignSelf: null, marginTop: 0, marginLeft: 0, cell: found.cells.get(kid)! });
    }
    counters.free.trackGrids!++;
    return;
  }
  containers.set(node, asContainer({ positioned: true }));
  counters.free.positioned!++;
}

function planContainer(
  node: UINode, profile: LayoutProfile,
  containers: Map<UINode, ContainerLayout>, children: Map<UINode, ChildLayout>, counters: Counters,
) {
  const { layout, bounds: box, children: kids } = node;
  if (kids.length === 0 || box.width <= 0 || box.height <= 0) {
    if (layout.mode === "FLEX" && kids.length > 0) counters.flex.flexContainers!++;
    return;
  }
  if (layout.mode === "FLEX") {
    counters.flex.flexContainers!++;
    // A container that carries its own text is not a pure layout box: the text takes space the bounds
    // attribute to the container, so spacing measured against its children would count it twice.
    if (node.text !== null) return;
    // A child that leaves the container, or children that do not form a flow, are a doubt about what
    // the container is. Explicit tracks reproduce a two-band layout (a column whose last band is a
    // row) exactly; otherwise the declared layout is kept.
    if (!isCleanFlow(kids, layout.direction === "ROW") || !within(kids, box)) {
      if (kids.length >= 2) {
        const found = inferTracks(node, layout.padding);
        if (found !== null) {
          containers.set(node, {
            axis: layout.direction === "ROW" ? "ROW" : "COLUMN", padding: null, gap: null, singleLine: false, justify: null,
            inferredFlex: null, tracks: found.tracks, positioned: false,
          });
          for (const kid of kids) {
            children.set(kid, { width: "FILL", alignSelf: null, marginTop: 0, marginLeft: 0, cell: found.cells.get(kid)! });
          }
          counters.free.examined!++;
          counters.free.trackGrids!++;
          counters.free.flexOverrides!++;
        }
      }
      return;
    }
    planFlex(node, layout, null, containers, children, counters);
    return;
  }
  planFree(node, profile, containers, children, counters);
}

export function planLayout(schema: UISchema, profile: LayoutProfile): LayoutPlan {
  const containers = new Map<UINode, ContainerLayout>();
  const children = new Map<UINode, ChildLayout>();
  const counters: Counters = {
    flex: { flexContainers: 0, plannedContainers: 0, gaps: 0, paddings: 0, margins: 0, alignments: 0, justifyOverrides: 0, fixedWidths: 0 },
    free: { examined: 0, flexInferred: 0, trackGrids: 0, positioned: 0, flexOverrides: 0, paddingOverrides: 0, columnOverrides: 0 },
  };
  // Iterative walk: schema depth is untrusted, so recursion could overflow on a long chain.
  const stack: UINode[] = [schema.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    planContainer(node, profile, containers, children, counters);
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]!);
  }
  return {
    container: (node) => containers.get(node) ?? null,
    child: (node) => children.get(node) ?? null,
    stats: Object.freeze({ ...counters.flex }),
    free: Object.freeze({ ...counters.free }),
  };
}
