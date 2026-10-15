import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createToastModel } from "../src/features/feedback/toastModel.ts";
import { createExportModel, type NativeExportRequest } from "../src/features/export/exportModel.ts";
import {
  MAX_EXPORT_FILES, MAX_EXPORT_FILE_BYTES, MAX_EXPORT_TOTAL_BYTES, validateExportPath,
} from "../src/features/export/exportPlan.ts";
import {
  EXPORT_SCAFFOLD_DEPENDENCIES, EXPORT_SCAFFOLD_DEV_DEPENDENCIES, EXPORT_SCAFFOLD_VERSION, FALLBACK_PACKAGE_NAME,
  buildRunnableExportPlan, buildScaffold, sanitizePackageName, withScaffold,
} from "../src/features/export/exportScaffold.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { uiSchemaFixture } from "./generation-fixtures.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const rust = read("../src-tauri/src/export.rs");
const generated = generateReactProject(uiSchemaFixture).files.map(({ path, content }) => ({ path, content }));
const scaffoldPaths = buildScaffold("Alpha").map((file) => file.path);
const file = (path: string, content = "") => ({ path, content });

/** Version the app resolves today (hoisted workspace install or the desktop's own node_modules). */
function installed(name: string): string {
  for (const base of ["../node_modules/", "../../node_modules/"]) {
    const url = new URL(`${base}${name}/package.json`, import.meta.url);
    if (existsSync(url)) return (JSON.parse(readFileSync(url, "utf8")) as { version: string }).version;
  }
  throw new Error(`${name} is not installed`);
}

// ---- Fixed templates ---------------------------------------------------------------------------

test("the scaffold is the fixed set of runnable-project files, in a stable order", () => {
  assert.deepEqual(scaffoldPaths, [
    "package.json", "index.html", "src/main.tsx", "src/index.css", "src/vite-env.d.ts",
    "vite.config.ts", "tsconfig.json", "README.md", ".gitignore",
  ]);
  assert.deepEqual(buildScaffold("Alpha"), buildScaffold("Alpha"), "pure and deterministic");
  assert.equal(EXPORT_SCAFFOLD_VERSION, "1");
  assert.ok(Object.isFrozen(buildScaffold("Alpha")));
});

test("templates wire React, Vite and Tailwind the way the generated code needs", () => {
  const files = new Map(buildScaffold("Alpha").map((item) => [item.path, item.content]));
  assert.equal(files.get("src/index.css"), '@import "tailwindcss";\n');
  assert.match(files.get("vite.config.ts")!, /plugins: \[react\(\), tailwindcss\(\)\]/);
  assert.match(files.get("src/main.tsx")!, /import App from "\.\/App";/);
  assert.match(files.get("src/main.tsx")!, /import "\.\/index\.css";/);
  assert.match(files.get("index.html")!, /<script type="module" src="\/src\/main\.tsx"><\/script>/);
  const pkg = JSON.parse(files.get("package.json")!);
  assert.equal(pkg.type, "module");
  assert.deepEqual(Object.keys(pkg.scripts), ["dev", "build", "preview"]);
  assert.equal(pkg.scripts.dev, "vite");
  assert.equal(pkg.vision2code.scaffoldVersion, EXPORT_SCAFFOLD_VERSION);
  assert.match(files.get("README.md")!, /npm install\nnpm run dev/);
  assert.equal(files.get(".gitignore"), "node_modules\ndist\n*.local\n");
  for (const content of files.values()) assert.ok(!content.includes("\0") && content.endsWith("\n"));
});

test("dependency versions are exact (no ranges) and match what the desktop app installs", () => {
  const pkg = JSON.parse(buildScaffold("Alpha")[0]!.content) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  assert.deepEqual(pkg.dependencies, EXPORT_SCAFFOLD_DEPENDENCIES);
  assert.deepEqual(pkg.devDependencies, EXPORT_SCAFFOLD_DEV_DEPENDENCIES);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["react", "react-dom"]);
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(),
    ["@tailwindcss/vite", "@types/react", "@types/react-dom", "@vitejs/plugin-react", "tailwindcss", "typescript", "vite"]);
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name, version] of Object.entries(all)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name}@${version} must be an exact version`);
    assert.equal(version, installed(name), `${name} must match the version the desktop app builds with`);
  }
  // Each pin also satisfies the range the desktop declares, so the two cannot drift apart silently.
  const desktop = JSON.parse(read("../package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const declared = { ...desktop.dependencies, ...desktop.devDependencies };
  for (const [name, version] of Object.entries(all)) {
    const range = declared[name];
    assert.ok(range, `${name} is declared by the desktop`);
    const [major, minor] = version.split(".");
    assert.ok(range.startsWith("~") ? range.slice(1).startsWith(`${major}.${minor}.`) : range.slice(1).startsWith(`${major}.`), `${name}: ${version} vs ${range}`);
  }
});

test("package names are sanitized: lowercase, URL-safe, accent-free, bounded, with a fallback", () => {
  assert.equal(sanitizePackageName("Mi Página: v2/Beta"), "mi-pagina-v2-beta");
  assert.equal(sanitizePackageName("  ..Dashboard__  "), "dashboard");
  assert.equal(sanitizePackageName("@scope/Name"), "scope-name");
  assert.equal(sanitizePackageName("Proyecto 日本語"), "proyecto");
  assert.equal(sanitizePackageName("日本語"), FALLBACK_PACKAGE_NAME);
  assert.equal(sanitizePackageName(""), FALLBACK_PACKAGE_NAME);
  assert.equal(sanitizePackageName(null), FALLBACK_PACKAGE_NAME);
  assert.equal(sanitizePackageName("  ...  "), FALLBACK_PACKAGE_NAME);
  const long = sanitizePackageName("proyecto ".repeat(30));
  assert.ok(long.length <= 50 && !long.endsWith("-"), long);
  for (const name of ["CON", "a<b>c", "Hello World!", "x".repeat(300), "..", "A_B-c.d"]) {
    assert.match(sanitizePackageName(name), /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/, name);
  }
  assert.equal(JSON.parse(buildScaffold("Mi Página")[0]!.content).name, "mi-pagina");
});

test("titles are escaped in HTML and cleaned of control characters", () => {
  const files = new Map(buildScaffold('<script>alert("x")</script> & "co"\u0000\n').map((item) => [item.path, item.content]));
  const html = files.get("index.html")!;
  assert.ok(html.includes("<title>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;co&quot;</title>"), html);
  assert.ok(!html.includes("<script>alert"));
  assert.match(files.get("README.md")!.split("\n")[0]!, /^# .*alert/);
  assert.ok(!files.get("README.md")!.includes("\0"));
  assert.match(buildScaffold(null).find((item) => item.path === "index.html")!.content, /<title>Vision2Code<\/title>/);
});

// ---- Merge: generated files win ---------------------------------------------------------------

test("a scaffold path that the project already has is omitted, reported, and never overwrites", () => {
  const mine = [file("src/App.tsx", "app"), file("package.json", "{\"mine\":true}"), file("README.md", "# mine"), file("SRC/Index.CSS", "css")];
  const merged = withScaffold(mine, "Alpha");
  assert.deepEqual([...merged.omitted].sort(), ["README.md", "package.json", "src/index.css"], "case-insensitive");
  assert.equal(merged.files.find((item) => item.path === "package.json")?.content, "{\"mine\":true}");
  assert.equal(merged.files.filter((item) => item.path.toLowerCase() === "src/index.css").length, 1);
  assert.equal(merged.scaffoldFileCount, 9 - 3);
  assert.equal(merged.files.length, mine.length + merged.scaffoldFileCount);

  const planned = buildRunnableExportPlan(mine, "Alpha");
  assert.ok(planned.ok);
  assert.deepEqual([...planned.plan.scaffold.omitted].sort(), ["README.md", "package.json", "src/index.css"]);
  assert.equal(planned.plan.scaffold.fileCount, 6);
  assert.equal(planned.plan.files.length, 10);
});

// ---- The plan goes through the same validator and limits --------------------------------------

test("the generated project plus the scaffold passes the TypeScript validator", () => {
  const planned = buildRunnableExportPlan(generated, "Mi Proyecto");
  assert.ok(planned.ok);
  assert.deepEqual(planned.plan.files.map((item) => item.path), [...generated.map((item) => item.path), ...scaffoldPaths]);
  assert.equal(planned.plan.folderName, "Mi-Proyecto");
  assert.equal(planned.plan.scaffold.version, EXPORT_SCAFFOLD_VERSION);
  for (const path of scaffoldPaths) assert.equal(validateExportPath(path), null, path);
});

test("the scaffold paths are exactly the ones the Rust tests accept as the authoritative validator", () => {
  const block = rust.match(/fn accepts_scaffold_paths\(\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(block, "a Rust test covers the scaffold paths");
  const listed = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
  const rustPaths = listed.filter((value) => !value.includes(" ") && !value.startsWith("accepts"));
  for (const path of scaffoldPaths) assert.ok(rustPaths.includes(path), `${path} is validated by Rust`);
  // The native limits the whole plan must stay inside are the same constants TypeScript mirrors.
  const constant = (name: string) => Number(rust.match(new RegExp(`pub const ${name}: \\w+ = ([\\d_]+);`))?.[1]?.replaceAll("_", ""));
  assert.equal(constant("MAX_FILES"), MAX_EXPORT_FILES);
  assert.equal(constant("MAX_FILE_BYTES"), MAX_EXPORT_FILE_BYTES);
  assert.equal(constant("MAX_TOTAL_BYTES"), MAX_EXPORT_TOTAL_BYTES);
});

test("the scaffold counts against the file-count and size limits; it is never exported alone", () => {
  const code = (files: { path: string; content: string }[]) => { const plan = buildRunnableExportPlan(files, "Alpha"); return plan.ok ? null : plan.code; };
  const scaffold = buildScaffold("Alpha").length;
  const fit = Array.from({ length: MAX_EXPORT_FILES - scaffold }, (_, index) => file(`f${index}.ts`));
  assert.equal(code(fit), null, "count at the limit with the scaffold");
  assert.equal(code([...fit, file("extra.ts")]), "TOO_MANY_FILES");
  assert.equal(code([]), "NO_FILES");
  const chunk = "x".repeat(MAX_EXPORT_FILE_BYTES);
  const five = Array.from({ length: MAX_EXPORT_TOTAL_BYTES / MAX_EXPORT_FILE_BYTES }, (_, index) => file(`big${index}.ts`, chunk));
  assert.equal(code(five), "TOO_LARGE", "5 MB of project plus the scaffold exceeds the 5 MB total");
  assert.equal(code(five.slice(0, 4)), null);
  assert.equal(code([file("../escape.ts", "x")]), "INVALID_PATH");
  assert.equal(code([file("src/App.tsx"), file("SRC/app.tsx")]), "DUPLICATE_PATH");
});

// ---- Integration ------------------------------------------------------------------------------

test("exporting sends the edited working copy plus the scaffold, and leaves the editor untouched", async () => {
  const editor = createEditorModel();
  editor.setProject(generateReactProject(uiSchemaFixture));
  editor.select("src/App.tsx");
  editor.edit("// edited App");
  const before = editor.getSnapshot();
  const requests: NativeExportRequest[] = [];
  const model = createExportModel({
    editor, projectName: () => "Alpha", toasts: createToastModel(),
    nativeExport: async (request) => { requests.push(request); return { status: "EXPORTED", folderName: "Alpha", fileCount: request.files.length }; },
  });
  assert.equal((await model.exportWorkingCopy()).status, "EXPORTED");
  const sent = requests[0]!;
  assert.equal(sent.files.length, 2 + 9);
  assert.equal(sent.files.find((item) => item.path === "src/App.tsx")?.content, "// edited App", "the edit wins");
  for (const path of scaffoldPaths) assert.ok(sent.files.some((item) => item.path === path), path);
  assert.equal(editor.getSnapshot(), before, "scaffold files never appear in the editor");
  assert.equal(editor.getSnapshot().files.length, 2);
});

test("the scaffold is the exporter's: the generator and contracts do not know it", () => {
  const generator = read("../src/features/generation/generateReactProject.ts");
  assert.doesNotMatch(generator, /scaffold|features\/export|\.\.\/export/i);
  assert.equal(generateReactProject(uiSchemaFixture).files.length, 2, "the generator output is unchanged");
  assert.doesNotMatch(read("../../packages/contracts/src/generated-project.ts"), /scaffold/i);
  const scaffold = read("../src/features/export/exportScaffold.ts");
  const imports = [...scaffold.matchAll(/^import (?:type )?.* from "([^"]+)";$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ["./exportPlan.ts"], "only the pure plan; no AI, generator, auth, toast or Tauri code");
});

test("the real-build verification is opt-in and not part of npm test", () => {
  const root = JSON.parse(read("../../package.json")) as { scripts: Record<string, string> };
  assert.match(root.scripts["verify:export-scaffold"]!, /scripts\/verify-export-scaffold\.mts/);
  assert.doesNotMatch(root.scripts.test!, /verify/);
  assert.doesNotMatch(JSON.parse(read("../package.json")).scripts.test, /verify/);
  assert.equal(existsSync(new URL("../../scripts/verify-export-scaffold.mts", import.meta.url)), true);
});

test("ES/EN copy says the folder is ready to run with npm, and the toast tells how to start", () => {
  assert.match(es.exportHint, /listo para ejecutar con npm/);
  assert.match(en.exportHint, /ready to run with npm/);
  for (const key of ["exportDone_one", "exportDone_other"] as const) {
    assert.match(es[key], /npm install.*npm run dev/);
    assert.match(en[key], /npm install.*npm run dev/);
  }
});
