import type { UINode, UISchema } from "@vision2code/contracts";
import { emitProject, number, percentage, pixels } from "./emitSource.ts";
import type { GeneratedProject } from "./generatedProject.ts";

/**
 * Generator v1, kept only for comparison and compatibility checks.
 *
 * The app no longer calls it: new generations use `generateReactProject` (version "2"), and stored
 * generations are never regenerated. It exists so that `npm run report:fidelity` can show v1 against
 * v2 on the same fixtures and so a test can prove that what v1 produced is still reproducible byte
 * for byte (stored "1" projects are immutable). Nothing under `src/` except tests and scripts
 * imports it, so it is not part of the application bundle.
 */
function classesV1(node: UINode, parent: UINode | null): string {
  const result = ["box-border", "min-w-0"];
  const property = (name: string, value: string) => result.push("[" + name + ":" + value + "]");
  const { bounds, layout, style, text } = node;
  if (parent?.layout.mode === "ABSOLUTE") {
    result.push("absolute");
    property("left", percentage(bounds.x - parent.bounds.x, parent.bounds.width));
    property("top", percentage(bounds.y - parent.bounds.y, parent.bounds.height));
    property("width", percentage(bounds.width, parent.bounds.width));
    property("height", percentage(bounds.height, parent.bounds.height));
  } else {
    result.push("relative", "w-full");
    property("max-width", pixels(bounds.width));
    if (layout.mode === "ABSOLUTE" && bounds.width > 0 && bounds.height > 0) {
      property("aspect-ratio", number(bounds.width) + "/" + number(bounds.height));
    } else {
      property("min-height", pixels(bounds.height));
    }
  }
  if (layout.mode === "FLEX") {
    result.push("flex", layout.direction === "ROW" ? "flex-row" : "flex-col");
    if (layout.direction === "ROW") result.push("flex-wrap");
  }
  if (layout.mode === "GRID") {
    result.push("grid");
    if (layout.columns !== null) property("grid-template-columns", "repeat(" + layout.columns + ",minmax(0,1fr))");
    if (layout.direction === "COLUMN") result.push("grid-flow-col");
  }
  if (layout.mode === "FLEX" || layout.mode === "GRID") {
    result.push({ START: "justify-start", CENTER: "justify-center", END: "justify-end", SPACE_BETWEEN: "justify-between" }[layout.justify]);
    result.push({ START: "items-start", CENTER: "items-center", END: "items-end", STRETCH: "items-stretch" }[layout.align]);
    if (layout.gap !== null) property("gap", pixels(layout.gap));
  }
  property("padding", [layout.padding.top, layout.padding.right, layout.padding.bottom, layout.padding.left].map(pixels).join("_"));
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
    result.push("whitespace-pre-wrap", "break-words");
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

export function generateReactProjectV1(schema: UISchema): GeneratedProject {
  return emitProject(schema, "1", classesV1);
}
