import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { generateReactProject } from "../src/features/generation/generateReactProject.ts";
import { createGenerationArtifact } from "../src/features/generation/generationArtifact.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import type { PreviewEngine } from "../src/features/preview/previewTypes.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { createToastModel } from "../src/features/feedback/toastModel.ts";
import {
  EXPORT_TOAST_KEY, createExportModel, exportErrorMessage, type NativeExport, type NativeExportRequest, type NativeExportResult,
} from "../src/features/export/exportModel.ts";
import {
  FALLBACK_EXPORT_FOLDER_NAME, MAX_EXPORT_FILES, MAX_EXPORT_FILE_BYTES, MAX_EXPORT_FOLDER_NAME_CHARS, MAX_EXPORT_PATH_CHARS,
  MAX_EXPORT_SEGMENT_CHARS, MAX_EXPORT_TOTAL_BYTES, buildExportPlan, sanitizeExportFolderName, validateExportPath, workingCopyFiles,
  type ExportErrorCode,
} from "../src/features/export/exportPlan.ts";
import { createTauriExport } from "../src/features/export/tauriExport.ts";
import { createWorkspaceServices } from "../src/features/workspace/workspaceServices.ts";
import { deferred, projectA, screenshot, summaryA, summaryB, uiSchemaFixture } from "./generation-fixtures.ts";
import { driver, findAll, html, text, type Node } from "./ui-harness.ts";

const engine: PreviewEngine = { kind: "placeholder", render: async () => ({ documentHtml: "<html></html>" }) };
const file = (path: string, content = "") => ({ path, content });
const rust = readFileSync(new URL("../src-tauri/src/export.rs", import.meta.url), "utf8");
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---- buildExportPlan: the same rules as the native side ---------------------------------------

test("the TypeScript limits mirror the authoritative Rust constants", () => {
  const constant = (name: string) => Number(rust.match(new RegExp(`pub const ${name}: \\w+ = ([\\d_]+);`))?.[1]?.replaceAll("_", ""));
  assert.equal(MAX_EXPORT_FILES, constant("MAX_FILES"));
  assert.equal(MAX_EXPORT_FILE_BYTES, constant("MAX_FILE_BYTES"));
  assert.equal(MAX_EXPORT_TOTAL_BYTES, constant("MAX_TOTAL_BYTES"));
  assert.equal(MAX_EXPORT_PATH_CHARS, constant("MAX_PATH_CHARS"));
  assert.equal(MAX_EXPORT_SEGMENT_CHARS, constant("MAX_SEGMENT_CHARS"));
  assert.equal(MAX_EXPORT_FOLDER_NAME_CHARS, constant("MAX_FOLDER_NAME_CHARS"));
  assert.match(rust, new RegExp(`FALLBACK_FOLDER_NAME: &str = "${FALLBACK_EXPORT_FOLDER_NAME}"`));
});

test("generated project paths are accepted", () => {
  for (const path of ["src/App.tsx", "src/generated/GeneratedInterface.tsx", "package.json", ".gitignore", "a_b-c.d.ts"]) {
    assert.equal(validateExportPath(path), null, path);
  }
});

test("malicious and ambiguous paths are rejected", () => {
  const invalid = ["", "/etc/passwd", "//server/share/a.ts", "\\\\server\\share\\a", "src//a.ts", "src/", "./a.ts", "src/./a.ts",
    "../a.ts", "src/../../a.ts", "..", ".", "src\\a.ts", "C:/a.ts", "C:a.ts", "a.ts:stream", "a.ts::$DATA",
    "src/a\u0000.ts", "src/a\n.ts", "src/a\u007f.ts", "a b.ts", "src/á.ts", "src/a\u2215b.ts", "src/a\uff0fb.ts",
    "a<b.ts", "a>b.ts", "a\"b.ts", "a|b.ts", "a?b.ts", "a*b.ts",
    "CON", "con.tsx", "src/PRN.ts", "aux", "Nul.json", "src/com1.ts", "COM9", "lpt1.txt", "LPT9.tsx", "src/nul.d.ts",
    "src./a.ts", "src/a.", "a..", "src/name./x.ts"];
  for (const path of invalid) assert.equal(validateExportPath(path), "INVALID_PATH", JSON.stringify(path));
  for (const path of ["src/console.ts", "src/com10.ts", "src/auxiliary.ts"]) assert.equal(validateExportPath(path), null, path);
  assert.equal(validateExportPath("a".repeat(MAX_EXPORT_SEGMENT_CHARS + 1)), "PATH_TOO_LONG");
  assert.equal(validateExportPath(`${Array(16).fill("abcdefghij").join("/")}/x.ts`), "PATH_TOO_LONG");
  assert.equal(validateExportPath("a".repeat(MAX_EXPORT_SEGMENT_CHARS)), null);
});

test("duplicates are compared case-insensitively, and a file cannot also be a folder", () => {
  const code = (files: { path: string; content: string }[]) => { const plan = buildExportPlan(files, "Alpha"); return plan.ok ? null : plan.code; };
  assert.equal(code([file("src/App.tsx"), file("SRC/app.TSX")]), "DUPLICATE_PATH");
  assert.equal(code([file("src"), file("src/App.tsx")]), "DUPLICATE_PATH");
  assert.equal(code([file("Src/a.ts"), file("src")]), "DUPLICATE_PATH");
  assert.equal(code([file("src/App.tsx"), file("src/app.ts")]), null);
});

test("count, per-file and total UTF-8 size, and text-only content are bounded", () => {
  const code = (files: { path: string; content: string }[]) => { const plan = buildExportPlan(files, "Alpha"); return plan.ok ? null : plan.code; };
  assert.equal(code([]), "NO_FILES");
  const many = Array.from({ length: MAX_EXPORT_FILES + 1 }, (_, index) => file(`f${index}.ts`));
  assert.equal(code(many), "TOO_MANY_FILES");
  assert.equal(code(many.slice(0, MAX_EXPORT_FILES)), null);
  assert.equal(code([file("big.ts", "x".repeat(MAX_EXPORT_FILE_BYTES + 1))]), "TOO_LARGE");
  assert.equal(code([file("max.ts", "x".repeat(MAX_EXPORT_FILE_BYTES))]), null);
  // Bytes, not characters: "ñ" is two bytes in UTF-8.
  assert.equal(code([file("multi.ts", "ñ".repeat(MAX_EXPORT_FILE_BYTES / 2 + 1))]), "TOO_LARGE");
  const chunk = "x".repeat(MAX_EXPORT_FILE_BYTES);
  assert.equal(code(Array.from({ length: MAX_EXPORT_TOTAL_BYTES / MAX_EXPORT_FILE_BYTES + 1 }, (_, index) => file(`f${index}.ts`, chunk))), "TOO_LARGE");
  assert.equal(code([file("bin.ts", "a\u0000b")]), "INVALID_CONTENT");
  assert.equal(code([file("utf8.ts", "const saludo = \"¡hola! 🚀\";")]), null);
});

test("folder names are sanitized like the native side, with a fallback", () => {
  assert.equal(sanitizeExportFolderName("Mi Página: v2/beta"), "Mi-Página-v2-beta");
  assert.equal(sanitizeExportFolderName("  ..Dashboard..  "), "Dashboard");
  assert.equal(sanitizeExportFolderName("a<>:\"/\\|?*b"), "a-b");
  assert.equal(sanitizeExportFolderName(""), FALLBACK_EXPORT_FOLDER_NAME);
  assert.equal(sanitizeExportFolderName("   ...   "), FALLBACK_EXPORT_FOLDER_NAME);
  assert.equal(sanitizeExportFolderName("CON"), "CON-export");
  assert.equal(sanitizeExportFolderName("nul"), "nul-export");
  const long = sanitizeExportFolderName("proyecto ".repeat(20));
  assert.ok([...long].length <= MAX_EXPORT_FOLDER_NAME_CHARS && !long.endsWith("-"), long);
  // The same expectations are asserted in Rust (sanitizes_folder_names).
  for (const expected of ["\"Mi-Página-v2-beta\"", "\"Dashboard\"", "\"a-b\"", "\"CON-export\"", "\"nul-export\""]) assert.ok(rust.includes(expected), expected);
  const plan = buildExportPlan([file("src/App.tsx")], null);
  assert.ok(plan.ok && plan.plan.suggestedName === FALLBACK_EXPORT_FOLDER_NAME && plan.plan.folderName === FALLBACK_EXPORT_FOLDER_NAME);
});

test("the working copy includes Monaco drafts", () => {
  const editor = createEditorModel();
  editor.setProject(generateReactProject(uiSchemaFixture));
  const before = workingCopyFiles(editor.getSnapshot());
  editor.edit("// edited in Monaco");
  const after = workingCopyFiles(editor.getSnapshot());
  const active = editor.getSnapshot().activePath!;
  assert.equal(after.find((item) => item.path === active)?.content, "// edited in Monaco");
  assert.notEqual(before.find((item) => item.path === active)?.content, "// edited in Monaco");
  assert.deepEqual(after.map((item) => item.path), before.map((item) => item.path));
});

// ---- Export model through the workspace services ---------------------------------------------

function api() {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace("/api/v1", "");
    if ((init?.method ?? "GET") === "GET" && path === "/projects") return Response.json([summaryA, summaryB]);
    if (path === `/projects/${projectA}`) return Response.json({ id: projectA, name: "Alpha", createdAt: summaryA.createdAt, updatedAt: summaryA.updatedAt, generations: [] });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

function workspace(nativeExport: NativeExport) {
  return createWorkspaceServices({
    getAccessToken: async () => "token", onUnauthorized: () => {}, baseUrl: "http://localhost:3000/api/v1", transport: api(),
    editorModel: createEditorModel(), previewModel: createPreviewModel(engine), nativeExport,
  });
}

function recorder(answer: (request: NativeExportRequest) => Promise<NativeExportResult> | NativeExportResult = () => ({ status: "EXPORTED", folderName: "Alpha", fileCount: 2 })) {
  const requests: NativeExportRequest[] = [];
  const nativeExport: NativeExport = async (request) => { requests.push(request); return answer(request); };
  return { requests, nativeExport };
}

async function withResult(nativeExport: NativeExport, targetProjectId: string | null = null) {
  const services = workspace(nativeExport);
  await services.projectsModel.loadProjects();
  await services.generationSession.complete(createGenerationArtifact({
    uiSchema: uiSchemaFixture, generatedProject: generateReactProject(uiSchemaFixture), fidelity: "balanced", screenshot: screenshot(), targetProjectId,
  }));
  return services;
}
const exportToast = (services: ReturnType<typeof workspace>) => services.toasts.getSnapshot().toasts.find((item) => item.key === EXPORT_TOAST_KEY) ?? null;

test("export sends the edited working copy, not the stored generation, and changes nothing else", async () => {
  const native = recorder();
  const services = await withResult(native.nativeExport);
  services.editorModel.edit("// my edit");
  const editor = services.editorModel.getSnapshot();
  const preview = services.previewModel.getSnapshot();
  const session = services.generationSession.getSnapshot();
  const result = await services.exporter.exportWorkingCopy();
  assert.equal(result.status, "EXPORTED");
  const sent = native.requests[0]!;
  assert.equal(sent.files.find((item) => item.path === editor.activePath)?.content, "// my edit");
  assert.notEqual(session.artifact?.generatedProject.files.find((item) => item.path === editor.activePath)?.content, "// my edit");
  assert.deepEqual(Object.keys(sent).sort(), ["files", "suggestedName"], "no destination path is ever sent");
  assert.ok(sent.files.every((item) => Object.keys(item).sort().join() === "content,path"));
  assert.equal(services.editorModel.getSnapshot(), editor, "editor untouched (drafts kept)");
  assert.equal(services.previewModel.getSnapshot(), preview);
  assert.equal(services.generationSession.getSnapshot(), session);
});

test("the folder is suggested from the result's project, with a fallback for local-only results", async () => {
  const linked = recorder();
  await (await withResult(linked.nativeExport, projectA)).exporter.exportWorkingCopy();
  assert.equal(linked.requests[0]?.suggestedName, "Alpha");
  const local = recorder();
  await (await withResult(local.nativeExport, null)).exporter.exportWorkingCopy();
  assert.equal(local.requests[0]?.suggestedName, FALLBACK_EXPORT_FOLDER_NAME, "works without persistence");
});

test("states: exporting blocks a double click; success shows a transient toast with the folder name", async () => {
  const pending = deferred<NativeExportResult>();
  const native = recorder(() => pending.promise);
  const services = await withResult(native.nativeExport);
  const first = services.exporter.exportWorkingCopy();
  assert.equal(services.exporter.getSnapshot().status, "EXPORTING");
  assert.equal(services.exporter.exportWorkingCopy(), first, "a second click shares the running export");
  pending.resolve({ status: "EXPORTED", folderName: "Alpha-2", fileCount: 2 });
  await first;
  assert.equal(native.requests.length, 1);
  assert.equal(services.exporter.getSnapshot().status, "IDLE");
  const notice = exportToast(services);
  assert.equal(notice?.tone, "success");
  assert.equal(notice?.persistent, false);
  assert.equal(notice?.message, "exportDone");
  assert.deepEqual(notice?.messageParams, { folder: "Alpha-2", count: 2 });
});

test("cancelling the native dialog shows no toast; failures show a persistent, plain-language error", async () => {
  const cancelled = await withResult(recorder(() => ({ status: "CANCELLED" })).nativeExport);
  assert.equal((await cancelled.exporter.exportWorkingCopy()).status, "CANCELLED");
  assert.equal(exportToast(cancelled), null);
  for (const [code, message] of [["PERMISSION_DENIED", "exportFailedPermission"], ["IO_ERROR", "exportFailed"], ["DESTINATION_INVALID", "exportFailedDestination"], ["UNAVAILABLE", "exportFailedUnavailable"]] as const) {
    const services = await withResult(recorder(() => ({ status: "FAILED", code })).nativeExport);
    await services.exporter.exportWorkingCopy();
    const notice = exportToast(services);
    assert.equal(notice?.tone, "error");
    assert.equal(notice?.persistent, true);
    assert.equal(notice?.message, message);
  }
  const thrown = await withResult(async () => { throw new Error("bridge exploded"); });
  assert.deepEqual(await thrown.exporter.exportWorkingCopy(), { status: "FAILED", code: "IO_ERROR" });
  assert.equal(thrown.exporter.getSnapshot().status, "IDLE");
});

test("every error code maps to an ES/EN message key; raw codes never reach the user", () => {
  const codes: ExportErrorCode[] = ["NO_FILES", "INVALID_PATH", "PATH_TOO_LONG", "DUPLICATE_PATH", "INVALID_CONTENT", "TOO_MANY_FILES",
    "TOO_LARGE", "DESTINATION_INVALID", "PERMISSION_DENIED", "IO_ERROR", "UNAVAILABLE"];
  for (const code of codes) {
    const key = exportErrorMessage(code) as keyof typeof es;
    assert.ok(es[key] && en[key as keyof typeof en], code);
    assert.doesNotMatch(String(es[key]) + String(en[key as keyof typeof en]), /[A-Z]{3,}_[A-Z]/, "no raw code in the copy");
  }
  for (const code of codes.filter((item) => item !== "UNAVAILABLE")) assert.ok(rust.includes(`${code.split("_").map((part) => part[0] + part.slice(1).toLowerCase()).join("")},`), `Rust has ${code}`);
});

test("an invalid working copy never reaches the native side", async () => {
  const native = recorder();
  const services = workspace(native.nativeExport);
  services.editorModel.setProject({ target: "react-tailwind", generatorVersion: "1", files: [{ path: "../escape.tsx", language: "typescript", content: "x" }] });
  assert.deepEqual(await services.exporter.exportWorkingCopy(), { status: "FAILED", code: "INVALID_PATH" });
  assert.equal(native.requests.length, 0);
  assert.equal(exportToast(services)?.message, "exportFailedInvalid");
});

test("sign-out or expiry during an export drops the late answer and its toast", async () => {
  const pending = deferred<NativeExportResult>();
  const services = await withResult(recorder(() => pending.promise).nativeExport);
  const running = services.exporter.exportWorkingCopy();
  services.reset();
  assert.equal(services.exporter.getSnapshot().status, "IDLE");
  pending.resolve({ status: "EXPORTED", folderName: "Alpha", fileCount: 2 });
  assert.deepEqual(await running, { status: "STALE" });
  assert.equal(exportToast(services), null);
});

test("the export model can be used standalone and only reads the editor", async () => {
  const toasts = createToastModel();
  const editor = createEditorModel();
  editor.setProject(generateReactProject(uiSchemaFixture));
  const before = editor.getSnapshot();
  const model = createExportModel({ editor, projectName: () => "Beta", nativeExport: async () => ({ status: "CANCELLED" }), toasts });
  await model.exportWorkingCopy();
  assert.equal(editor.getSnapshot(), before);
});

// ---- Native bridge ----------------------------------------------------------------------------

test("the bridge calls only export_project with paths-free arguments and validates the answer", async () => {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  let answer: unknown = { status: "EXPORTED", folderName: "Alpha", fileCount: 1 };
  const bridge = createTauriExport(async (command, args) => { calls.push({ command, args }); return answer; });
  assert.deepEqual(await bridge({ files: [file("src/App.tsx", "x")], suggestedName: "Alpha" }), answer);
  assert.deepEqual(calls, [{ command: "export_project", args: { files: [{ path: "src/App.tsx", content: "x" }], suggestedName: "Alpha" } }]);
  for (const malformed of [{ status: "EXPORTED", folderName: "C:\\Users\\me\\Alpha", fileCount: 1, path: "C:\\Users" }, { status: "WAT" }, "C:\\secret", null,
    { status: "FAILED", code: "SOMETHING_ELSE" }]) {
    answer = malformed;
    assert.deepEqual(await bridge({ files: [file("a.ts")], suggestedName: "A" }), { status: "FAILED", code: "IO_ERROR" }, JSON.stringify(malformed));
  }
  const failing = createTauriExport(async () => { throw new Error("C:\\Users\\me\\secret path"); });
  assert.deepEqual(await failing({ files: [file("a.ts")], suggestedName: "A" }), { status: "FAILED", code: "IO_ERROR" });
  assert.deepEqual(await createTauriExport(null, () => false)({ files: [file("a.ts")], suggestedName: "A" }), { status: "FAILED", code: "UNAVAILABLE" });
});

// ---- UI ---------------------------------------------------------------------------------------

function buttonProps(project: boolean) {
  const editor = createEditorModel();
  if (project) editor.setProject(generateReactProject(uiSchemaFixture));
  let clicks = 0;
  const exporter = { ...createExportModel({ editor, projectName: () => null, nativeExport: async () => ({ status: "CANCELLED" }), toasts: createToastModel() }) };
  const counted = { ...exporter, exportWorkingCopy: () => { clicks++; return exporter.exportWorkingCopy(); } };
  return { editor, exporter: counted, clicks: () => clicks };
}

test("Export button (ES/EN): secondary action, disabled without a result with an explanation", () => {
  for (const [language, labels] of [["es", es], ["en", en]] as const) {
    const enabled = html("export/ExportButton.tsx", "ExportButton", language, buttonProps(true));
    assert.ok(enabled.includes(`class="action-button" title="${labels.exportHint}"`), language);
    assert.ok(enabled.includes(labels.export) && enabled.includes(labels.exportHintShort));
    assert.doesNotMatch(enabled, /primary-action/, "one accent per view: Export is secondary");
    const disabled = html("export/ExportButton.tsx", "ExportButton", language, buttonProps(false));
    assert.match(disabled, /<button type="button" class="action-button" disabled=""/);
    assert.ok(disabled.includes(`title="${labels.exportNoResult}"`));
  }
});

test("Export button: aria-busy, disabled and a busy label while exporting; a click starts one export", async () => {
  const props = buttonProps(true);
  const pending = deferred<NativeExportResult>();
  const exporter = createExportModel({ editor: props.editor, projectName: () => null, nativeExport: () => pending.promise, toasts: createToastModel() });
  const d = driver("export/ExportButton.tsx", "ExportButton", "en");
  const button = () => findAll(d.render({ exporter, editor: props.editor }), (node: Node) => node.type === "button")[0];
  button().props.onClick();
  assert.equal(button().props["aria-busy"], true);
  assert.equal(button().props.disabled, true);
  assert.ok(text(button()).includes(en.exporting));
  pending.resolve({ status: "CANCELLED" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(button().props.disabled, false);
  assert.equal(button().props["aria-busy"], undefined);
  const counted = buttonProps(true);
  findAll(d.render({ exporter: counted.exporter, editor: counted.editor }), (node: Node) => node.type === "button")[0].props.onClick();
  assert.equal(counted.clicks(), 1);
});

test("the button sits next to Copy code through a slot; the shell keeps shim-friendly imports", () => {
  // Rendered right after the Copy code button inside the toolbar actions.
  assert.match(read("../src/features/editor/EditorWorkspace.tsx"), /\{t\("copy"\)\}<\/button>\s*\{actions\}\s*<button className="action-button" disabled=\{!state\.drafts\.size\}/);
  const shell = read("../src/features/workspace/ApplicationShell.tsx");
  assert.match(shell, /actions=\{codeActions\}/);
  assert.doesNotMatch(shell, /import .*(ExportButton|features\/export|\.\.\/export)/);
  assert.match(read("../src/App.tsx"), /codeActions=\{<ExportButton exporter=\{services\.exporter\} editor=\{services\.editorModel\} \/>\}/);
});

test("the toast viewport interpolates the folder name", () => {
  const toasts = createToastModel();
  toasts.show({ key: EXPORT_TOAST_KEY, tone: "success", eyebrow: "toastEyebrowExport", message: "exportDone", messageParams: { folder: "Alpha-2", count: 2 }, persistent: true });
  const out = html("feedback/ToastViewport.tsx", "ToastViewport", "es", { model: toasts });
  assert.ok(out.includes("Exportado a la carpeta «Alpha-2» (2 archivos)."), out);
});

// ---- Isolation and native permissions ---------------------------------------------------------

test("export code never imports AI, analysis, the generator, auth, or a toast implementation", () => {
  for (const name of ["exportPlan.ts", "exportModel.ts", "tauriExport.ts", "ExportButton.tsx"]) {
    const source = read(`../src/features/export/${name}`);
    for (const [, typeOnly, path] of source.matchAll(/^import (type )?.* from "([^"]+)";$/gm)) {
      assert.doesNotMatch(path!, /analysis|generation|generateReact|openai|\/auth|projects/, `${name} → ${path}`);
      if (/feedback|editor/.test(path!)) assert.equal(typeOnly, "type ", `${name} may only reference ${path} types`);
    }
  }
  assert.equal([...read("../src/features/export/exportPlan.ts").matchAll(/^import /gm)].length, 0, "the plan is dependency-free");
});

test("the webview gets no filesystem or dialog permission; only the validated command writes", () => {
  const capability = JSON.parse(read("../src-tauri/capabilities/default.json")) as { permissions: string[] };
  assert.deepEqual(capability.permissions.filter((permission) => !permission.startsWith("stronghold:")), [], "no fs:, dialog: or other new permission");
  const config = read("../src-tauri/tauri.conf.json");
  assert.doesNotMatch(config, /"fs"|"scope"|assetProtocol/);
  const lib = read("../src-tauri/src/lib.rs");
  assert.match(lib, /generate_handler!\[get_vault_key, get_vault_path, export_project\]/);
  assert.match(lib, /\.plugin\(tauri_plugin_dialog::init\(\)\)/);
  assert.doesNotMatch(lib, /tauri_plugin_fs/, "the fs plugin is never registered");
  assert.doesNotMatch(lib, /fn export_project\([^)]*(path|dir|destination)\s*:/i, "the command takes no destination from the webview");
  assert.match(rust, /create_new\(true\)/);
  assert.doesNotMatch(rust.split("#[cfg(test)]")[0]!, /create_dir_all\(|remove_dir_all\(/, "never create_dir_all / remove_dir_all calls outside tests");
});
