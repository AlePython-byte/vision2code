import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { UISchemaSchema } from "@vision2code/contracts";
import type { UISchema } from "@vision2code/contracts";
import { computeSchemaMetrics, metricRows } from "../src/features/fidelity/schemaMetrics.ts";
import * as metricsModule from "../src/features/fidelity/schemaMetrics.ts";
import { driver, fakeNode, findAll, html, settle, text, type Node } from "./ui-harness.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const source = (name: string) => read(`../src/features/fidelity/${name}`);
const uiSchema: UISchema = UISchemaSchema.parse(JSON.parse(read("../../packages/contracts/tests/fixtures/simple-interface.json")));
const withWarnings: UISchema = { ...uiSchema, warnings: ["Texto ilegible en la cabecera", "Icono sin recurso"] };

const modules = { "/schemaMetrics": metricsModule, "schemaInspector.css": {} };
const session = (artifact: { uiSchema: UISchema } | null, origin: "GENERATED" | "RESTORED" | null = "GENERATED") => {
  const snapshot = { artifact, origin };
  return { getSnapshot: () => snapshot, subscribe: () => () => {} };
};

// ---- Behaviour --------------------------------------------------------------------------------

test("the Schema button needs a result and says so otherwise (English only)", () => {
  const empty = html("fidelity/SchemaInspector.tsx", "default", "es", { session: session(null, null) }, modules);
  assert.match(empty, /<button[^>]*disabled=""[^>]*title="No result yet: generate or open a generation first\."/);
  assert.ok(empty.includes("Schema</button>"));
  const ready = html("fidelity/SchemaInspector.tsx", "default", "es", { session: session({ uiSchema }) }, modules);
  assert.doesNotMatch(ready, /disabled=""/);
  assert.match(ready, /aria-haspopup="dialog"/);
  assert.doesNotMatch(ready, /Esquema|Cerrar|Copiar/, "no Spanish: it is a development tool");
});

test("opening the inspector shows the metrics, warnings and a collapsed JSON for the current result", () => {
  const live = session({ uiSchema: withWarnings });
  const d = driver("fidelity/SchemaInspector.tsx", "default", "en", modules);
  const closed = d.render({ session: live });
  assert.equal(findAll(closed, (n: Node) => n.props?.role === "dialog").length, 0);
  findAll(closed, (n: Node) => n.type === "button")[0].props.onClick();

  const sheetTree = d.render({ session: live });
  const sheetElement = findAll(sheetTree, (n: Node) => typeof n.type === "function")[0];
  assert.ok(sheetElement, "renders the sheet");
  const sheet = driver("fidelity/SchemaInspector.tsx", "InspectorSheet", "en", modules);
  const tree = sheet.render({ uiSchema: withWarnings, origin: "RESTORED", trigger: { current: null }, onClose: () => {} });
  const dialog = findAll(tree, (n: Node) => n.props?.role === "dialog")[0];
  assert.equal(dialog.props["aria-modal"], "true");
  assert.equal(dialog.props["aria-labelledby"], "schema-inspector-title");
  const body = text(tree);
  assert.ok(body.includes("Schema inspector (development only)") && body.includes("restored generation"));
  for (const [label, value] of metricRows(computeSchemaMetrics(withWarnings))) assert.ok(body.includes(label) && body.includes(value), label);
  assert.ok(body.includes("Warnings (2)") && body.includes("Texto ilegible en la cabecera"));
  assert.equal(findAll(tree, (n: Node) => n.type === "pre").length, 0, "JSON stays collapsed until asked");
  assert.equal(findAll(tree, (n: Node) => ["input", "textarea", "form"].includes(n.type)).length, 0, "read-only");
});

test("Show JSON reveals the exact read-only document; copies write JSON and metrics to the clipboard", async () => {
  const written: string[] = [];
  const navigator = { clipboard: { writeText: async (value: string) => { written.push(value); } } };
  const d = driver("fidelity/SchemaInspector.tsx", "InspectorSheet", "en", modules, { navigator });
  const props = { uiSchema, origin: "GENERATED" as const, trigger: { current: null }, onClose: () => {} };
  const buttons = (tree: Node, label: string) => findAll(tree, (n: Node) => n.type === "button" && text(n).includes(label))[0];

  buttons(d.render(props), "Show JSON").props.onClick();
  const expanded = d.render(props);
  const pre = findAll(expanded, (n: Node) => n.type === "pre")[0];
  assert.equal(pre.props.children, JSON.stringify(uiSchema, null, 2));
  assert.equal(buttons(expanded, "Hide JSON").props["aria-expanded"], true);

  buttons(expanded, "Copy JSON").props.onClick();
  await settle();
  buttons(d.render(props), "Copy metrics").props.onClick();
  await settle();
  assert.deepEqual(written, [JSON.stringify(uiSchema, null, 2), JSON.stringify(computeSchemaMetrics(uiSchema), null, 2)]);
  assert.ok(text(d.render(props)).includes("Metrics copied."));
});

test("a clipboard failure is shown inline, never thrown or toasted", async () => {
  const navigator = { clipboard: { writeText: async () => { throw new Error("denied"); } } };
  const d = driver("fidelity/SchemaInspector.tsx", "InspectorSheet", "en", modules, { navigator });
  const props = { uiSchema, origin: "GENERATED" as const, trigger: { current: null }, onClose: () => {} };
  findAll(d.render(props), (n: Node) => n.type === "button" && text(n).includes("Copy JSON"))[0].props.onClick();
  await settle();
  assert.ok(text(d.render(props)).includes("Could not copy to the clipboard."));
});

test("dialog accessibility: focus on Close, trap, Esc, and focus back to the trigger", () => {
  const log: string[] = [];
  let closed = 0;
  const trigger = { current: fakeNode("trigger", log) as unknown as HTMLButtonElement };
  const d = driver("fidelity/SchemaInspector.tsx", "InspectorSheet", "en", modules);
  const props = { uiSchema, origin: "GENERATED" as const, trigger, onClose: () => { closed++; } };
  const render = () => d.render(props);
  render();
  const first = fakeNode("first", log);
  const last = fakeNode("last", log);
  d.refs[0]!.current = { querySelectorAll: () => [first, last] };
  d.refs[1]!.current = fakeNode("close", log);
  d.flushEffects();
  assert.deepEqual(log, ["close"], "initial focus is the Close button");

  const dialog = () => findAll(render(), (n: Node) => n.props?.role === "dialog")[0];
  let prevented = 0;
  d.document.activeElement = last;
  dialog().props.onKeyDown({ key: "Tab", shiftKey: false, preventDefault: () => { prevented++; } });
  d.document.activeElement = first;
  dialog().props.onKeyDown({ key: "Tab", shiftKey: true, preventDefault: () => { prevented++; } });
  assert.deepEqual(log.slice(1), ["first", "last"], "Tab wraps around inside the dialog");
  dialog().props.onKeyDown({ key: "Escape", preventDefault: () => { prevented++; } });
  assert.equal(closed, 1);
  assert.equal(prevented, 3);
  const scrim = findAll(render(), (n: Node) => n.props?.className === "vault-scrim")[0];
  scrim.props.onMouseDown({ target: scrim, currentTarget: scrim });
  assert.equal(closed, 2, "clicking the scrim closes");
  d.unmount();
  assert.equal(log.at(-1), "trigger", "focus returns to the Schema button");
});

test("the inspector reads the session only: no requests, no session or editor changes, no console output", () => {
  for (const name of ["SchemaInspector.tsx", "schemaMetrics.ts"]) {
    const code = source(name);
    assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|console\.|localStorage|sessionStorage|\.openGeneration|\.complete\(|\.clear\(|\.reset\(|\.setProject|\.edit\(/, name);
  }
  assert.doesNotMatch(source("SchemaInspector.tsx"), /useLabels|preferences\/resources|toasts?\b/i, "English only, outside resources.ts, no toasts");
});

// ---- Production guarantees --------------------------------------------------------------------

function* sourceFiles(directory: string): Generator<string> {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx)$/.test(name)) yield path;
  }
}

test("the inspector is only reachable through a dynamic import behind the DEV constant", () => {
  const app = read("../src/App.tsx");
  assert.match(app, /const SchemaInspector = import\.meta\.env\.DEV \? lazy\(\(\) => import\("\.\/features\/fidelity\/SchemaInspector"\)\) : null;/);
  assert.match(app, /\{SchemaInspector && <Suspense fallback=\{null\}><SchemaInspector session=\{services\.generationSession\} \/><\/Suspense>\}/);
  const offenders: string[] = [];
  const base = fileURLToPath(new URL("../src/", import.meta.url));
  for (const path of sourceFiles(base)) {
    if (path.includes(`${join("features", "fidelity")}`)) continue;
    const code = readFileSync(path, "utf8");
    // Static import/export of the inspector or of the metrics outside the fidelity feature would pull it into production.
    if (/(?:import|export)\s[^;]*from\s+["'][^"']*fidelity\/(?:SchemaInspector|schemaMetrics)[^"']*["']/.test(code)) offenders.push(path);
    if (/import\(["'][^"']*SchemaInspector["']\)/.test(code) && !path.endsWith("App.tsx")) offenders.push(path);
  }
  assert.deepEqual(offenders, []);
});

test("inspector and metrics import no AI, generator, auth, toast or persistence code", () => {
  const allowed: Record<string, readonly string[]> = {
    "SchemaInspector.tsx": ["react", "lucide-react", "@vision2code/contracts", "../generation/generationSessionModel", "../projects/vaultKeyboard", "./schemaMetrics", "./schemaInspector.css"],
    "schemaMetrics.ts": ["@vision2code/contracts", "../generation/textLayout.ts"],
  };
  for (const [name, expected] of Object.entries(allowed)) {
    const imports = [...source(name).matchAll(/^import (?:type )?(?:.* from )?"([^"]+)";$/gm)].map((match) => match[1]!);
    assert.deepEqual([...imports].sort(), [...expected].sort(), name);
  }
  // The generation session is a type-only import: the inspector never calls the session or generator.
  assert.match(source("SchemaInspector.tsx"), /^import type \{ GenerationSessionModel \} from "\.\.\/generation\/generationSessionModel";$/m);
  assert.doesNotMatch(source("SchemaInspector.tsx"), /generateReactProject|authModel|feedback\/|projectsClient/);
});

test("the production bundle has no inspector marker (checked when a build exists)", () => {
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  if (!existsSync(dist)) return; // `npm run build` then `npm run check:dist-dev-only` verifies this explicitly.
  const markers = ["Schema inspector (development only)", "Text clamp risk", "schema-inspector"];
  for (const path of sourceFilesAny(dist)) {
    const content = readFileSync(path, "utf8");
    for (const marker of markers) assert.ok(!content.includes(marker), `${marker} found in ${path}`);
  }
});

function* sourceFilesAny(directory: string): Generator<string> {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) yield* sourceFilesAny(path);
    else if (/\.(js|css|html)$/.test(name)) yield path;
  }
}

test("the dist check is an explicit script and never part of npm test", () => {
  const root = JSON.parse(read("../../package.json")) as { scripts: Record<string, string> };
  assert.match(root.scripts["check:dist-dev-only"]!, /scripts\/check-dev-tools-not-in-dist\.mts/);
  assert.match(root.scripts["report:fidelity"]!, /scripts\/report-fidelity\.mts/);
  assert.doesNotMatch(root.scripts.test!, /check:dist|report:fidelity/);
  for (const script of ["check-dev-tools-not-in-dist.mts", "report-fidelity.mts"]) assert.equal(existsSync(new URL(`../../scripts/${script}`, import.meta.url)), true);
});

test("no user-facing resources were added for a development-only tool", () => {
  const resources = read("../src/features/preferences/resources.ts");
  assert.doesNotMatch(resources, /schema ?inspector|Schema inspector|clamp risk/i);
});
