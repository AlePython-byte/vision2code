import type { UINode, UISchema } from "@vision2code/contracts";
import { emitProject, number, percentage, pixels } from "./emitSource.ts";
import type { GeneratedProject } from "./generatedProject.ts";
import { planLayout, type LayoutPlan } from "./layoutInference.ts";
import { isSingleLineText } from "./textLayout.ts";

/**
 * Generator v2 ("generatorVersion": "2"): pure and deterministic, no I/O, clock or randomness.
 * Compared with v1 (see generateReactProjectV1.ts) it changes only how classes are chosen:
 *  - single-line text never wraps (`white-space: pre`: no wrapping, runs of spaces preserved);
 *  - children of a row keep their own width (v1 forced `w-full`, so `flex-wrap` stacked every child);
 *  - spacing, padding and alignment the schema leaves out are inferred from bounds when unambiguous
 *    (layoutInference.ts), and column children keep their width and horizontal offset.
 * Every schema string is still serialized as data, never as TSX syntax (emitSource.ts).
 */
function classes(node: UINode, parent: UINode | null, plan: LayoutPlan): string {
  const result = ["box-border", "min-w-0"];
  const property = (name: string, value: string) => result.push("[" + name + ":" + value + "]");
  const { bounds, layout, style, text } = node;
  const slot = parent === null ? null : plan.child(node);
  const own = plan.container(node);

  if (parent?.layout.mode === "ABSOLUTE") {
    result.push("absolute");
    property("left", percentage(bounds.x - parent.bounds.x, parent.bounds.width));
    property("top", percentage(bounds.y - parent.bounds.y, parent.bounds.height));
    property("width", percentage(bounds.width, parent.bounds.width));
    property("height", percentage(bounds.height, parent.bounds.height));
  } else {
    result.push("relative");
    if (parent?.layout.mode === "FLEX" && parent.layout.direction === "ROW") {
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
    if (slot !== null) {
      if (slot.alignSelf !== null) result.push({ START: "self-start", CENTER: "self-center", END: "self-end" }[slot.alignSelf]);
      if (slot.marginTop !== 0) property("margin-top", pixels(slot.marginTop));
      if (slot.marginLeft !== 0) property("margin-left", pixels(slot.marginLeft));
    }
  }
  if (layout.mode === "FLEX") {
    result.push("flex", layout.direction === "ROW" ? "flex-row" : "flex-col");
    if (layout.direction === "ROW") result.push(own?.singleLine ? "flex-nowrap" : "flex-wrap");
  }
  if (layout.mode === "GRID") {
    result.push("grid");
    if (layout.columns !== null) property("grid-template-columns", "repeat(" + layout.columns + ",minmax(0,1fr))");
    if (layout.direction === "COLUMN") result.push("grid-flow-col");
  }
  if (layout.mode === "FLEX" || layout.mode === "GRID") {
    result.push({ START: "justify-start", CENTER: "justify-center", END: "justify-end", SPACE_BETWEEN: "justify-between" }[own?.justify ?? layout.justify]);
    result.push({ START: "items-start", CENTER: "items-center", END: "items-end", STRETCH: "items-stretch" }[layout.align]);
    const gap = layout.gap ?? own?.gap ?? null;
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
    if (isSingleLineText(node)) result.push("whitespace-pre");
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
  const plan = planLayout(schema);
  return emitProject(schema, "2", (node, parent) => classes(node, parent, plan));
}
