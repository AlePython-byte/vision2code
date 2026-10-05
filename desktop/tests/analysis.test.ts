import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAnalysisClient, AnalysisClientError, resolveApiBaseUrl, DEFAULT_API_BASE_URL, ANALYSIS_REQUEST_TIMEOUT_MS } from "../src/features/analysis/analysisClient.ts";
import { canAnalyze, createAnalysisModel } from "../src/features/analysis/analysisModel.ts";
import type { Screenshot } from "../src/features/screenshot/loadScreenshot.ts";
import { AnalysisResponseSchema } from "@vision2code/contracts";

const uiSchema: unknown = JSON.parse(readFileSync(new URL("../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
const result = AnalysisResponseSchema.parse({ requestId: "desktop-test-001", uiSchema });
function screenshot(name = "capture.png", type = "image/png"): Screenshot {
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type });
  return { file, name, size: file.size, format: "PNG", width: 640, height: 480, url: "blob:test" };
}
const signal = () => new AbortController().signal;
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("analysis is enabled only when a validated screenshot is selected", () => {
  const model = createAnalysisModel(async () => result);
  assert.equal(model.getSnapshot().status, "IDLE");
  assert.equal(canAnalyze(model.getSnapshot()), false);
  model.setScreenshot(screenshot());
  assert.equal(model.getSnapshot().status, "READY");
  assert.equal(canAnalyze(model.getSnapshot()), true);
});

test("multipart includes actual decoded dimensions and image without stack or manual boundary", async () => {
  const selected = screenshot();
  const client = createAnalysisClient(undefined, async (url, options) => {
    assert.equal(url, DEFAULT_API_BASE_URL + "/analyses");
    assert.equal(options?.method, "POST");
    assert.equal(options?.headers, undefined);
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.body instanceof FormData);
    assert.deepEqual(Array.from(options.body.keys()).sort(), ["image", "viewportHeight", "viewportWidth"]);
    assert.equal(options.body.get("viewportWidth"), "640");
    assert.equal(options.body.get("viewportHeight"), "480");
    const image = options.body.get("image");
    assert.ok(image instanceof File);
    assert.equal(image.name, selected.file.name);
    assert.deepEqual(await image.arrayBuffer(), await selected.file.arrayBuffer());
    return Response.json(result);
  });
  assert.deepEqual(await client(selected, signal()), result);
});

test("uploads use the validated MIME even when the selected file has no MIME", async () => {
  await createAnalysisClient(undefined, async (_url, options) => {
    const body = options?.body as FormData;
    assert.equal((body.get("image") as File).type, "image/png");
    return Response.json(result);
  })(screenshot("capture.png", ""), signal());
});

test("ANALYZING prevents duplicate submissions and preserves the screenshot", async () => {
  const pending = deferred<typeof result>();
  let calls = 0;
  const model = createAnalysisModel(async () => { calls++; return pending.promise; });
  const selected = screenshot();
  model.setScreenshot(selected);
  const request = model.analyze();
  assert.equal(model.getSnapshot().status, "ANALYZING");
  assert.equal(canAnalyze(model.getSnapshot()), false);
  assert.equal(model.getSnapshot().screenshot, selected);
  await model.analyze();
  assert.equal(calls, 1);
  pending.resolve(result);
  await request;
  assert.equal(model.getSnapshot().status, "SUCCESS");
  assert.deepEqual(model.getSnapshot().result, result);
});

test("invalid success payload becomes ERROR with no untrusted output stored", async () => {
  const model = createAnalysisModel(createAnalysisClient(undefined, async () => Response.json({ secret: "provider-detail" })));
  model.setScreenshot(screenshot());
  await model.analyze();
  assert.equal(model.getSnapshot().status, "ERROR");
  assert.equal(model.getSnapshot().result, null);
  assert.match(model.getSnapshot().error ?? "", /análisis no válido/);
  assert.doesNotMatch(JSON.stringify(model.getSnapshot()), /provider-detail/);
});

for (const [code, message] of [
  ["AI_UNAVAILABLE", /no está disponible/], ["AI_RATE_LIMITED", /limitado/], ["AI_OUTPUT_INVALID", /interpretar/],
] as const) {
  test(`backend ${code} uses safe Spanish copy and stores its correlation ID`, async () => {
    const model = createAnalysisModel(createAnalysisClient(undefined, async () => Response.json({
      error: { code, message: "SECRET_SDK_DETAIL", requestId: "backend-001" },
    }, { status: 503 })));
    model.setScreenshot(screenshot());
    await model.analyze();
    assert.equal(model.getSnapshot().status, "ERROR");
    assert.match(model.getSnapshot().error ?? "", message);
    assert.equal(model.getSnapshot().errorRequestId, "backend-001");
    assert.doesNotMatch(JSON.stringify(model.getSnapshot()), /SECRET_SDK_DETAIL/);
  });
}

test("retry after failure preserves selection and sends only one additional request", async () => {
  let calls = 0;
  const model = createAnalysisModel(createAnalysisClient(undefined, async () => {
    calls++;
    if (calls === 1) throw new Error("PRIVATE_NETWORK_DETAIL");
    return Response.json(result);
  }));
  const selected = screenshot();
  model.setScreenshot(selected);
  await model.analyze();
  assert.equal(model.getSnapshot().status, "ERROR");
  assert.equal(model.getSnapshot().screenshot, selected);
  assert.equal(canAnalyze(model.getSnapshot()), true);
  await model.analyze();
  assert.equal(calls, 2);
  assert.equal(model.getSnapshot().status, "SUCCESS");
});

test("malformed JSON and non-JSON unavailable responses stay sanitized", async () => {
  for (const status of [200, 503]) {
    await assert.rejects(createAnalysisClient(undefined, async () => new Response("PRIVATE_HTML", { status }))(screenshot(), signal()),
      (error: unknown) => error instanceof AnalysisClientError && !error.message.includes("PRIVATE_HTML"));
  }
});

test("replacing a screenshot aborts and ignores an obsolete successful response", async () => {
  const pending = deferred<typeof result>();
  let receivedSignal: AbortSignal | undefined;
  const model = createAnalysisModel(async (_image, abortSignal) => { receivedSignal = abortSignal; return pending.promise; });
  model.setScreenshot(screenshot());
  const request = model.analyze();
  const next = screenshot("next.png");
  model.setScreenshot(next);
  assert.equal(receivedSignal?.aborted, true);
  pending.resolve(result);
  await request;
  assert.equal(model.getSnapshot().status, "READY");
  assert.equal(model.getSnapshot().screenshot, next);
  assert.equal(model.getSnapshot().result, null);
});

test("removing a screenshot ignores obsolete failures", async () => {
  const pending = deferred<typeof result>();
  const model = createAnalysisModel(async () => pending.promise);
  model.setScreenshot(screenshot());
  const request = model.analyze();
  model.setScreenshot(null);
  pending.reject(new Error("obsolete"));
  await request;
  assert.equal(model.getSnapshot().status, "IDLE");
  assert.equal(model.getSnapshot().error, null);
});

test("cancel preserves selection for retry and cancels the HTTP transport", async () => {
  let receivedSignal: AbortSignal | undefined;
  const started = deferred<void>();
  const client = createAnalysisClient(undefined, async (_url, options) => {
    receivedSignal = options?.signal ?? undefined;
    started.resolve();
    return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
  });
  const model = createAnalysisModel(client);
  const selected = screenshot();
  model.setScreenshot(selected);
  const request = model.analyze();
  await started.promise;
  model.cancel();
  await request;
  assert.equal(receivedSignal?.aborted, true);
  assert.equal(model.getSnapshot().screenshot, selected);
  assert.equal(model.getSnapshot().status, "ERROR");
  assert.match(model.getSnapshot().error ?? "", /cancelado/);
});

test("unmount disposal aborts work and clears screenshot and result", async () => {
  const pending = deferred<typeof result>();
  let receivedSignal: AbortSignal | undefined;
  const model = createAnalysisModel(async (_image, abortSignal) => { receivedSignal = abortSignal; return pending.promise; });
  model.setScreenshot(screenshot());
  const request = model.analyze();
  model.dispose();
  assert.equal(receivedSignal?.aborted, true);
  pending.resolve(result);
  await request;
  assert.equal(model.getSnapshot().status, "IDLE");
  assert.equal(model.getSnapshot().result, null);
  assert.equal(model.getSnapshot().screenshot, null);
});

test("already aborted requests do not invoke transport", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(createAnalysisClient(undefined, async () => { calls++; return Response.json(result); })(screenshot(), controller.signal), /cancelado/);
  assert.equal(calls, 0);
});

test("model subscriptions support mount/unmount and future consumers", async () => {
  const model = createAnalysisModel(async () => result);
  const states: string[] = [];
  const unsubscribe = model.subscribe(() => states.push(model.getSnapshot().status));
  model.setScreenshot(screenshot());
  await model.analyze();
  assert.deepEqual(states, ["READY", "ANALYZING", "SUCCESS"]);
  unsubscribe();
  model.dispose();
  assert.equal(states.length, 3);
});

test("API configuration normalizes paths and rejects credentials and unsafe schemes", () => {
  assert.equal(resolveApiBaseUrl(), DEFAULT_API_BASE_URL);
  assert.equal(resolveApiBaseUrl("http://127.0.0.1:3000/api/v1/"), "http://127.0.0.1:3000/api/v1");
  for (const value of ["file:///tmp", "javascript:alert(1)", "https://user:secret@example.com", "https://example.com?key=secret"]) {
    assert.throws(() => resolveApiBaseUrl(value));
  }
});


test("a stalled HTTP request is aborted at the client deadline without retrying", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  let abortSignal: AbortSignal | undefined;
  const client = createAnalysisClient(undefined, async (_url, options) => {
    calls++;
    abortSignal = options?.signal ?? undefined;
    return new Promise((_resolve, reject) => abortSignal?.addEventListener("abort", () => reject(new Error("PRIVATE_TIMEOUT"))));
  });
  const request = assert.rejects(client(screenshot(), signal()), /tardó demasiado/);
  context.mock.timers.tick(ANALYSIS_REQUEST_TIMEOUT_MS - 1);
  assert.equal(abortSignal?.aborted, false);
  context.mock.timers.tick(1);
  await request;
  assert.equal(abortSignal?.aborted, true);
  assert.equal(calls, 1);
});
