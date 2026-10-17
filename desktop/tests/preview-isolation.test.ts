import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import * as previewDocument from "../src/features/preview/previewDocument.ts";
import * as previewTypes from "../src/features/preview/previewTypes.ts";
import * as previewInput from "../src/features/preview/previewInput.ts";
import * as previewPresentation from "../src/features/preview/previewPresentation.ts";
import { createPreviewModel, type PreviewModel } from "../src/features/preview/previewModel.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { en, es } from "../src/features/preferences/resources.ts";

const {
  buildPreviewDocument, createPreviewHandshake, PREVIEW_HOST_SOURCE, PREVIEW_IFRAME_CSP, PREVIEW_MESSAGE_SOURCE,
  PREVIEW_SANDBOX, PREVIEW_SCHEME, PREVIEW_START_TIMEOUT_MS, PREVIEW_STARTED_SIGNAL, previewFrameUrl,
} = previewDocument;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const conf = JSON.parse(read("../src-tauri/tauri.conf.json")) as { app: { security: { csp: string } } };
const rust = read("../src-tauri/src/preview.rs");
const directives = (csp: string) => new Map(csp.split(";").map((part) => part.trim().split(/\s+/)).filter((p) => p[0]).map(([name, ...sources]) => [name!, sources]));
const app = directives(conf.app.security.csp);

test("the app's CSP stays strict: no inline or eval script, connect-src unchanged, only the preview origin may be framed", () => {
  const scripts = app.get("script-src") ?? app.get("default-src") ?? [];
  assert.ok(!scripts.includes("'unsafe-inline'") && !scripts.includes("'unsafe-eval'"), "script-src gains nothing");
  assert.deepEqual(app.get("default-src"), ["'self'"]);
  assert.deepEqual(app.get("connect-src"), ["ipc:", "http://ipc.localhost", "http://localhost:3000", "http://127.0.0.1:3000", "https://xynjksbysfbdowifssoz.supabase.co"],
    "no network origin was added");
  assert.deepEqual(app.get("frame-src"), [`http://${PREVIEW_SCHEME}.localhost`, `${PREVIEW_SCHEME}://localhost`],
    "the preview origin, as Windows/Android and macOS/Linux spell it; nothing else can be framed");
  assert.deepEqual(app.get("img-src"), ["'self'", "blob:", "data:", "asset:", "http://asset.localhost"], "data: for Monaco's decorations");
  assert.deepEqual([...app.keys()], ["default-src", "style-src", "worker-src", "font-src", "img-src", "connect-src", "frame-src"]);
});

test("the frame loads the preview origin inside Tauri and srcdoc in a plain browser", () => {
  assert.equal(previewFrameUrl(undefined), null);
  assert.equal(previewFrameUrl({ navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Edg/155" } }), null, "a browser without Tauri keeps srcdoc");
  const tauri = (userAgent: string) => ({ __TAURI_INTERNALS__: {}, navigator: { userAgent } });
  assert.equal(previewFrameUrl(tauri("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/155")), "http://v2cpreview.localhost/");
  assert.equal(previewFrameUrl(tauri("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")), "v2cpreview://localhost/");
  for (const url of [previewFrameUrl(tauri("Windows")), previewFrameUrl(tauri("Linux"))]) {
    assert.ok(app.get("frame-src")!.includes(new URL(url!).protocol === "http:" ? new URL(url!).origin : `${PREVIEW_SCHEME}://localhost`), url!);
  }
  assert.match(read("../src-tauri/src/lib.rs"), /\.register_uri_scheme_protocol\(preview::SCHEME, \|_ctx, request\| preview::respond\(&request\)\)/);
  assert.match(rust, /pub const SCHEME: &str = "v2cpreview";/);
});

function loadPanel(window?: Record<string, unknown>) {
  const source = read("../src/features/preview/PreviewPanel.tsx");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, unknown> = {};
  const require = createRequire(import.meta.url);
  const shims: Record<string, unknown> = {
    "lucide-react": lucide, "../preferences/useLabels": { useLabels: () => ({ t: i18n.t.bind(i18n) }) },
    "./previewDocument": previewDocument, "./previewTypes": previewTypes, "./previewInput": previewInput, "./previewPresentation": previewPresentation,
  };
  runInNewContext(code, { exports, require: (id: string) => id in shims ? shims[id] : require(id), ...(window ? { window } : {}) });
  return exports as { PreviewPanel: ComponentType<{ model: PreviewModel }>; PreviewNotStarted: ComponentType<{ onRetry: () => void }> };
}
async function renderedSuccess(window?: Record<string, unknown>) {
  const model = createPreviewModel();
  model.setProject({ generatorVersion: "4", files: [{ path: "src/App.tsx", language: "tsx", content: "export default function App() { return <main>Hola</main>; }" }] } as never);
  await model.render();
  assert.equal(model.getSnapshot().status, "SUCCESS");
  return renderToStaticMarkup(createElement(loadPanel(window).PreviewPanel, { model }));
}

test("the frame is sandboxed with allow-scripts only, in both modes; Tauri mode loads the preview origin, not srcdoc", async () => {
  await i18n.changeLanguage("es");
  assert.equal(PREVIEW_SANDBOX, "allow-scripts");
  const browser = await renderedSuccess();
  assert.match(browser, /<iframe[^>]*sandbox="allow-scripts"[^>]*referrerPolicy="no-referrer"[^>]*srcDoc="/i);
  const tauri = await renderedSuccess({ __TAURI_INTERNALS__: {}, navigator: { userAgent: "Windows NT 10.0" } });
  const frame = tauri.match(/<iframe[^>]*>/)?.[0] ?? "";
  assert.match(frame, /sandbox="allow-scripts"/);
  assert.match(frame, /src="http:\/\/v2cpreview\.localhost\/"/);
  assert.doesNotMatch(frame, /srcdoc|allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/i);
});

test("the preview document's CSP: nothing but inline script and style, data:/blob: images, data: fonts, no network; same as the Rust header", () => {
  const policy = directives(PREVIEW_IFRAME_CSP);
  assert.deepEqual(policy.get("default-src"), ["'none'"]);
  assert.deepEqual(policy.get("script-src"), ["'unsafe-inline'"]);
  assert.deepEqual(policy.get("style-src"), ["'unsafe-inline'"]);
  assert.deepEqual(policy.get("img-src"), ["data:", "blob:"]);
  assert.deepEqual(policy.get("font-src"), ["data:"]);
  assert.deepEqual(policy.get("connect-src"), ["'none'"], "no network at all");
  assert.doesNotMatch(PREVIEW_IFRAME_CSP, /unsafe-eval|https?:|\*/);
  const header = /pub const PREVIEW_CSP: &str = "([^"]+)";/.exec(rust)?.[1] ?? "";
  assert.equal(header.replace(/; frame-ancestors [^;]+$/, ""), PREVIEW_IFRAME_CSP, "the header served by Rust is the same policy (+ frame-ancestors)");
  assert.match(header, /frame-ancestors http:\/\/tauri\.localhost https:\/\/tauri\.localhost tauri:\/\/localhost http:\/\/localhost:1420 http:\/\/127\.0\.0\.1:1420$/);
  // The Rust bootstrap speaks the same protocol as the host.
  assert.match(rust, new RegExp(`data.source !== "${PREVIEW_HOST_SOURCE}" \\|\\| data.type !== "render"`));
  assert.match(rust, new RegExp(`source: "${PREVIEW_MESSAGE_SOURCE}", type: "ready"`));
  // The document reports that its scripts run, right after the runtime and before the project's own code.
  const html = buildPreviewDocument({ css: "", script: "/*project*/" });
  assert.ok(html.includes(`content="${PREVIEW_IFRAME_CSP}"`));
  const signal = html.indexOf(PREVIEW_STARTED_SIGNAL);
  assert.ok(signal > html.indexOf("'use strict'") && signal < html.indexOf("/*project*/"));
});

function fakeTimers() {
  const pending = new Map<number, { at: number; callback: () => void }>();
  let now = 0, next = 0;
  return {
    schedule: (callback: () => void, ms: number) => { pending.set(++next, { at: now + ms, callback }); return next; },
    cancel: (handle: unknown) => { pending.delete(handle as number); },
    advance(ms: number) { now += ms; for (const [id, timer] of [...pending]) if (timer.at <= now) { pending.delete(id); timer.callback(); } },
    size: () => pending.size,
  };
}

test("no start signal within the timeout makes the frame FAILED instead of an empty canvas marked active", () => {
  const timers = fakeTimers();
  const statuses: string[] = [];
  const frame = {};
  createPreviewHandshake({ frameWindow: () => frame, onStatus: (status) => statuses.push(status), schedule: timers.schedule, cancel: timers.cancel });
  timers.advance(PREVIEW_START_TIMEOUT_MS - 1);
  assert.deepEqual(statuses, ["LOADING"]);
  timers.advance(1);
  assert.deepEqual(statuses, ["LOADING", "FAILED"]);
});

test("only messages from the frame's own window count; ready delivers the document, started cancels the timeout", () => {
  const timers = fakeTimers();
  const statuses: string[] = [];
  let delivered = 0;
  const frame = {};
  const handshake = createPreviewHandshake({ frameWindow: () => frame, deliver: () => { delivered++; }, onStatus: (status) => statuses.push(status),
    schedule: timers.schedule, cancel: timers.cancel });
  const ready = { source: PREVIEW_MESSAGE_SOURCE, type: "ready" }, started = { source: PREVIEW_MESSAGE_SOURCE, type: "started" };
  handshake.receive({ source: {}, data: started });                     // another window: ignored
  handshake.receive({ source: null, data: started });                   // no source: ignored
  handshake.receive({ source: frame, data: { source: "other", type: "started" } });
  handshake.receive({ source: frame, data: "started" });
  assert.deepEqual(statuses, ["LOADING"]);
  handshake.receive({ source: frame, data: ready });
  assert.equal(delivered, 1, "the document is handed over once the frame asks for it");
  handshake.receive({ source: frame, data: started });
  assert.deepEqual(statuses, ["LOADING", "STARTED"]);
  assert.equal(timers.size(), 0, "the timeout is cancelled");
  timers.advance(PREVIEW_START_TIMEOUT_MS * 2);
  assert.deepEqual(statuses, ["LOADING", "STARTED"]);

  // srcdoc mode has nothing to deliver; dispose stops everything.
  const quiet: string[] = [];
  const srcdoc = createPreviewHandshake({ frameWindow: () => frame, onStatus: (status) => quiet.push(status), schedule: timers.schedule, cancel: timers.cancel });
  srcdoc.receive({ source: frame, data: ready });
  srcdoc.dispose();
  timers.advance(PREVIEW_START_TIMEOUT_MS * 2);
  assert.deepEqual(quiet, ["LOADING"], "a disposed handshake never reports FAILED");
});

test("the not-started state is a visible alert with a retry, in Spanish and English", async () => {
  const { PreviewNotStarted } = loadPanel();
  for (const language of ["es", "en"] as const) {
    await i18n.changeLanguage(language);
    const html = renderToStaticMarkup(createElement(PreviewNotStarted, { onRetry() {} }));
    const strings = language === "es" ? es : en;
    assert.match(html, /role="alert"/);
    assert.ok(html.includes(strings.previewNotStartedTitle) && html.includes(strings.previewNotStartedBody.split(".")[0]!));
    assert.match(html, /ERR_PREVIEW_NOT_STARTED/);
    assert.ok(html.includes(strings.previewRetry));
  }
  await i18n.changeLanguage("es");
  const panel = read("../src/features/preview/PreviewPanel.tsx");
  assert.match(panel, /const frameFailed = Boolean\(showFrame\) && frameStatus === "FAILED";/);
  assert.match(panel, /previewStatus\$\{frameFailed \? "ERROR" : state\.status\}/, "the header no longer says Active over a frame that never started");
});
