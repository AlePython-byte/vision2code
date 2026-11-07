import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  PREVIEW_IFRAME_CSP, PREVIEW_MESSAGE_SOURCE, PREVIEW_SANDBOX, createPreviewHandshake,
} from "../src/features/preview/previewDocument.ts";

// Pins the configuration the preview isolation relies on (docs/preview-sandbox-security.md). Changing any of these
// means re-reading that document and re-running `npm run probe:preview-ipc` on Windows.

const tauriDir = new URL("../src-tauri/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, tauriDir), "utf8");

test("the preview frame keeps an opaque origin: allow-scripts only", () => {
  // Tauri treats every registered custom scheme (http://v2cpreview.localhost) as a LOCAL origin, so a same-origin
  // preview frame would be judged like the app itself by the ACL. The opaque origin makes its IPC Origin "null".
  assert.deepEqual(PREVIEW_SANDBOX.split(/\s+/), ["allow-scripts"]);
});

test("the preview CSP (meta and header) forbids network, forms, frames and plugins", () => {
  const header = /pub const PREVIEW_CSP: &str = "([^"]+)";/.exec(read("src/preview.rs"))?.[1] ?? "";
  for (const policy of [PREVIEW_IFRAME_CSP, header]) {
    for (const directive of ["default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'"]) {
      assert.ok(policy.includes(directive), `${directive} in ${policy}`);
    }
    assert.doesNotMatch(policy, /ipc\.localhost|ipc:|https?:\/\/\*|\s\*(\s|;|$)/);
  }
});

test("no global Tauri object, no isolation/dangerous switches and a local-only main window", () => {
  const config = JSON.parse(read("tauri.conf.json"));
  assert.notEqual(config.app.withGlobalTauri, true, "window.__TAURI__ must stay off");
  const security = config.app.security ?? {};
  for (const key of Object.keys(security)) assert.ok(["csp"].includes(key), `unexpected app.security.${key}`);
  assert.equal(config.app.windows.length, 1);
  assert.equal(config.app.windows[0].url ?? "index.html", "index.html", "the window loads the bundled app, never a remote URL");
  assert.match(security.csp, /frame-src http:\/\/v2cpreview\.localhost v2cpreview:\/\/localhost(;|$)/);
});

test("one capability, for the main window, with no remote URLs", () => {
  assert.deepEqual(readdirSync(new URL("capabilities/", tauriDir)), ["default.json"]);
  const capability = JSON.parse(read("capabilities/default.json"));
  assert.deepEqual(capability.windows, ["main"]);
  assert.equal(capability.webviews, undefined);
  assert.equal(capability.remote, undefined);
});

test("the app listens to window messages in one place only, and that handler filters by the frame window", () => {
  const sources: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir));
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = readFileSync(new URL(entry.name, dir), "utf8");
        if (/addEventListener\(\s*["']message["']|\.onmessage\s*=/.test(text)) sources.push(entry.name);
      }
    }
  };
  walk(new URL("../src/", import.meta.url));
  assert.deepEqual(sources, ["PreviewPanel.tsx"], "a new message listener needs the same source check (see the security doc)");
});

test("hostile messages from the frame cannot do more than ask for its own document or report started", () => {
  const statuses: string[] = [];
  let delivered = 0;
  const frame = {};
  const handshake = createPreviewHandshake({
    frameWindow: () => frame, deliver: () => { delivered++; }, onStatus: (status) => statuses.push(status),
    schedule: () => 0, cancel: () => {},
  });
  const hostile: unknown[] = [
    { cmd: "get_vault_key", callback: 1, error: 2, payload: {}, __TAURI_INVOKE_KEY__: "guess" },
    "__TAURI_ISOLATION_READY__",
    { payload: { contentType: "application/json", nonce: [1], payload: [1] } },
    { source: "v2c-host", type: "render", html: "<p>x</p>" },
    { source: PREVIEW_MESSAGE_SOURCE, type: "render", html: "<p>x</p>" },
    { source: PREVIEW_MESSAGE_SOURCE, type: "get_vault_key" },
    null, 42, [PREVIEW_MESSAGE_SOURCE, "started"],
  ];
  for (const data of hostile) handshake.receive({ source: frame, data });
  assert.equal(delivered, 0);
  assert.deepEqual(statuses, ["LOADING"]);
  // The two real messages only re-send the frame its own document and flip the status.
  handshake.receive({ source: frame, data: { source: PREVIEW_MESSAGE_SOURCE, type: "ready" } });
  handshake.receive({ source: frame, data: { source: PREVIEW_MESSAGE_SOURCE, type: "started" } });
  assert.equal(delivered, 1);
  assert.deepEqual(statuses, ["LOADING", "STARTED"]);
});
