import type { UINode, UISchema } from "@vision2code/contracts";
import { emitProject, number, percentage, pixels } from "./emitSource.ts";
import { fontFamilyList, fontFamilyValue } from "./fontFamily.ts";
import type { GeneratedProject } from "./generatedProject.ts";
import { planLayout, type LayoutPlan } from "./layoutInference.ts";
import { isSingleLineText } from "./textLayout.ts";

/**
 * Generator v4 ("generatorVersion": "4"): pure and deterministic, no I/O, clock or randomness.
 * It keeps everything v3 does (generateReactProjectV3.ts, frozen): NONE containers rendered as the
 * flex flow or the explicit grid tracks their children form, positioning by bounds as a last resort,
 * measured padding when the declared one is contradicted, and single-line text that never wraps.
 * Compared with v3 it changes:
 *  - font-family: the declared list is kept (each name sanitized, see fontFamily.ts) and always ends
 *    in a generic family, so a font that is not installed falls back to a similar one instead of the
 *    browser's default serif. v3 emitted one quoted name without a generic, and nothing at all for a
 *    list such as "Lato, sans-serif";
 *  - a declared GRID whose column count matches the children is kept only when CSS auto-placement
 *    really reproduces it; a child spanning two rows or columns gets explicit tracks instead;
 *  - an IMAGE/ICON placeholder shows its "sin recurso" label only when the box can hold it
 *    (PLACEHOLDER_LABEL_MIN_WIDTH x PLACEHOLDER_LABEL_MIN_HEIGHT); smaller ones keep a dashed
 *    outline, and the description stays in aria-label.
 * Inference is conservative ("in doubt, do not infer"); see layoutInference.ts.
 * Every schema string is still serialized as data, never as TSX syntax (emitSource.ts).
 */

/**
 * The label is `text-xs` (12 px font, 16 px line) inside `p-2` and a 1 px border: one line of
 * "Imagen sin recurso" is about 18 x 12 x 0.55 + 18 = 137 px wide and 34 px tall. Below this size it
 * wraps or is clipped into a dashed scribble. On the 12 fixtures it hides the logos (about 180 x 33),
 * buttons-sized images (about 110 x 28) and icons (18-25 px) and keeps it on charts and cards.
 */
export const PLACEHOLDER_LABEL_MIN_WIDTH = 140;
export const PLACEHOLDER_LABEL_MIN_HEIGHT = 40;

export function showsPlaceholderLabel(node: UINode): boolean {
  return node.bounds.width >= PLACEHOLDER_LABEL_MIN_WIDTH && node.bounds.height >= PLACEHOLDER_LABEL_MIN_HEIGHT;
}

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
      // A placeholder may not grow past its bounds: a 25 px icon would otherwise render 66 px tall
      // and push everything after it.
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
    // Sanitized names plus a generic fallback; nothing usable means the inherited font.
    const families = fontFamilyList(text.fontFamily);
    if (families !== null) property("font-family", fontFamilyValue(families));
  }
  return result.join(" ");
}

export function generateReactProject(schema: UISchema): GeneratedProject {
  const plan = planLayout(schema, "v4");
  return emitProject(schema, "4", (node, parent) => classes(node, parent, plan), { placeholderLabel: showsPlaceholderLabel });
}
