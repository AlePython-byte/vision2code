import assert from "node:assert/strict";
import test from "node:test";
import { AnalysisClientError, createAnalysisClient } from "../src/features/analysis/analysisClient.ts";
import { en, es, messageKeys } from "../src/features/preferences/resources.ts";
import type { Screenshot } from "../src/features/screenshot/loadScreenshot.ts";

const screenshot = (): Screenshot => {
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "capture.png", { type: "image/png" });
  return { file, name: "capture.png", size: file.size, format: "PNG", width: 640, height: 480, url: "blob:test" };
};
const timeoutResponse = () => Response.json({ error: { code: "AI_TIMEOUT", message: "mensaje del servidor", requestId: "req-timeout" } }, { status: 504 });

function counting() {
  const state = { requests: 0, expired: 0 };
  const client = createAnalysisClient(undefined, async () => { state.requests++; return timeoutResponse(); },
    { getAccessToken: async () => "token", onUnauthorized: () => { state.expired++; } });
  return { client, state };
}

test("the server's timeout names a faster mode than the one used, in the user's language", async () => {
  const expected = { precise: "analysisTimeoutPrecise", balanced: "analysisTimeoutBalanced", fast: "analysisTimeoutFast" } as const;
  for (const [fidelity, key] of Object.entries(expected) as [keyof typeof expected, (typeof expected)[keyof typeof expected]][]) {
    const { client } = counting();
    const error = await client(screenshot(), new AbortController().signal, { fidelity }).catch((reason: unknown) => reason) as AnalysisClientError;
    assert.ok(error instanceof AnalysisClientError);
    assert.equal(error.code, "AI_TIMEOUT");
    assert.equal(error.requestId, "req-timeout");
    assert.equal(error.message, es[key], "a fixed localized message, never the server's text");
    assert.equal(messageKeys[error.message], key, "it maps to a resource key, so English works too");
    assert.ok(en[key].length > 0 && en[key] !== es[key]);
  }
  // The advice never points at the mode that just timed out, nor at a slower one.
  assert.match(es.analysisTimeoutPrecise, /Equilibrado o Rápido/);
  assert.doesNotMatch(es.analysisTimeoutBalanced, /Preciso|Equilibrado/);
  assert.doesNotMatch(es.analysisTimeoutFast, /Rápido|Equilibrado|Preciso/);
  assert.doesNotMatch(en.analysisTimeoutBalanced, /Precise|Balanced/);
  assert.doesNotMatch(en.analysisTimeoutFast, /Fast|Balanced|Precise/);
  // Without an explicit mode the analysis was balanced.
  const { client } = counting();
  const error = await client(screenshot(), new AbortController().signal).catch((reason: unknown) => reason) as AnalysisClientError;
  assert.equal(error.message, es.analysisTimeoutBalanced);
});

test("a timeout never expires the session and is never retried automatically", async () => {
  const { client, state } = counting();
  await assert.rejects(client(screenshot(), new AbortController().signal, { fidelity: "precise" }), { code: "AI_TIMEOUT" });
  assert.equal(state.requests, 1, "one request, no automatic retry");
  assert.equal(state.expired, 0, "a 504 is not a 401");
});

test("the client's own deadline keeps its separate message", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const client = createAnalysisClient(undefined, (_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  const pending = client(screenshot(), new AbortController().signal, { fidelity: "fast" });
  const settled = assert.rejects(pending, (error: unknown) => error instanceof AnalysisClientError && error.code === null && /tardó demasiado/.test(error.message));
  context.mock.timers.tick(150_000); // fast: 120 s server deadline + 30 s
  await settled;
});
