import type { UISchema, UINode } from "@vision2code/contracts";
import type { GeneratedProject } from "./generatedProject.ts";

// Only callers that have passed the shared UISchema boundary should call this function.
// Schema strings are always serialized as data, never interpolated as TSX syntax.
function literal(value: string): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
}

function number(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}
function pixels(value: number): string { return number(value) + "px"; }
function percentage(value: number, total: number): string {
  return total > 0 ? number(Math.round(value / total * 1000000) / 10000) + "%" : pixels(value);
}

function classes(node: UINode, parent: UINode | null): string {
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

const nodeTags: Record<UINode["type"], "div" | "button"> = {
  FRAME: "div", TEXT: "div", IMAGE: "div", ICON: "div",
  BUTTON: "button", INPUT: "div", DIVIDER: "div",
};

function render(node: UINode, parent: UINode | null, depth: number, insideButton = false): string[] {
  const indent = "  ".repeat(depth);
  const attributes = " data-node-id={" + literal(node.id) + "} className={" + literal(classes(node, parent)) + "}";
  // Wrappers retain children even for void controls permitted by the shared contract.
  const tag = insideButton && node.type === "BUTTON" ? "div" : nodeTags[node.type];
  const control = tag === "button" ? ' type="button"' : "";
  const placeholder = node.type === "IMAGE" || node.type === "ICON";
  const description = node.image?.description ?? (node.type === "IMAGE" ? "Imagen sin recurso" : "Icono sin recurso");
  const role = placeholder ? ' role="img" aria-label={' + literal(description) + "}" : "";
  const lines = [indent + "<" + tag + control + role + attributes + ">"];
  if (node.type === "INPUT") {
    const multiline = node.text?.content.includes("\n") ?? false;
    const input = multiline ? "textarea" : "input";
    lines.push(indent + "  <" + input + (multiline ? "" : ' type="text"') +
      ' readOnly aria-label={"Campo de texto"} value={' + literal(node.text?.content ?? "") +
      '} className="block w-full bg-transparent text-inherit [font:inherit] whitespace-pre-wrap" />');
  } else if (node.type === "DIVIDER") {
    lines.push(indent + '  <hr className="m-0 w-full border-0 border-t border-current" />');
    if (node.text !== null) lines.push(indent + "  {" + literal(node.text.content) + "}");
  } else {
    if (placeholder) lines.push(indent + '  <span className="block border border-dashed border-current p-2 text-xs">' +
      "{" + literal(node.type === "IMAGE" ? "Imagen sin recurso" : "Icono sin recurso") + "}</span>");
    if (node.text !== null) lines.push(indent + "  {" + literal(node.text.content) + "}");
  }
  for (const child of node.children) lines.push(...render(child, node, depth + 1, insideButton || tag === "button"));
  lines.push(indent + "</" + tag + ">");
  return lines;
}

export function generateReactProject(schema: UISchema): GeneratedProject {
  return {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      {
        path: "src/App.tsx", language: "typescript",
        content: 'import GeneratedInterface from "./generated/GeneratedInterface";\n\nexport default function App() {\n  return <GeneratedInterface />;\n}\n',
      },
      {
        path: "src/generated/GeneratedInterface.tsx", language: "typescript",
        content: ["export default function GeneratedInterface() {", "  return (",
          ...render(schema.root, null, 2), "  );", "}", ""].join("\n"),
      },
    ],
  };
}
