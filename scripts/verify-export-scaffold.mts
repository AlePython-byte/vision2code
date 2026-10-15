/**
 * Opt-in end-to-end check of the export scaffold (never part of `npm test`: it needs the network
 * and takes minutes). It generates a project from a fixture UISchema, builds the same plan the app
 * exports (working copy + scaffold), writes it to a temporary folder, runs `npm install` and
 * `npm run build` there, and fails when anything does not work.
 *
 *   npm run verify:export-scaffold            # temp folder is deleted afterwards
 *   npm run verify:export-scaffold -- --keep  # keeps the folder so you can run `npm run dev`
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UISchemaSchema } from "@vision2code/contracts";
import { generateReactProject } from "../desktop/src/features/generation/generateReactProject.ts";
import { buildRunnableExportPlan } from "../desktop/src/features/export/exportScaffold.ts";
import { EXPORT_SCAFFOLD_VERSION } from "../desktop/src/features/export/exportScaffold.ts";

const keep = process.argv.includes("--keep");
const fixture = new URL("../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url);

function fail(message: string): never {
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
}

const uiSchema = UISchemaSchema.parse(JSON.parse(readFileSync(fixture, "utf8")));
const generated = generateReactProject(uiSchema);
// New generations come from generator v3; the export must build with its output.
if (generated.generatorVersion !== "3") fail(`expected generator v3 output, got version ${generated.generatorVersion}`);
const planned = buildRunnableExportPlan(generated.files, "Verificación del andamiaje");
if (!planned.ok) fail(`the export plan was rejected by the validator (${planned.code})`);
const { plan } = planned;

const root = mkdtempSync(join(tmpdir(), "v2c-scaffold-"));
const target = join(root, plan.folderName);
mkdirSync(target);
for (const file of plan.files) {
  const path = join(target, ...file.path.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.content, { flag: "wx" });
}
console.log(`Scaffold v${EXPORT_SCAFFOLD_VERSION}: ${plan.files.length} files (${plan.scaffold.fileCount} scaffold, ${plan.scaffold.omitted.length} omitted) -> ${target}`);

// A clean environment: the child must behave like a user running npm in the exported folder.
const env: NodeJS.ProcessEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if (/^(npm_package_|npm_lifecycle_|npm_command$|npm_execpath$|npm_node_execpath$|INIT_CWD$)/i.test(key)) continue;
  if (/^npm_config_(local_prefix|workspace|workspaces|include_workspace_root)/i.test(key)) continue;
  env[key] = value;
}
function run(label: string, args: string[]) {
  console.log(`\n$ npm ${args.join(" ")}`);
  const started = Date.now();
  // The arguments are fixed literals above, so one shell command string is safe and works for
  // npm.cmd on Windows as well as npm elsewhere.
  const result = spawnSync(`npm ${args.join(" ")}`, { cwd: target, env, stdio: "inherit", shell: true });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) fail(`${label} exited with ${String(result.status ?? result.error)} after ${seconds}s (folder kept at ${target})`);
  console.log(`${label}: ok in ${seconds}s`);
}

run("npm install", ["install", "--no-audit", "--no-fund"]);
run("npm run build", ["run", "build"]);

const built = join(target, "dist", "index.html");
if (!existsSync(built) || statSync(built).size === 0) fail(`the build produced no dist/index.html (folder kept at ${target})`);
const assets = join(target, "dist", "assets");
if (!existsSync(assets)) fail(`the build produced no dist/assets (folder kept at ${target})`);

// Tailwind must have emitted the utilities used by the generated interface (not just its base layer).
const css = readdirSync(assets).filter((name) => name.endsWith(".css")).map((name) => readFileSync(join(assets, name), "utf8")).join("\n");
if (!/max-width:\s*640px/.test(css)) fail(`the built CSS has no utilities from the generated classes (folder kept at ${target})`);

// The same exported project must also build with the real fixtures' v3 output (a richer layout set).
const realFixtures = new URL("../desktop/tests/fixtures/ui-schemas/", import.meta.url);
const realNames = existsSync(realFixtures) ? readdirSync(realFixtures).filter((name) => name.endsWith(".json")).sort() : [];
for (const name of realNames) {
  const schema = UISchemaSchema.parse(JSON.parse(readFileSync(new URL(name, realFixtures), "utf8")));
  const project = generateReactProject(schema);
  if (project.generatorVersion !== "3") fail(`${name}: expected generator v3 output`);
  for (const file of project.files) writeFileSync(join(target, ...file.path.split("/")), file.content);
  const validated = buildRunnableExportPlan(project.files, name);
  if (!validated.ok) fail(`${name}: the export plan was rejected by the validator (${validated.code})`);
  rmSync(join(target, "dist"), { recursive: true, force: true });
  run(`npm run build (${name})`, ["run", "build"]);
  if (!existsSync(join(target, "dist", "index.html"))) fail(`${name}: the build produced no dist/index.html (folder kept at ${target})`);
}

console.log(`\nOK: the exported project installs and builds, Tailwind emitted the generated utilities, and ${realNames.length} real fixture(s) build with generator v3.`);
if (keep) console.log(`Kept at ${target} (run "npm run dev" there).`);
else rmSync(root, { recursive: true, force: true });
