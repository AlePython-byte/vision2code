import type { UINode, UISchema } from "@vision2code/contracts";
import type { GeneratedProject } from "./generatedProject.ts";

/**
 * Source emission shared by every generator version. A version only decides the class list of each
 * node (`classFor`); the markup, escaping and file layout are identical, so versions cannot drift
 * apart on safety. Pure: no I/O, timestamps or randomness.
 */

// Schema strings are always serialized as data, never interpolated as TSX syntax.
export function literal(value: string): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function number(value: number): string {
  return String(Object.is(value, -0) ? 0 : value);
}
export function pixels(value: number): string { return number(value) + "px"; }
export function percentage(value: number, total: number): string {
  return total > 0 ? number(Math.round(value / total * 1000000) / 10000) + "%" : pixels(value);
}

export type ClassFor = (node: UINode, parent: UINode | null) => string;

const nodeTags: Record<UINode["type"], "div" | "button"> = {
  FRAME: "div", TEXT: "div", IMAGE: "div", ICON: "div",
  BUTTON: "button", INPUT: "div", DIVIDER: "div",
};

function render(node: UINode, parent: UINode | null, depth: number, classFor: ClassFor, insideButton = false): string[] {
  const indent = "  ".repeat(depth);
  const attributes = " data-node-id={" + literal(node.id) + "} className={" + literal(classFor(node, parent)) + "}";
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
  for (const child of node.children) lines.push(...render(child, node, depth + 1, classFor, insideButton || tag === "button"));
  lines.push(indent + "</" + tag + ">");
  return lines;
}

export function emitProject(schema: UISchema, generatorVersion: GeneratedProject["generatorVersion"], classFor: ClassFor): GeneratedProject {
  return {
    target: "react-tailwind",
    generatorVersion,
    files: [
      {
        path: "src/App.tsx", language: "typescript",
        content: 'import GeneratedInterface from "./generated/GeneratedInterface";\n\nexport default function App() {\n  return <GeneratedInterface />;\n}\n',
      },
      {
        path: "src/generated/GeneratedInterface.tsx", language: "typescript",
        content: ["export default function GeneratedInterface() {", "  return (",
          ...render(schema.root, null, 2, classFor), "  );", "}", ""].join("\n"),
      },
    ],
  };
}
