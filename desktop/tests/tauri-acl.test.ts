import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const tauri = new URL("../src-tauri/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, tauri), "utf8");

const STRONGHOLD = [
  "stronghold:allow-initialize",
  "stronghold:allow-create-client",
  "stronghold:allow-load-client",
  "stronghold:allow-get-store-record",
  "stronghold:allow-save-store-record",
  "stronghold:allow-remove-store-record",
  "stronghold:allow-save",
];
const EXPECTED_COMMANDS = ["export_project", "get_vault_key", "get_vault_path"];
const allowOf = (command: string) => `allow-${command.replaceAll("_", "-")}`;

const lib = read("src/lib.rs");
const sources = readdirSync(new URL("src/", tauri)).filter((name) => name.endsWith(".rs")).map((name) => read(`src/${name}`)).join("\n");
const commandFns = [...sources.matchAll(/#\[tauri::command\][\s\S]*?\bfn\s+([a-z0-9_]+)/g)].map((match) => match[1]!).sort();
const handler = (/generate_handler!\[([^\]]*)\]/.exec(lib)?.[1] ?? "").split(",").map((name) => name.trim()).filter(Boolean).sort();
const manifest = (/const COMMANDS: &\[&str\] = &\[([^\]]*)\]/.exec(read("build.rs"))?.[1] ?? "")
  .split(",").map((name) => name.trim().replace(/^"|"$/g, "")).filter(Boolean).sort();
const capabilities = readdirSync(new URL("capabilities/", tauri)).map((name) => ({ name, json: JSON.parse(read(`capabilities/${name}`)) as Record<string, unknown> }));

test("every #[tauri::command] is registered and declared in the app manifest, and nothing else", () => {
  assert.deepEqual(commandFns, EXPECTED_COMMANDS, "a new command must be added here deliberately");
  assert.deepEqual(handler, commandFns, "generate_handler! lists exactly the commands");
  assert.deepEqual(manifest, commandFns, "build.rs declares exactly the commands in the AppManifest");
  assert.match(read("build.rs"), /\.app_manifest\(tauri_build::AppManifest::new\(\)\.commands\(COMMANDS\)\)/,
    "without the app manifest every command is allowed for any local window");
});

test("the only capability grants the Stronghold permissions and one allow-* per command, for the main window only", () => {
  assert.deepEqual(capabilities.map(({ name }) => name), ["default.json"]);
  const { json } = capabilities[0]!;
  assert.deepEqual(json.windows, ["main"]);
  assert.equal(json.webviews, undefined);
  assert.equal(json.remote, undefined, "no remote origin may reach the IPC");
  assert.equal(json.platforms, undefined);
  const permissions = json.permissions as unknown[];
  assert.ok(permissions.every((permission) => typeof permission === "string"), "no scoped permission objects");
  assert.deepEqual([...permissions].sort(), [...STRONGHOLD, ...EXPECTED_COMMANDS.map(allowOf)].sort());
});

test("tauri.conf.json defines no inline capabilities that would bypass capabilities/", () => {
  const config = JSON.parse(read("tauri.conf.json")) as { app: { security: Record<string, unknown> } };
  assert.equal(config.app.security.capabilities, undefined);
});
