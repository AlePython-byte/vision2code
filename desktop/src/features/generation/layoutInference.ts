import type { UINode, UISchema } from "@vision2code/contracts";

/**
 * Layout inference for generator v2: what the UISchema bounds say about spacing and alignment when
 * the declared layout does not already say it. Pure and deterministic (no I/O, clock or randomness).
 *
 * The rule is "infer only when unambiguous". A FLEX container is inferred as a whole or not at all:
 * if its children are not a clean single flow (out of order, overlapping, or leaving the container)
 * nothing is inferred for it and the generator keeps the declared layout. Every comparison uses a
 * small tolerance (INFERENCE_TOLERANCE_PX); anything within it is treated as equal.
 */

export const INFERENCE_TOLERANCE_PX = 2;
/** Fraction of the smaller height that row neighbours must share vertically (same as the metrics). */
const ROW_VERTICAL_OVERLAP = 0.5;

export type SelfAlignment = "START" | "CENTER" | "END";

export interface Spacing {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** How one child sits inside a planned FLEX container. */
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
}

export interface ContainerLayout {
  readonly axis: "ROW" | "COLUMN";
  /** Replaces the declared padding (only when the declared one was all zero and bounds show more). */
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

export interface LayoutPlan {
  container(node: UINode): ContainerLayout | null;
  child(node: UINode): ChildLayout | null;
  readonly stats: InferenceStats;
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

function planContainer(node: UINode, containers: Map<UINode, ContainerLayout>, children: Map<UINode, ChildLayout>, counters: Record<keyof InferenceStats, number>) {
  const { layout, bounds: box, children: kids } = node;
  if (layout.mode !== "FLEX" || kids.length === 0) return;
  counters.flexContainers++;
  const row = layout.direction === "ROW";
  if (box.width <= 0 || box.height <= 0) return;
  // A container that carries its own text is not a pure layout box: the text takes space the bounds
  // attribute to the container, so spacing measured against its children would count it twice.
  if (node.text !== null) return;
  if (!isCleanFlow(kids, row)) return;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  // A child that leaves the container is a doubt about what the container is: do not infer.
  for (const kid of kids) {
    const b = kid.bounds;
    if (b.x < box.x - INFERENCE_TOLERANCE_PX || b.y < box.y - INFERENCE_TOLERANCE_PX ||
      b.x + b.width > right + INFERENCE_TOLERANCE_PX || b.y + b.height > bottom + INFERENCE_TOLERANCE_PX) return;
  }
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

  // Padding: only when none is declared. Main-axis start padding needs justify START (otherwise the
  // free space is distributed by justify and the first child's offset says nothing about padding).
  const declared = layout.padding;
  let padding: Spacing = declared;
  let paddingInferred = false;
  if (declared.top === 0 && declared.right === 0 && declared.bottom === 0 && declared.left === 0) {
    const minOffset = (pick: (b: UINode["bounds"]) => number) => Math.min(...kids.map((kid) => pick(kid.bounds)));
    const measured: Spacing = row
      ? { left: justifyStart ? snap(first.x - box.x) : 0, right: 0,
        top: snap(minOffset((b) => b.y - box.y)), bottom: snap(minOffset((b) => bottom - (b.y + b.height))) }
      : { top: justifyStart ? snap(first.y - box.y) : 0, bottom: 0,
        left: snap(minOffset((b) => b.x - box.x)), right: snap(minOffset((b) => right - (b.x + b.width))) };
    if (measured.top > 0 || measured.right > 0 || measured.bottom > 0 || measured.left > 0) {
      padding = measured;
      paddingInferred = true;
    }
  }
  const contentLeft = box.x + padding.left;
  const contentTop = box.y + padding.top;
  const contentWidth = box.width - padding.left - padding.right;
  const contentHeight = box.height - padding.top - padding.bottom;

  // A row that does not fit one line by its own bounds is not "a single row": leave wrapping alone.
  const spanned = row ? kids[kids.length - 1]!.bounds.x + kids[kids.length - 1]!.bounds.width - first.x : 0;
  const singleLine = row && kids.length >= 2 && spanned <= contentWidth + INFERENCE_TOLERANCE_PX;

  // Gap: only when none is declared and the measured gaps agree with each other.
  const mainStart = mainStartOf;
  const mainSize = mainSizeOf;
  const gaps = measuredGaps;
  // With a consistent SPACE_BETWEEN the free space is distributed by justify; a `gap` would be a rigid
  // minimum equal to that free space and would force overflow in a narrower viewport.
  const spaceIsDistributed = layout.justify === "SPACE_BETWEEN" && !contradicted;
  let inferredGap: number | null = null;
  if (layout.gap === null && gaps.length > 0 && !spaceIsDistributed) {
    const low = Math.min(...gaps);
    const high = Math.max(...gaps);
    if (high - low <= INFERENCE_TOLERANCE_PX) {
      const mean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
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
      const residual = mainStart(b) - expected;
      if (Math.abs(residual) > INFERENCE_TOLERANCE_PX) marginMain = Math.round(residual);
    }
    cursor = mainStart(b) + mainSize(b);

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
    }]);
  });

  const justifyOverride = contradicted && layout.justify !== "START";
  containers.set(node, {
    axis: row ? "ROW" : "COLUMN", padding: paddingInferred ? padding : null, gap: inferredGap, singleLine,
    justify: justifyOverride ? "START" : null,
  });
  for (const [kid, value] of planned) children.set(kid, value);
  counters.plannedContainers++;
  if (inferredGap !== null) counters.gaps++;
  if (paddingInferred) counters.paddings++;
  if (justifyOverride) counters.justifyOverrides++;
  counters.margins += marginCount;
  counters.alignments += alignmentCount;
  counters.fixedWidths += fixedCount;
}

export function planLayout(schema: UISchema): LayoutPlan {
  const containers = new Map<UINode, ContainerLayout>();
  const children = new Map<UINode, ChildLayout>();
  const counters = { flexContainers: 0, plannedContainers: 0, gaps: 0, paddings: 0, margins: 0, alignments: 0, justifyOverrides: 0, fixedWidths: 0 };
  // Iterative walk: schema depth is untrusted, so recursion could overflow on a long chain.
  const stack: UINode[] = [schema.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    planContainer(node, containers, children, counters);
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]!);
  }
  return {
    container: (node) => containers.get(node) ?? null,
    child: (node) => children.get(node) ?? null,
    stats: Object.freeze({ ...counters }),
  };
}
