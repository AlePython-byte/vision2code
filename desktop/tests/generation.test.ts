import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { compile } from "tailwindcss";
import { UISchemaSchema, type UISchema, type UINode } from "@vision2code/contracts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createAnalysisModel } from "../src/features/analysis/analysisModel.ts";
import { createAnalysisClient } from "../src/features/analysis/analysisClient.ts";

const fixture = UISchemaSchema.parse(JSON.parse(readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8")));
function node(type: UINode["type"], id = type.toLowerCase()): UINode {
  const result = structuredClone(fixture.root);
  result.id = id;
  result.type = type;
  result.children = [];
  result.layout.mode = "NONE";
  result.text = null;
  return result;
}
function schema(...children: UINode[]): UISchema {
  const result = structuredClone(fixture);
  result.root.children = children;
  return UISchemaSchema.parse(result);
}
function output(value = fixture): string {
  return generateReactProject(value).files[1]!.content;
}
function classNames(source: string): string[] {
  return Array.from(source.matchAll(/className=\{("(?:[^"\\]|\\.)*")\}/g))
    .flatMap((match) => (JSON.parse(match[1]!) as string).split(" "));
}
function assertCompiles(value: UISchema) {
  const files = new Map(generateReactProject(value).files.map((file) => [resolve(file.path).replaceAll("\\", "/"), file.content]));
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX, types: ["react"],
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.readFile = (path) => files.get(resolve(path).replaceAll("\\", "/")) ?? read(path);
  host.fileExists = (path) => files.has(resolve(path).replaceAll("\\", "/")) || exists(path);
  const directoryExists = host.directoryExists!.bind(host);
  host.directoryExists = (path) => path.replaceAll("\\", "/").endsWith("/src/generated") || directoryExists(path);
  host.getSourceFile = (path, version) => {
    const content = host.readFile(path);
    return content === undefined ? undefined : ts.createSourceFile(path, content, version, true);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")), []);
}

test("generation is deterministic, pure, LF-only, and emits two typed React source files", () => {
  const before = structuredClone(fixture);
  const first = generateReactProject(fixture);
  assert.deepEqual(first, generateReactProject(fixture));
  assert.deepEqual(fixture, before);
  assert.equal(first.target, "react-tailwind");
  assert.equal(first.generatorVersion, "1");
  assert.deepEqual(first.files.map((file) => file.path), ["src/App.tsx", "src/generated/GeneratedInterface.tsx"]);
  for (const file of first.files) {
    assert.equal(file.language, "typescript");
    assert.ok(file.content.endsWith("\n"));
    assert.ok(!file.content.includes("\r"));
  }
  assertCompiles(fixture);
});

test("root and nested frames retain hierarchy and identifiers without guessed semantics", () => {
  const nested = node("FRAME", "nested");
  nested.children = [node("FRAME", "inner")];
  const source = output(schema(nested));
  assert.match(source, /<div data-node-id=\{"nested"\}/);
  assert.match(source, /      <div data-node-id=\{"inner"\}/);
  assert.doesNotMatch(source, /<nav|<section|<header/);
});

test("all node types and unusual children produce valid TSX including void control wrappers", () => {
  const nodes = (["FRAME", "TEXT", "BUTTON", "INPUT", "IMAGE", "ICON", "DIVIDER"] as const).map((type) => node(type));
  for (const item of nodes) item.children = [node("TEXT", item.id + "-child")];
  nodes[2]!.children.push(node("BUTTON", "nested-button"));
  const value = schema(...nodes);
  const source = output(value);
  assert.match(source, /<button type="button"/);
  assert.match(source, /<input type="text" readOnly/);
  assert.match(source, /<hr /);
  assert.match(source, /Imagen sin recurso/);
  assert.match(source, /Icono sin recurso/);
  assert.match(source, /<div data-node-id=\{"nested-button"\}/);
  assert.doesNotMatch(source, /<img|https?:|src=|dangerouslySetInnerHTML/);
  assertCompiles(value);
});

test("multiline and hostile text remain exact string data, including Unicode", () => {
  const text = node("TEXT");
  const payload = '</div>{globalThis.PWNED = true}<script>bad()</script>\n"Hola" & \\ mundo\u2028第二行';
  text.text = { ...fixture.root.children.find((child) => child.text)!.text!, content: payload };
  text.id = 'id"} onClick={bad}';
  const source = output(schema(text));
  const ast = ts.createSourceFile("GeneratedInterface.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const strings: string[] = [];
  function visit(part: ts.Node) {
    if (ts.isStringLiteral(part)) strings.push(part.text);
    if (ts.isJsxAttribute(part)) assert.notEqual(part.name.getText(ast), "onClick");
    ts.forEachChild(part, visit);
  }
  visit(ast);
  assert.ok(strings.includes(payload));
  assert.ok(strings.includes(text.id));
  assert.ok(classNames(source).includes("whitespace-pre-wrap"));
  assert.doesNotMatch(source, /<script>/);
  assertCompiles(schema(text));
});

test("input values preserve text and multiline inputs use a read-only textarea", () => {
  const input = node("INPUT");
  input.text = { ...fixture.root.children.find((child) => child.text)!.text!, content: "Uno\nDos" };
  assert.match(output(schema(input)), /<textarea readOnly.*value=\{"Uno\\nDos"\}/);
  input.text.content = "Uno";
  assert.match(output(schema(input)), /<input type="text" readOnly.*value=\{"Uno"\}/);
});

test("image and icon descriptions are escaped accessible placeholder data", () => {
  for (const type of ["IMAGE", "ICON"] as const) {
    const image = node(type);
    image.image = { description: 'A "shape" <not markup>', fit: "COVER" };
    const source = output(schema(image));
    assert.match(source, /role="img" aria-label=/);
    assert.doesNotMatch(source, /<not markup>|object-cover|https?:/);
  }
});

test("flex translates direction, alignment, justification, gap and four-sided padding", () => {
  const frame = node("FRAME");
  frame.layout = { ...frame.layout, mode: "FLEX", direction: "ROW", justify: "SPACE_BETWEEN", align: "CENTER", gap: 13,
    padding: { top: 1, right: 2, bottom: 3, left: 4 } };
  const values = classNames(output(schema(frame)));
  for (const value of ["flex", "flex-row", "flex-wrap", "justify-between", "items-center", "[gap:13px]", "[padding:1px_2px_3px_4px]"]) assert.ok(values.includes(value), value);
  frame.layout.direction = "COLUMN";
  assert.ok(classNames(output(schema(frame))).includes("flex-col"));
});

test("grid maps columns and column flow without absolute positioning; NONE stays in normal flow", () => {
  const frame = node("FRAME");
  frame.layout = { ...frame.layout, mode: "GRID", columns: 3, direction: "COLUMN", justify: "END", align: "STRETCH", gap: 8 };
  const values = classNames(output(schema(frame)));
  for (const value of ["grid", "grid-flow-col", "[grid-template-columns:repeat(3,minmax(0,1fr))]", "justify-end", "items-stretch"]) assert.ok(values.includes(value), value);
  frame.layout.mode = "NONE";
  assert.ok(!classNames(output(schema(frame))).includes("absolute"));
  assert.ok(!classNames(output(schema(frame))).includes("grid"));
});

test("absolute bounds become parent-relative percentages with responsive root aspect ratio", () => {
  const value = schema();
  value.root.bounds = { x: 10, y: 20, width: 1000, height: 800 };
  value.root.layout.mode = "ABSOLUTE";
  const frame = node("FRAME");
  frame.bounds = { x: 110, y: 100, width: 500, height: 400 };
  frame.layout.mode = "ABSOLUTE";
  const child = node("TEXT");
  child.bounds = { x: 160, y: 180, width: 250, height: 100 };
  frame.children = [child];
  value.root.children = [frame];
  const values = classNames(output(value));
  for (const item of ["w-full", "[aspect-ratio:1000/800]", "[left:10%]", "[top:20%]", "[width:50%]", "[height:25%]"]) assert.ok(values.includes(item), item);
  assert.doesNotMatch(output(value), /1440|1024|NaN|Infinity/);
  frame.bounds.width = 0;
  frame.bounds.height = 0;
  assert.doesNotMatch(output(value), /NaN|Infinity/);
});

test("styles and typography produce accepted Tailwind utilities without inline styles", async () => {
  const frame = node("TEXT");
  frame.style = { background: "#EDF1F6", color: "#123", border: { width: 1, color: "#FFFFFF88" }, radius: 28,
    shadow: { x: -2, y: 3, blur: 4, spread: -1, color: "#0008" }, opacity: 0.5 };
  frame.text = { content: "Hola", fontFamily: "IBM Plex Sans", fontSize: 18, fontWeight: 600, lineHeight: 24, letterSpacing: -0.5, textAlign: "CENTER" };
  const source = output(schema(frame));
  const values = classNames(source);
  const expected = ["[background-color:#EDF1F6]", "[color:#123]", "[border:1px_solid_#FFFFFF88]",
    "[border-radius:28px]", "[box-shadow:-2px_3px_4px_-1px_#0008]", "[opacity:0.5]",
    "[font-family:'IBM_Plex_Sans']", "[font-size:18px]", "[font-weight:600]", "[line-height:24px]", "[letter-spacing:-0.5px]", "[text-align:center]"];
  const theme = readFileSync(new URL("../../node_modules/tailwindcss/theme.css", import.meta.url), "utf8");
  for (const value of expected) {
    assert.ok(values.includes(value), value);
    const compiler = await compile(theme + "\n@tailwind utilities;");
    const emptyLength = compiler.build([]).length;
    assert.ok(compiler.build([value]).length > emptyLength, value);
  }
  assert.doesNotMatch(source, /style=\{/);
});

test("font-family cannot inject CSS, remote resources or TSX", () => {
  const text = node("TEXT");
  text.text = { ...fixture.root.children.find((child) => child.text)!.text!, fontFamily: "x'];background:url(https://evil.test);/*" };
  const source = output(schema(text));
  assert.doesNotMatch(source, /evil|url\(|font-family/);
});

test("representative dashboard combines layouts, controls, grouped text and placeholders", () => {
  const value = schema();
  value.root.layout.mode = "FLEX";
  value.root.layout.direction = "ROW";
  const sidebar = node("FRAME", "sidebar");
  sidebar.layout.mode = "FLEX";
  sidebar.layout.direction = "COLUMN";
  sidebar.children = [node("ICON"), node("BUTTON")];
  const content = node("FRAME", "content");
  content.layout.mode = "GRID";
  content.layout.columns = 2;
  content.children = [node("IMAGE"), node("INPUT"), node("DIVIDER"), ...fixture.root.children];
  value.root.children = [sidebar, content];
  const validated = UISchemaSchema.parse(value);
  assert.deepEqual(generateReactProject(validated), generateReactProject(validated));
  assertCompiles(validated);
});

const file = new File(["test"], "test.png", { type: "image/png" });
const screenshot = { file, name: file.name, size: file.size, format: "PNG" as const, width: 640, height: 480, url: "blob:test" };

test("successful analysis exposes synchronous generation; replacing/removing/disposal clears access", async () => {
  const model = createAnalysisModel(createAnalysisClient(undefined, async () => Response.json({ requestId: "generation-test", uiSchema: fixture })));
  assert.equal(model.generateReactProject(), null);
  model.setScreenshot(screenshot);
  const pending = model.analyze();
  assert.equal(model.generateReactProject(), null);
  await pending;
  assert.deepEqual(model.generateReactProject(), generateReactProject(fixture));
  model.setScreenshot(null);
  assert.equal(model.generateReactProject(), null);
  model.dispose();
  assert.equal(model.generateReactProject(), null);
});

test("malformed API output is rejected before it can enter the generator", async () => {
  const malformed = structuredClone(fixture);
  malformed.root.style.background = "url(https://evil.test)" as never;
  const model = createAnalysisModel(createAnalysisClient(undefined, async () => Response.json({ requestId: "generation-test", uiSchema: malformed })));
  model.setScreenshot(screenshot);
  await model.analyze();
  assert.equal(model.getSnapshot().status, "ERROR");
  assert.equal(model.generateReactProject(), null);
});

test("generation works with network transport forbidden", (context) => {
  context.mock.method(globalThis, "fetch", () => { throw new Error("Network calls forbidden"); });
  assert.equal(generateReactProject(fixture).files.length, 2);
});
