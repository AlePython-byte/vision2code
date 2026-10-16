import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { AnalysisResponseSchema, OutputStackSchema } from "@vision2code/contracts";
import { AnalysisClientError, createAnalysisClient } from "../src/features/analysis/analysisClient.ts";
import { createAnalysisModel } from "../src/features/analysis/analysisModel.ts";
import * as generationProfileModule from "../src/features/analysis/generationProfileModel.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { en, es, messageKeys } from "../src/features/preferences/resources.ts";
import type { Screenshot } from "../src/features/screenshot/loadScreenshot.ts";

const uiSchema: unknown = JSON.parse(readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
const result = AnalysisResponseSchema.parse({ requestId: "quota-ok", uiSchema });
const screenshot = (): Screenshot => {
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "capture.png", { type: "image/png" });
  return { file, name: "capture.png", size: file.size, format: "PNG", width: 640, height: 480, url: "blob:test" };
};
const quotaBody = (retryAfterSeconds?: number) => ({ error: { code: "ANALYSIS_QUOTA_EXCEEDED", message: "mensaje del servidor", requestId: "req-quota",
  ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }) } });

function counting(responses: (() => Response | Promise<Response>)[]) {
  const state = { requests: 0, expired: 0 };
  const client = createAnalysisClient(undefined, async () => {
    const next = responses[Math.min(state.requests, responses.length - 1)]!;
    state.requests++;
    return next();
  }, { getAccessToken: async () => "token", onUnauthorized: () => { state.expired++; } });
  return { client, state };
}

test("the quota error is mapped with its wait, never expires the session and is never retried automatically", async () => {
  const { client, state } = counting([() => Response.json(quotaBody(120), { status: 429, headers: { "Retry-After": "120" } })]);
  const error = await client(screenshot(), new AbortController().signal, { fidelity: "precise" }).catch((reason: unknown) => reason);
  assert.ok(error instanceof AnalysisClientError);
  assert.equal(error.code, "ANALYSIS_QUOTA_EXCEEDED");
  assert.equal(error.retryAfterSeconds, 120);
  assert.equal(error.requestId, "req-quota");
  assert.equal(error.message, es.analysisQuotaExceeded, "a fixed localized message, never the server's text");
  assert.equal(messageKeys[error.message], "analysisQuotaExceeded");
  assert.equal(state.expired, 0, "a 429 is not a 401");
  assert.equal(state.requests, 1, "no automatic retry");
});

test("the provider's own 429 stays a different error, without a wait", async () => {
  const { client, state } = counting([() => Response.json({ error: { code: "AI_RATE_LIMITED", message: "x", requestId: "req-ai", retryAfterSeconds: 30 } }, { status: 429 })]);
  const error = await client(screenshot(), new AbortController().signal).catch((reason: unknown) => reason) as AnalysisClientError;
  assert.equal(error.code, "AI_RATE_LIMITED");
  assert.equal(error.retryAfterSeconds, null, "only our own limit carries a wait");
  assert.equal(state.expired, 0);
});

test("5xx and network failures still never expire the session; only a 401 does", async () => {
  const { client, state } = counting([
    () => Response.json({ error: { code: "AI_UNAVAILABLE", message: "x", requestId: "r1" } }, { status: 503 }),
    () => new Response("<html>bad gateway</html>", { status: 502 }),
    () => { throw new TypeError("network down"); },
    () => Response.json(quotaBody(), { status: 429 }),
    () => Response.json({ error: { code: "UNAUTHORIZED", message: "x", requestId: "r2" } }, { status: 401 }),
  ]);
  for (let index = 0; index < 4; index++) await assert.rejects(client(screenshot(), new AbortController().signal));
  assert.equal(state.expired, 0);
  await assert.rejects(client(screenshot(), new AbortController().signal), { code: "UNAUTHORIZED" });
  assert.equal(state.expired, 1);
});

test("the analysis model keeps the wait for the view and clears it on the next analysis", async () => {
  const { client, state } = counting([() => Response.json(quotaBody(45), { status: 429 }), () => Response.json(result)]);
  const model = createAnalysisModel(client);
  model.setScreenshot(screenshot());
  await model.analyze({ fidelity: "fast" });
  assert.equal(model.getSnapshot().status, "ERROR");
  assert.equal(model.getSnapshot().errorRetryAfterSeconds, 45);
  assert.equal(state.requests, 1, "the model does not retry by itself");
  await model.analyze({ fidelity: "fast" }); // the user presses Retry
  assert.equal(model.getSnapshot().status, "SUCCESS");
  assert.equal(model.getSnapshot().errorRetryAfterSeconds, null);
});

function captureConsole(state: Record<string, unknown>) {
  const source = readFileSync(new URL("../src/features/analysis/CaptureConsole.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  const overrides: Record<string, unknown> = {
    "./VisualFidelitySelector": { VisualFidelitySelector: () => null },
    "../screenshot/ScreenshotInput": { ScreenshotInput: () => null },
    "../screenshot/useScreenshot": { useScreenshot: () => ({ screenshot: null, status: "IDLE", error: null, selectFiles: () => {}, removeScreenshot: () => {} }) },
    "./useAnalysis": { useAnalysis: () => ({ state, model: { analyze: async () => {}, cancel: () => {}, setScreenshot: () => {} } }) },
  };
  runInNewContext(code, { exports, require: (name: string) => {
    if (name in overrides) return overrides[name];
    if (name.endsWith("/useLabels") || name === "./useLabels") return { useLabels: () => ({ t: i18n.t.bind(i18n), message: (value: string) => i18n.t(messageKeys[value] ?? "analysisFailure") }) };
    if (name.includes("generationProfileModel")) return generationProfileModule;
    if (name.includes("analysisModel")) return { canAnalyze: () => true };
    if (name === "@vision2code/contracts") return { OutputStackSchema, AnalysisResponseSchema };
    return require(name);
  } });
  return renderToStaticMarkup(React.createElement(exports.CaptureConsole, { onGenerated() {}, profileModel: generationProfileModule.createGenerationProfileModel() }));
}

test("the console tells how long to wait, in Spanish and English, and keeps Retry manual", async () => {
  const error = (errorRetryAfterSeconds: number | null) => ({ status: "ERROR", screenshot: null, result: null, error: es.analysisQuotaExceeded,
    errorRequestId: "req-quota", errorRetryAfterSeconds });
  try {
    await i18n.changeLanguage("es");
    assert.match(captureConsole(error(45)), /Podrás analizar de nuevo en 45 s\./);
    assert.match(captureConsole(error(121)), /Podrás analizar de nuevo en 3 min\./, "minutes are rounded up");
    const html = captureConsole(error(3_600));
    assert.match(html, /en 60 min\./);
    assert.match(html, new RegExp(es.retry), "the retry button is still there, for the user to press");
    assert.match(captureConsole(error(null)), new RegExp(es.analysisQuotaExceeded.replace(/[.]/g, "\\.")), "without a wait, the plain message");
    await i18n.changeLanguage("en");
    assert.match(captureConsole(error(90)), /You can analyze again in 2 min\./);
    assert.ok(en.analysisQuotaWait.includes("{{wait}}") && es.analysisQuotaWait.includes("{{wait}}"));
  } finally {
    await i18n.changeLanguage("es");
  }
});
