import type { UINode, UISchema } from "@vision2code/contracts";
import { emitProject, number, percentage, pixels } from "./emitSource.ts";
import type { GeneratedProject } from "./generatedProject.ts";
import { planLayout, type LayoutPlan } from "./layoutInference.ts";
import { isSingleLineText } from "./textLayout.ts";

/**
 * Generator v3 ("generatorVersion": "3"): pure and deterministic, no I/O, clock or randomness.
 * Compared with v2 (generateReactProjectV2.ts, frozen) it also handles the containers v2 left flat:
 *  - a NONE container whose children form a clean row or column is rendered as that flex flow;
 *  - a NONE or GRID container whose children form a grid by their edges gets explicit tracks and
 *    each child is placed in its cells (a declared column count the bounds contradict is replaced);
 *  - a NONE container that is neither positions its children by bounds, as a last resort;
 *  - a declared padding the children sit outside of is replaced by the measured one;
 *  - text that is one line once the node's own padding is excluded never wraps, and a GRID frame
 *    that only holds text is rendered as plain text instead of a one-item grid.
 * Inference is conservative ("in doubt, do not infer"); see layoutInference.ts.
 * Every schema string is still serialized as data, never as TSX syntax (emitSource.ts).
 */
function classes(node: UINode, parent: UINode | null, plan: LayoutPlan): string {
  const result = ["box-border", "min-w-0"];
  const property = (name: string, value: string) => result.push("[" + name + ":" + value + "]");
  const { bounds, layout, style, text } = node;
  const slot = parent === null ? null : plan.child(node);
  const own = plan.container(node);
  const parentPlan = parent === null ? null : plan.container(parent);
  const parentIsRow = parent !== null && ((parent.layout.mode === "FLEX" && parent.layout.direction === "ROW") || parentPlan?.inferredFlex === "ROW");

  if (parent?.layout.mode === "ABSOLUTE" || parentPlan?.positioned === true) {
    result.push("absolute");
    property("left", percentage(bounds.x - parent!.bounds.x, parent!.bounds.width));
    property("top", percentage(bounds.y - parent!.bounds.y, parent!.bounds.height));
    property("width", percentage(bounds.width, parent!.bounds.width));
    property("height", percentage(bounds.height, parent!.bounds.height));
  } else {
    result.push("relative");
    if (slot?.cell != null) {
      // In a track grid the child fills the cells it spans.
      result.push("w-full");
      property("max-width", pixels(bounds.width));
      property("grid-column", slot.cell.columnStart + "/" + slot.cell.columnEnd);
      property("grid-row", slot.cell.rowStart + "/" + slot.cell.rowEnd);
    } else if (parentIsRow) {
      // A row child keeps its own width as a shrinkable basis; `w-full` would put each child on its own line.
      property("flex", "0_1_" + pixels(bounds.width));
    } else if (slot !== null && slot.width === "FIXED") {
      property("width", pixels(bounds.width));
      property("max-width", "100%");
    } else {
      result.push("w-full");
      property("max-width", pixels(bounds.width));
    }
    if (layout.mode === "ABSOLUTE" && bounds.width > 0 && bounds.height > 0) {
      property("aspect-ratio", number(bounds.width) + "/" + number(bounds.height));
    } else {
      property("min-height", pixels(bounds.height));
      // A placeholder keeps its dashed label but may not grow past its bounds: a 25 px icon would
      // otherwise render 66 px tall and push everything after it.
      if ((node.type === "IMAGE" || node.type === "ICON") && bounds.height > 0) {
        property("max-height", pixels(bounds.height));
        result.push("overflow-hidden");
      }
    }
    if (slot !== null && slot.cell == null) {
      if (slot.alignSelf !== null) result.push({ START: "self-start", CENTER: "self-center", END: "self-end" }[slot.alignSelf]);
      if (slot.marginTop !== 0) property("margin-top", pixels(slot.marginTop));
      if (slot.marginLeft !== 0) property("margin-left", pixels(slot.marginLeft));
    }
  }

  // A GRID frame that only holds text has nothing to lay out: a one-item grid would squeeze the text
  // into its first column.
  const textOnlyGrid = layout.mode === "GRID" && text !== null && node.children.length === 0;
  const flexDirection = own?.inferredFlex ?? (layout.mode === "FLEX" ? layout.direction : null);
  const hasTracks = own?.tracks != null;
  if (!hasTracks && (layout.mode === "FLEX" || own?.inferredFlex != null)) {
    result.push("flex", flexDirection === "ROW" ? "flex-row" : "flex-col");
    if (flexDirection === "ROW") result.push(own?.singleLine ? "flex-nowrap" : "flex-wrap");
  }
  if (own?.tracks != null) {
    // Explicit tracks replace the declared flow completely: spacer tracks carry the spacing, so no
    // gap, justify or items classes are emitted.
    result.push("grid");
    property("grid-template-columns", own.tracks.columns.map((width) => "minmax(0," + number(width) + "fr)").join("_"));
    property("grid-template-rows", own.tracks.rows.map((height) => "minmax(" + pixels(height) + ",auto)").join("_"));
  } else if (layout.mode === "GRID" && !textOnlyGrid) {
    result.push("grid");
    if (layout.columns !== null) property("grid-template-columns", "repeat(" + layout.columns + ",minmax(0,1fr))");
    if (layout.direction === "COLUMN") result.push("grid-flow-col");
  }
  const spacesChildren = !hasTracks && (layout.mode === "FLEX" || own?.inferredFlex != null || (layout.mode === "GRID" && !textOnlyGrid));
  if (spacesChildren) {
    const inferred = own?.inferredFlex != null;
    result.push({ START: "justify-start", CENTER: "justify-center", END: "justify-end", SPACE_BETWEEN: "justify-between" }[inferred ? "START" : (own?.justify ?? layout.justify)]);
    result.push({ START: "items-start", CENTER: "items-center", END: "items-end", STRETCH: "items-stretch" }[inferred ? "START" : layout.align]);
    const gap = (inferred ? null : layout.gap) ?? own?.gap ?? null;
    if (gap !== null) property("gap", pixels(gap));
  }
  const padding = own?.padding ?? layout.padding;
  property("padding", [padding.top, padding.right, padding.bottom, padding.left].map(pixels).join("_"));
  if (style.background !== null) property("background-color", style.background);
  if (style.color !== null) property("color", style.color);
  if (style.border !== null) property("border", pixels(style.border.width) + "_solid_" + style.border.color);
  if (style.radius !== null) property("border-radius", pixels(style.radius));
  if (style.shadow !== null) {
    const shadow = style.shadow;
    property("box-shadow", [shadow.x, shadow.y, shadow.blur, shadow.spread].map(pixels).join("_") + "_" + shadow.color);
  }
  property("opacity", number(style.opacity));
  if (text !== null) {
    // Multi-line text keeps wrapping; a single line is never broken by the box's max-width.
    if (isSingleLineText(node, { paddingAware: true })) result.push("whitespace-pre");
    else result.push("whitespace-pre-wrap", "break-words");
    if (text.fontSize !== null) property("font-size", pixels(text.fontSize));
    if (text.fontWeight !== null) property("font-weight", number(text.fontWeight));
    if (text.lineHeight !== null) property("line-height", pixels(text.lineHeight));
    if (text.letterSpacing !== null) property("letter-spacing", pixels(text.letterSpacing));
    property("text-align", text.textAlign.toLowerCase());
    // Unsupported family syntax falls back locally; it can never inject CSS or URLs.
    if (text.fontFamily !== null && /^[a-zA-Z][a-zA-Z0-9 -]*$/.test(text.fontFamily)) {
      const family = text.fontFamily;
      property("font-family", ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"].includes(family)
        ? family : "'" + family.replace(/ /g, "_") + "'");
    }
  }
  return result.join(" ");
}

export function generateReactProject(schema: UISchema): GeneratedProject {
  const plan = planLayout(schema, "v3");
  return emitProject(schema, "3", (node, parent) => classes(node, parent, plan));
}
