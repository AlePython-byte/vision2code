/**
 * Development-only probe: can code running in the live preview reach the Tauri IPC?
 *
 *   npm run probe:preview-ipc
 *
 * It starts the real native app with `tauri dev` under a throwaway identifier
 * (`com.vision2code.desktop.probe`: its own app data folder, WebView profile and keyring service name, so the
 * installed app's and the dev app's keyring entry, vault and session are never read or written) and points its
 * window at a tiny host page served here instead of the app. That host page embeds the preview exactly like
 * `PreviewPanel` does in Tauri (`<iframe sandbox="allow-scripts">` on `http://v2cpreview.localhost/`, the bootstrap
 * from `preview.rs`, a document built by `buildPreviewDocument`) and the document's own script tries every channel.
 *
 * Only OUTCOMES are recorded (resolved / rejected / timeout, true / false, a canary hit): a value returned by a command
 * is never read, printed or stored. The frame never calls `get_vault_key` (it would create a keyring entry); it calls
 * `get_vault_path` (read-only) and `lifecycle_log`, which share the same capability, window and origin decision.
 * `lifecycle_log` is the Rust-side witness: with `VISION2CODE_DEBUG_LIFECYCLE=1` an accepted call appends a line to the
 * probe's own `lifecycle.log`, so a command that ran but answered into the main frame (the postMessage path does that)
 * is still detected. The main frame is the positive control: its calls MUST resolve and MUST reach the log.
 *
 * Exit code 0 when every preview vector is blocked and the control worked, 1 otherwise. Windows only (the scheme URL
 * and the WebView2 behaviour under test). Not part of `npm test`; it compiles and opens a native window.
 * This is dev mode: working rule 8 still asks for the manual check in the packaged app (docs/preview-sandbox-security.md).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPreviewDocument } from "../desktop/src/features/preview/previewDocument.ts";

const PROBE_IDENTIFIER = "com.vision2code.desktop.probe";
const PORT = 1420; // the preview's frame-ancestors only accepts the app origins, and localhost:1420 is the dev one
const ORIGIN = `http://localhost:${PORT}`;
const CONTROL_EVENT = "vault:init:start"; // logged by the main frame (positive control)
const FRAME_EVENT = "page:hide"; // logged only if a preview frame reached a command
const TOTAL_TIMEOUT_MS = 15 * 60_000; // first compile of the dev binary can be slow

if (process.platform !== "win32") {
  console.error("probe:preview-ipc runs on Windows only (WebView2 + http://v2cpreview.localhost).");
  process.exit(2);
}

const desktop = fileURLToPath(new URL("../desktop/", import.meta.url));
const dataDir = join(process.env.LOCALAPPDATA ?? "", PROBE_IDENTIFIER);
const logPath = join(dataDir, "lifecycle.log");
if (existsSync(logPath)) rmSync(logPath); // the probe's own file, never the app's

/** Runs inside the preview document (and again after the frame navigates itself to a page without the preview CSP). */
const FRAME_PROBE = String.raw`
(async function () {
  var phase = location.protocol + "//" + location.host === "${ORIGIN}" ? "navigated" : "preview";
  var r = {};
  function send(type, data) { try { parent.postMessage({ source: "v2c-probe", phase: phase, type: type, data: data }, "*"); } catch (e) {} }
  function outcome(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      setTimeout(function () { if (!done) { done = true; resolve("timeout"); } }, ms);
      Promise.resolve().then(function () { return promise(); }).then(
        function () { if (!done) { done = true; resolve("resolved"); } },
        function () { if (!done) { done = true; resolve("rejected"); } });
    });
  }
  function blocked(fn) { try { fn(); return false; } catch (e) { return true; } }
  var internals = window.__TAURI_INTERNALS__;
  r.origin = String(window.origin);
  r.hasTauriInternals = typeof internals !== "undefined";
  r.hasInvoke = !!(internals && typeof internals.invoke === "function");
  r.hasGlobalTauri = typeof window.__TAURI__ !== "undefined";
  r.hasWryIpc = !!(window.ipc && typeof window.ipc.postMessage === "function");
  r.hasChromeWebview = !!(window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === "function");
  r.parentDomBlocked = blocked(function () { return parent.document.title; });
  r.parentStorageBlocked = blocked(function () { return parent.localStorage.length; });
  r.ownStorageBlocked = blocked(function () { return window.localStorage.length; });
  r.cookieBlocked = blocked(function () { return document.cookie; });
  // IPC through Tauri's own invoke (custom protocol first, postMessage fallback). Values are discarded.
  r.invokeGetVaultPath = r.hasInvoke ? await outcome(function () { return internals.invoke("get_vault_path"); }, 4000) : "unavailable";
  r.invokeLifecycleLog = r.hasInvoke ? await outcome(function () { return internals.invoke("lifecycle_log", { event: "${FRAME_EVENT}" }); }, 4000) : "unavailable";
  r.invokeStronghold = r.hasInvoke ? await outcome(function () { return internals.invoke("plugin:stronghold|save", { snapshotPath: "" }); }, 4000) : "unavailable";
  // Raw channels, without the invoke key (the frame must not be able to learn it).
  r.fetchIpcProtocol = await outcome(function () { return fetch("http://ipc.localhost/get_vault_path", { method: "POST", body: "{}" }); }, 4000);
  r.rawWryPostMessage = blocked(function () {
    window.ipc.postMessage(JSON.stringify({ cmd: "lifecycle_log", callback: 1, error: 2, payload: { event: "${FRAME_EVENT}" }, __TAURI_INVOKE_KEY__: "guess" }));
  }) ? "threw" : "sent";
  r.rawChromeWebviewPostMessage = blocked(function () {
    window.chrome.webview.postMessage(JSON.stringify({ cmd: "lifecycle_log", callback: 1, error: 2, payload: { event: "${FRAME_EVENT}" }, __TAURI_INVOKE_KEY__: "guess" }));
  }) ? "threw" : "sent";
  // Network canaries: a hit on the probe server means the request left the frame.
  r.fetchCanary = await outcome(function () { return fetch("${ORIGIN}/canary/fetch-" + phase, { mode: "no-cors" }); }, 3000);
  r.imgCanary = await outcome(function () { return new Promise(function (ok, ko) { var i = new Image(); i.onload = ok; i.onerror = ko; i.src = "${ORIGIN}/canary/img-" + phase; }); }, 3000);
  r.wsCanary = await outcome(function () { return new Promise(function (ok, ko) { var s = new WebSocket("ws://localhost:${PORT}/canary/ws-" + phase); s.onopen = ok; s.onerror = ko; }); }, 3000);
  r.windowOpenBlocked = (function () { try { return window.open("${ORIGIN}/canary/popup-" + phase) === null; } catch (e) { return true; } })();
  r.formSubmit = blocked(function () {
    var f = document.createElement("form"); f.method = "POST"; f.action = "${ORIGIN}/canary/form-" + phase; f.target = "_blank";
    document.body.appendChild(f); f.submit();
  }) ? "threw" : "submitted";
  // Hostile messages to the host: Tauri-shaped, isolation-shaped and preview-shaped. None may trigger a command.
  [
    { cmd: "get_vault_key", callback: 1, error: 2, payload: {}, __TAURI_INVOKE_KEY__: "guess" },
    "__TAURI_ISOLATION_READY__",
    { payload: { contentType: "application/json", nonce: [1], payload: [1] } },
    { source: "v2c-host", type: "render", html: "<p>hostile</p>" },
    { source: "v2c-preview", type: "ready" },
    { source: "v2c-preview", type: "started" },
  ].forEach(function (message) { try { parent.postMessage(message, "*"); } catch (e) {} });
  r.hostileMessagesSent = 6;
  send("results", r);
  // Top navigation must be impossible (no allow-top-navigation). A canary hit means it happened.
  var topNav = blocked(function () { top.location.href = "${ORIGIN}/canary/top-" + phase; }) ? "threw" : "no-throw";
  send("topNavigation", topNav);
  // Last: navigate this frame to a page WITHOUT the preview CSP (self-navigation is allowed by any sandbox).
  if (phase === "preview") setTimeout(function () { location.href = "${ORIGIN}/frame-nocsp"; }, 500);
  else send("done", true);
})();
`;

const HOST_PAGE = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><title>Vision2Code preview IPC probe</title></head>
<body style="font:14px sans-serif">
<p>Vision2Code preview IPC probe. This window closes by itself.</p>
<script>
(async function () {
  var report = { control: {}, phases: {}, topNavigation: {} };
  var internals = window.__TAURI_INTERNALS__;
  function outcome(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      setTimeout(function () { if (!done) { done = true; resolve("timeout"); } }, ms);
      promise().then(function () { if (!done) { done = true; resolve("resolved"); } }, function () { if (!done) { done = true; resolve("rejected"); } });
    });
  }
  report.control.hasInvoke = !!(internals && typeof internals.invoke === "function");
  if (report.control.hasInvoke) {
    report.control.getVaultPath = await outcome(function () { return internals.invoke("get_vault_path"); }, 8000);
    report.control.lifecycleLog = await outcome(function () { return internals.invoke("lifecycle_log", { event: "${CONTROL_EVENT}" }); }, 8000);
    report.control.missingCommand = await outcome(function () { return internals.invoke("v2c_probe_missing_command"); }, 8000);
  }
  var frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.src = "http://v2cpreview.localhost/";
  var html = ${JSON.stringify(buildPreviewDocument({ css: "", script: FRAME_PROBE })).replace(/<\//g, "<\\/")};
  var finish;
  var finished = new Promise(function (resolve) { finish = resolve; });
  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow) return;
    var data = event.data;
    if (data && data.source === "v2c-preview" && data.type === "ready" && !report.delivered) {
      report.delivered = true;
      frame.contentWindow.postMessage({ source: "v2c-host", type: "render", html: html }, "*");
    }
    if (data && data.source === "v2c-probe") {
      if (data.type === "results") report.phases[data.phase] = data.data;
      if (data.type === "topNavigation") report.topNavigation[data.phase] = data.data;
      if (data.type === "done") finish();
    }
  });
  document.body.appendChild(frame);
  setTimeout(finish, 60000);
  await finished;
  await new Promise(function (resolve) { setTimeout(resolve, 2000); }); // let late postMessage-path calls land in the log
  await fetch("/result", { method: "POST", body: JSON.stringify(report) });
})();
</script></body></html>`;

const FRAME_NOCSP_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${FRAME_PROBE}</script></body></html>`;

// Abort if anything already answers on the port (IPv4 or IPv6): the window would load THAT page (for example the real
// app from a forgotten Vite), which calls get_vault_key at start-up, instead of this probe.
for (const host of ["127.0.0.1", "::1"]) {
  const busy = await new Promise<boolean>((resolve) => {
    const socket = connect({ host, port: PORT });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
  if (busy) {
    console.error(`probe: something already listens on ${host}:${PORT}; stop it (npm run dev?) and retry.`);
    process.exit(2);
  }
}

const canaries: string[] = [];
let resolveReport!: (report: unknown) => void;
const reportReceived = new Promise<unknown>((resolve) => { resolveReport = resolve; });

const server = createServer((request, response) => {
  const url = request.url ?? "/";
  if (url.startsWith("/canary/")) {
    canaries.push(url.slice("/canary/".length));
    response.writeHead(204).end();
    return;
  }
  if (request.method === "POST" && url === "/result") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      response.writeHead(204).end();
      try { resolveReport(JSON.parse(body)); } catch { resolveReport(null); }
    });
    return;
  }
  if (url === "/" || url === "/index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(HOST_PAGE);
    return;
  }
  if (url === "/frame-nocsp") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(FRAME_NOCSP_PAGE);
    return;
  }
  response.writeHead(404).end();
});
server.on("upgrade", (request, socket) => { canaries.push((request.url ?? "").replace("/canary/", "")); socket.destroy(); });
await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen({ port: PORT, host: "::", ipv6Only: false }, resolve); });

// Same base config as `npm run desktop:dev`, but its own identifier and this server instead of Vite.
const configDir = mkdtempSync(join(tmpdir(), "v2c-probe-"));
const configPath = join(configDir, "tauri.probe.conf.json");
writeFileSync(configPath, JSON.stringify({ identifier: PROBE_IDENTIFIER, build: { beforeDevCommand: "", devUrl: `${ORIGIN}/` } }));
console.log(`probe: starting the app under ${PROBE_IDENTIFIER} (first compile may take minutes)...`);
const child = spawn("npx.cmd", ["tauri", "dev", "--no-watch", "--config", `"${configPath}"`], {
  cwd: desktop,
  env: { ...process.env, VISION2CODE_DEBUG_LIFECYCLE: "1" },
  stdio: ["ignore", "ignore", "pipe"],
  shell: true,
});
let stderrTail = "";
child.stderr?.on("data", (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString()).slice(-4000); });

const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TOTAL_TIMEOUT_MS));
const report = (await Promise.race([reportReceived, timeout])) as {
  control: Record<string, unknown>; phases: Record<string, Record<string, unknown>>; topNavigation: Record<string, unknown>;
} | null;

if (child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
server.close();
rmSync(configDir, { recursive: true, force: true });

if (!report) {
  console.error("probe: no report (timeout). Last stderr lines:\n" + stderrTail.split("\n").slice(-15).join("\n"));
  process.exit(1);
}

const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
const witness = { controlReachedRust: log.includes(`client:${CONTROL_EVENT}`), frameReachedRust: log.includes(`client:${FRAME_EVENT}`) };
const unexpected = canaries.filter((name) => !name.startsWith("fetch-navigated") && !name.startsWith("img-navigated") && !name.startsWith("ws-navigated"));

console.log(JSON.stringify({ control: report.control, phases: report.phases, topNavigation: report.topNavigation, canaries, witness }, null, 2));

const failures: string[] = [];
if (report.control.getVaultPath !== "resolved" || report.control.lifecycleLog !== "resolved") failures.push("control: the main frame could not invoke (probe invalid)");
if (!witness.controlReachedRust) failures.push("control: the lifecycle witness did not record the main frame (probe invalid)");
if (witness.frameReachedRust) failures.push("a preview frame reached a Rust command (lifecycle witness)");
for (const [phase, results] of Object.entries(report.phases)) {
  for (const key of ["invokeGetVaultPath", "invokeLifecycleLog", "invokeStronghold", "fetchIpcProtocol"]) {
    if (results[key] === "resolved") failures.push(`${phase}: ${key} resolved`);
  }
  for (const key of ["parentDomBlocked", "parentStorageBlocked", "windowOpenBlocked"]) {
    if (results[key] !== true) failures.push(`${phase}: ${key} is ${String(results[key])}`);
  }
}
if (!report.phases.preview) failures.push("the preview phase did not report");
if (unexpected.length > 0) failures.push(`requests left the CSP-protected preview: ${unexpected.join(", ")}`);
console.log(failures.length === 0 ? "probe: every preview vector is blocked; the control worked." : "probe: FAILURES\n- " + failures.join("\n- "));
// The probe's own folder (WebView profile, salt, log); never the app's. Kept only if Windows still holds a file.
try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch {
  console.log(`probe: could not remove ${dataDir}; it belongs to the probe only and is safe to delete.`);
}
process.exit(failures.length === 0 ? 0 : 1);
