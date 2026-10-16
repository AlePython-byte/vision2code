/**
 * Development-only layout measurement. For every UISchema fixture it renders what the generator
 * emits, in a real browser window as wide as the original capture, and compares each node's
 * rendered box with the schema's own `bounds`.
 *
 *   V2C_BROWSER="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" npm run measure:layout
 *   npm run measure:layout -- --nodes tremor-dashboard   # per-node deviations of one fixture
 *   npm run measure:layout -- --json                     # machine-readable
 *
 * It needs a local Chromium-based browser (Chrome, Edge, Chromium), named by the V2C_BROWSER
 * environment variable, and no network: it reuses the repository's installed Vite, React and
 * Tailwind through a junction. It adds no dependency (Chrome DevTools Protocol over Node's built-in
 * WebSocket) and is never part of `npm test` or CI.
 *
 * What it measures is the generator against the *schema* (the model's bounds), not against the
 * original screenshot.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { UISchemaSchema } from "@vision2code/contracts";
import type { GeneratedProject, UISchema } from "@vision2code/contracts";
import { buildScaffold } from "../desktop/src/features/export/exportScaffold.ts";
import { generateReactProject } from "../desktop/src/features/generation/generateReactProject.ts";
import { GENERATOR_VERSIONS } from "../desktop/src/features/generation/generatorVersions.ts";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const nodesFlag = args.indexOf("--nodes");
const nodesFixture = nodesFlag >= 0 ? args[nodesFlag + 1] : null;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

const browserPath = process.env.V2C_BROWSER;
if (!browserPath) {
  fail("Set V2C_BROWSER to a Chromium-based browser executable (Chrome, Edge or Chromium), for example:\n" +
    '  V2C_BROWSER="C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" npm run measure:layout', 2);
}
if (!existsSync(browserPath)) fail(`V2C_BROWSER points to a file that does not exist: ${browserPath}`, 2);

// ---- Fixtures and generators ------------------------------------------------------------------

const fixturesUrl = new URL("../desktop/tests/fixtures/ui-schemas/", import.meta.url);
const fixtureNames = readdirSync(fixturesUrl).filter((name) => name.endsWith(".json")).sort();
if (fixtureNames.length === 0) fail("No fixtures in desktop/tests/fixtures/ui-schemas.", 2);
const fixtures = fixtureNames.map((file) => ({
  name: file.replace(".v1.json", ""),
  schema: UISchemaSchema.parse(JSON.parse(readFileSync(new URL(file, fixturesUrl), "utf8"))) as UISchema,
}));
const generators: { version: string; generate: (schema: UISchema) => GeneratedProject }[] = [
  ...GENERATOR_VERSIONS.map(({ version, generate }) => ({ version: `v${version}`, generate })),
  { version: "v4", generate: generateReactProject },
];

// ---- Temporary project that reuses the repository's node_modules ------------------------------

const work = mkdtempSync(join(tmpdir(), "v2c-layout-"));
const app = join(work, "app");
mkdirSync(join(app, "src", "generated"), { recursive: true });
for (const file of buildScaffold("measure")) {
  const path = join(app, ...file.path.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.content);
}
symlinkSync(join(repoRoot, "node_modules"), join(app, "node_modules"), "junction");
const viteBin = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteBin)) fail("Vite is not installed in the repository (run npm install).", 2);

interface Variant { fixture: string; version: string; out: string }
const variants: Variant[] = [];
for (const { name, schema } of fixtures) {
  for (const { version, generate } of generators) {
    const project = generate(schema);
    for (const file of project.files) writeFileSync(join(app, ...file.path.split("/")), file.content);
    const out = `dist-${name}-${version}`;
    const built = spawnSync(process.execPath, [viteBin, "build", "--outDir", out, "--base", "./", "--logLevel", "error"],
      { cwd: app, stdio: "inherit" });
    if (built.status !== 0) fail(`Build failed for ${name} (${version}).`);
    variants.push({ fixture: name, version, out });
  }
}

// ---- Static server ----------------------------------------------------------------------------

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((request, response) => {
  const path = normalize(join(app, decodeURIComponent((request.url ?? "/").split("?")[0]!)));
  if (!path.startsWith(app + sep) || !existsSync(path)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
  response.end(readFileSync(path));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

// ---- Browser over the Chrome DevTools Protocol ------------------------------------------------

const profile = join(work, "profile");
mkdirSync(profile);
const browser = spawn(browserPath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: "ignore" });
const portFile = join(profile, "DevToolsActivePort");
for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
if (!existsSync(portFile)) { browser.kill(); fail("The browser did not start (no DevToolsActivePort)."); }
const debugPort = readFileSync(portFile, "utf8").split("\n")[0]!.trim();

const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" })).json() as { webSocketDebuggerUrl: string };
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("DevTools connection failed")); });
let nextId = 0;
const pending = new Map<number, (value: { result?: any; error?: { message: string } }) => void>();
socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data)) as { id?: number; result?: any; error?: { message: string } };
  if (message.id !== undefined) pending.get(message.id)?.(message);
};
function cdp(method: string, params: object = {}) {
  const id = ++nextId;
  return new Promise<any>((resolve, reject) => {
    pending.set(id, (message) => { pending.delete(id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = async (expression: string) => {
  const reply = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) throw new Error(String(reply.exceptionDetails.text));
  return reply.result.value;
};

// Runs inside the page: rendered box of every schema node relative to the root, against its bounds.
const probe = (nodes: Record<string, number[]>) => {
  const ids = Object.keys(nodes);
  const find = (id: string) => document.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
  const base = find(ids[0]!)!.getBoundingClientRect();
  return {
    rows: ids.map((id) => {
      const element = find(id);
      if (!element) return { id, missing: true };
      const rect = element.getBoundingClientRect();
      const b = nodes[id]!;
      return { id, dx: rect.left - base.left - b[0]!, dy: rect.top - base.top - b[1]!, dw: rect.width - b[2]!, dh: rect.height - b[3]! };
    }),
    docHeight: document.documentElement.scrollHeight,
    docWidth: document.documentElement.scrollWidth,
    rootHeight: base.height,
  };
};

interface Row { id: string; dx: number; dy: number; dw: number; dh: number; missing?: boolean }
interface Result {
  fixture: string; version: string; nodes: number; within8: number; xWithin8: number; yWithin8: number;
  meanDx: number; meanDy: number; meanDw: number; meanDh: number; heightRatio: number; docWidth: number; sourceWidth: number; rows: Row[];
}
const results: Result[] = [];
try {
  await cdp("Page.enable");
  for (const variant of variants) {
    const { schema } = fixtures.find((fixture) => fixture.name === variant.fixture)!;
    const rootBox = schema.root.bounds;
    const nodes: Record<string, number[]> = {};
    const stack = [schema.root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      nodes[node.id] = [node.bounds.x - rootBox.x, node.bounds.y - rootBox.y, node.bounds.width, node.bounds.height];
      stack.push(...node.children);
    }
    // Insertion order matters (the first id is the root): rebuild it root-first.
    const ordered: Record<string, number[]> = { [schema.root.id]: nodes[schema.root.id]! };
    for (const id of Object.keys(nodes)) ordered[id] = nodes[id]!;
    await cdp("Emulation.setDeviceMetricsOverride", { width: schema.source.width, height: schema.source.height, deviceScaleFactor: 1, mobile: false });
    await cdp("Page.navigate", { url: `${origin}/${variant.out}/index.html` });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`document.readyState === "complete" && !!document.querySelector("[data-node-id]")`)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const data = await evaluate(`(${probe.toString()})(${JSON.stringify(ordered)})`) as ReturnType<typeof probe>;
    const rows = data.rows.filter((row): row is Row => !("missing" in row && row.missing));
    const mean = (pick: (row: Row) => number) => rows.reduce((sum, row) => sum + Math.abs(pick(row)), 0) / Math.max(1, rows.length);
    const percent = (test: (row: Row) => boolean) => Math.round(100 * rows.filter(test).length / Math.max(1, rows.length));
    results.push({
      fixture: variant.fixture, version: variant.version, nodes: rows.length,
      within8: percent((row) => Math.abs(row.dx) <= 8 && Math.abs(row.dy) <= 8),
      xWithin8: percent((row) => Math.abs(row.dx) <= 8),
      yWithin8: percent((row) => Math.abs(row.dy) <= 8),
      meanDx: +mean((row) => row.dx).toFixed(1), meanDy: +mean((row) => row.dy).toFixed(1),
      meanDw: +mean((row) => row.dw).toFixed(1), meanDh: +mean((row) => row.dh).toFixed(1),
      heightRatio: +(data.docHeight / schema.source.height).toFixed(2),
      docWidth: Math.round(data.docWidth), sourceWidth: schema.source.width, rows,
    });
  }
} finally {
  try { socket.close(); } catch { /* already closed */ }
  const exited = new Promise<void>((resolve) => { browser.once("exit", () => resolve()); setTimeout(resolve, 5000); });
  browser.kill();
  await exited;
  server.close();
  // Remove the junction itself first so the recursive delete can never walk into the repository.
  try { rmdirSync(join(app, "node_modules")); } catch { /* not created yet */ }
  try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.error(`Could not remove the temporary folder ${work}; delete it manually.`); }
}

if (asJson) {
  console.log(JSON.stringify(results.map(({ rows, ...summary }) => summary), null, 2));
} else if (nodesFixture) {
  for (const result of results.filter((entry) => nodesFixture === "all" || entry.fixture === nodesFixture)) {
    console.log(`\n## ${result.fixture} ${result.version}`);
    for (const row of result.rows) console.log(`${row.id.padEnd(24)} dx=${String(Math.round(row.dx)).padStart(5)} dy=${String(Math.round(row.dy)).padStart(5)} dw=${String(Math.round(row.dw)).padStart(5)} dh=${String(Math.round(row.dh)).padStart(5)}`);
  }
} else {
  const columns = ["fixture", "gen", "nodes", "pos<=8px", "x<=8px", "y<=8px", "mean|dx|", "mean|dy|", "mean|dh|", "heightRatio", "docW/srcW"];
  const body = results.map((r) => [r.fixture, r.version, r.nodes, `${r.within8}%`, `${r.xWithin8}%`, `${r.yWithin8}%`, r.meanDx, r.meanDy, r.meanDh, r.heightRatio, `${r.docWidth}/${r.sourceWidth}`].map(String));
  const widths = columns.map((column, index) => Math.max(column.length, ...body.map((row) => row[index]!.length)));
  const line = (cells: string[]) => cells.map((cell, index) => (index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!))).join("  ");
  console.log(line(columns));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of body) console.log(line(row));
  console.log("\nDeviations are rendered box vs the schema's bounds (relative to the root), in px. heightRatio = rendered page height / schema height.");
}
