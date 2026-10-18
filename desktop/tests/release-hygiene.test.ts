import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { requireLocalSource } from "./source-loader.ts";
import * as lucide from "lucide-react";
import { createSessionPersistenceStore, MemoryAuthStorage } from "../src/features/auth/authStorage.ts";
import { TauriStrongholdAuthStorage } from "../src/features/auth/tauriStrongholdStorage.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { preferences } from "../src/features/preferences/preferences.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { SESSION_NOTICE_PAIRS, ratioFor, readThemeTokens } from "../../scripts/contrast.mts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const conf = JSON.parse(read("../src-tauri/tauri.conf.json")) as { identifier: string; bundle: { targets: unknown; windows?: { nsis?: { installMode?: string } } } };
const devConf = JSON.parse(read("../src-tauri/tauri.dev.conf.json")) as Record<string, unknown>;
const rootScripts = (JSON.parse(read("../../package.json")) as { scripts: Record<string, string> }).scripts;

test("the only installer is NSIS, installed per user without administrator rights", () => {
  assert.deepEqual(conf.bundle.targets, ["nsis"]);
  assert.equal(conf.bundle.windows?.nsis?.installMode, "currentUser");
  assert.doesNotMatch(JSON.stringify(conf.bundle), /msi|wix/i);
});

test("desktop:dev merges a dev identifier; the release keeps its own and the build does not use the override", () => {
  assert.equal(conf.identifier, "com.vision2code.desktop");
  assert.deepEqual(Object.keys(devConf).filter((key) => key !== "$schema"), ["identifier"], "the override changes nothing but the identifier");
  assert.equal(devConf.identifier, "com.vision2code.desktop.dev");
  assert.notEqual(devConf.identifier, conf.identifier);
  assert.match(rootScripts["desktop:dev"]!, /-- dev --config src-tauri\/tauri\.dev\.conf\.json$/);
  assert.doesNotMatch(rootScripts["desktop:build"]!, /--config/);
});

test("the keyring entry follows the identifier, like the vault file and the WebView profile", () => {
  const rust = read("../src-tauri/src/lib.rs");
  assert.match(rust, /fn keyring_service\(identifier: &str\) -> String \{\s*if identifier == RELEASE_IDENTIFIER \{ RELEASE_KEYRING_SERVICE\.to_string\(\) \} else \{ identifier\.to_string\(\) \}/);
  assert.match(rust, /get_or_create_vault_master_key\(&keyring_service\(&app\.config\(\)\.identifier\)\)/);
  assert.match(rust, /const RELEASE_IDENTIFIER: &str = "com\.vision2code\.desktop";/);
  assert.match(rust, /const RELEASE_KEYRING_SERVICE: &str = "vision2code";/, "installed apps keep the entry they already have");
  assert.doesNotMatch(rust, /Entry::new\("vision2code"/, "no hardcoded service left");
  assert.equal(RELEASE_ID_MATCHES_CONF(rust), true);
  // The vault path and salt come from app_local_data_dir, which Tauri derives from the identifier.
  assert.equal((rust.match(/app_local_data_dir\(\)/g) ?? []).length >= 3, true);
});
const RELEASE_ID_MATCHES_CONF = (rust: string) => rust.includes(`"${conf.identifier}"`);

function vaultBackend(fail: boolean) {
  const store = new Map<string, Uint8Array>();
  const client = { getStore: () => ({
    get: async (key: string) => store.get(key) ?? null,
    insert: async (key: string, value: number[]) => { store.set(key, Uint8Array.from(value)); },
    remove: async (key: string) => { const old = store.get(key) ?? null; store.delete(key); return old; },
  }) };
  return { load: async () => {
    if (fail) throw new Error("keyring unavailable");
    return { loadClient: async () => client, createClient: async () => client, save: async () => {} };
  } };
}
const storage = (fail: boolean) => new TauriStrongholdAuthStorage({ strongholdBackend: vaultBackend(fail) as never,
  vaultKeyProvider: async () => "k".repeat(64), vaultPathProvider: async () => "C:/vault.hold" });

test("the ephemeral-session state is unknown until the choice is made, then true only for the memory fallback, and observers are told once", async () => {
  const unavailable = storage(true);
  const seen: boolean[] = [];
  const unsubscribe = unavailable.subscribeStorageStatus((() => { seen.push(unavailable.isSessionEphemeral()); }));
  assert.equal(unavailable.isSessionEphemeral(), false, "before initialization nothing is claimed (no false alarm at startup)");
  await unavailable.getItem("sb-session");
  await unavailable.getItem("sb-session");
  assert.equal(unavailable.isSessionEphemeral(), true);
  assert.deepEqual(seen, [true], "notified exactly once, with the final answer");
  unsubscribe();

  const working = storage(false);
  const quiet: boolean[] = [];
  working.subscribeStorageStatus(() => quiet.push(working.isSessionEphemeral()));
  await working.getItem("sb-session");
  assert.equal(working.isSessionEphemeral(), false);
  assert.deepEqual(quiet, [false]);

  const memory = new MemoryAuthStorage();
  assert.equal(memory.isSessionEphemeral(), true, "the browser fallback never persists");
  const store = createSessionPersistenceStore(unavailable);
  assert.equal(store.getSnapshot(), true);
  assert.equal(typeof store.subscribe(() => {}), "function");
  assert.equal(createSessionPersistenceStore({ getItem: () => null, setItem() {}, removeItem() {} }).getSnapshot(), false, "a storage that says nothing is not alarming");
});

function load(file: string, overrides: Record<string, unknown> = {}) {
  const source = read("../src/features/" + file);
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, { exports, require: (name: string) => {
    if (name in overrides) return overrides[name];
    if (name === "lucide-react") return lucide;
    if (name === "./preferences" || name === "../preferences/preferences") return { preferences };
    if (name.endsWith("/useLabels")) return { useLabels: () => ({ t: i18n.t.bind(i18n) }) };
    if (name.endsWith("/previewModel")) return { createPreviewModel: () => ({ setProject() {}, render: () => Promise.resolve(), subscribe: () => () => {}, getSnapshot: () => ({ status: "EMPTY" }) }) };
    if (name.endsWith("/previewSync")) return { syncEditorToPreview: () => ({ dispose() {}, flush: async () => {}, isPending: () => false }) };
    if (name.endsWith("/PreviewPanel")) return { PreviewPanel: () => null };
    if (name.endsWith("/ProjectVault")) return { ProjectVault: () => React.createElement("main", { id: "project-vault" }) };
    const local = requireLocalSource(file, name, require);
    if (local) return local;
    return require(name);
  } });
  return exports;
}
function shell(ephemeral: boolean | undefined) {
  const { ApplicationShell } = load("workspace/ApplicationShell.tsx", {
    "./Workspace": { Workspace: () => React.createElement("div", { id: "workspace" }) },
    "../editor/EditorWorkspace": { EditorWorkspace: () => null },
    "../settings/SettingsScreen": { SettingsScreen: ({ sessionNotSaved }: { sessionNotSaved?: boolean }) => React.createElement("main", { id: "settings-workspace", "data-notice": String(sessionNotSaved) }) },
    "../editor/editorModel": { createEditorModel: () => ({}) },
  });
  return renderToStaticMarkup(React.createElement(ApplicationShell, {
    onLogin() {}, user: { id: "u", email: "ana@example.com", emailVerified: true },
    ...(ephemeral === undefined ? {} : { sessionPersistence: { subscribe: () => () => {}, getSnapshot: () => ephemeral } }),
  }));
}

test("the rail shows a subtle status badge only when the session will not be saved, in Spanish and English", async () => {
  for (const [language, text] of [["es", es.sessionNotSaved], ["en", en.sessionNotSaved]] as const) {
    await i18n.changeLanguage(language);
    const on = shell(true);
    assert.match(on, new RegExp(`<span class="account-session-badge" role="status" title="${text}">.*<span class="sr-only">${text}</span>`), language);
    assert.doesNotMatch(shell(false), /account-session-badge/);
    assert.doesNotMatch(shell(undefined), /account-session-badge/, "no store, no claim");
  }
  assert.equal(es.sessionNotSaved, "Tu sesión no se guardará al cerrar la app");
  assert.equal(en.sessionNotSaved, "Your session will not be saved when you close the app");
  await i18n.changeLanguage("es");
  assert.match(shell(true), /<svg class="generated-avatar generated-avatar-md avatar-palette-\d" viewBox="0 0 64 64" aria-hidden="true"/, "the generated avatar is still the badge's anchor");
  // The same value reaches Settings, and App builds the store from the default auth storage.
  assert.match(read("../src/features/workspace/ApplicationShell.tsx"), /<SettingsScreen sessionNotSaved=\{sessionNotSaved\} user=\{user \?\? null\} \/>/);
  assert.match(read("../src/App.tsx"), /createSessionPersistenceStore\(getDefaultAuthStorage\(\)\)/);
  assert.match(read("../src/App.tsx"), /sessionPersistence=\{sessionPersistence\}/);
});

test("Settings shows the same notice as a non-blocking role=status, with an explanatory line, and nothing otherwise", async () => {
  const { SettingsScreen } = load("settings/SettingsScreen.tsx");
  preferences.set({ theme: "light", language: "es" });
  for (const [language, strings] of [["es", es], ["en", en]] as const) {
    await i18n.changeLanguage(language);
    const html = renderToStaticMarkup(React.createElement(SettingsScreen, { sessionNotSaved: true }));
    assert.match(html, new RegExp(`<div class="session-notice" role="status">.*<p class="session-notice-title">${strings.sessionNotSaved}</p><p class="session-notice-help">${strings.sessionNotSavedHelp}</p>`));
    assert.doesNotMatch(html, /role="alert"|aria-modal|<dialog/, "discreet: never an alert or a modal");
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(SettingsScreen)), /session-notice/);
  }
  await i18n.changeLanguage("es");
  preferences.set({ theme: "light", language: "es" });
});

test("the notice keeps its contrast in both themes (icon 3:1, sentences 4.5:1)", () => {
  const themes = readThemeTokens(read("../src/styles/foundation.css"));
  for (const name of ["light", "dark"] as const) {
    for (const pair of SESSION_NOTICE_PAIRS) {
      const ratio = ratioFor(themes[name], pair.foreground, pair.background);
      assert.ok(ratio >= pair.minimum, `${name}: ${pair.label} is ${ratio.toFixed(2)}:1`);
    }
  }
  const css = read("../src/styles/theme.css");
  assert.match(css, /\.account-session-badge \{[^}]*border: 1px solid var\(--color-warning\);[^}]*color: var\(--color-warning\);/);
  assert.match(css, /\.session-notice \{[^}]*border-left: 3px solid var\(--color-warning\);[^}]*color: var\(--color-ink\);/);
});
