import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AnalysisResponseSchema, ApiErrorResponseSchema } from "@vision2code/contracts";
import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/configure-application.js";
import { AI_PROVIDER, MAX_ANALYSIS_IMAGE_BYTES } from "../src/analysis/analysis.constants.js";
import type { AnalysisImageInput } from "../src/analysis/analysis-image-input.js";
import type { AIProvider } from "../src/ai/ai-provider.js";
import { ProviderFailureError } from "../src/analysis/provider-failure.error.js";

const fixture: unknown = JSON.parse(readFileSync(new URL("../../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

describe("analysis HTTP boundary without live AI", () => {
  let app: NestExpressApplication;
  let url: string;
  let calls = 0;
  let received: AnalysisImageInput | undefined;
  let analyze: AIProvider["analyze"];

  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AI_PROVIDER)
      .useValue({ analyze(input: AnalysisImageInput, signal?: AbortSignal) {
        calls += 1; received = input; return analyze(input, signal);
      } }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useLogger(false);
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/api/v1/analyses`;
  });
  after(async () => { await app?.close(); });
  beforeEach(() => { calls = 0; received = undefined; analyze = async () => fixture; });

  function form(bytes = png, mime = "image/png") {
    const body = new FormData();
    body.set("image", new Blob([bytes], { type: mime }), "screenshot");
    body.set("viewportWidth", "640"); body.set("viewportHeight", "480");
    return body;
  }
  function post(body: FormData) {
    return fetch(url, { method: "POST", body, headers: { "X-Request-Id": "analysis-test" }, signal: AbortSignal.timeout(10000) });
  }
  async function expectError(body: FormData, status: number, code: string, providerCalls = 0) {
    const response = await post(body);
    assert.equal(response.status, status);
    const result = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(result.error.code, code);
    assert.equal(result.error.requestId, "analysis-test");
    assert.equal(response.headers.get("x-request-id"), "analysis-test");
    assert.equal(calls, providerCalls);
    assert.doesNotMatch(JSON.stringify(result), /secret|OpenAI|stack|SDK|provider-body/);
    return result;
  }

  it("returns the shared response and forwards only image bytes and dimensions", async () => {
    const response = await post(form());
    assert.equal(response.status, 200);
    assert.deepEqual(AnalysisResponseSchema.parse(await response.json()), { requestId: "analysis-test", uiSchema: fixture });
    assert.equal(calls, 1);
    assert.deepEqual(received, { bytes: png, mimeType: "image/png", width: 640, height: 480 });
  });
  it("accepts PNG, JPEG and WEBP headers", async () => {
    for (const [mime, bytes] of [["image/png", png], ["image/jpeg", new Uint8Array([255, 216, 255])],
      ["image/webp", new Uint8Array(Buffer.from("RIFF0000WEBP"))]] as const) {
      const response = await post(form(bytes, mime));
      assert.equal(response.status, 200); await response.arrayBuffer();
    }
  });
  it("rejects a missing image", async () => {
    const body = form(); body.delete("image"); await expectError(body, 400, "INVALID_REQUEST");
  });
  it("rejects unsupported MIME and mismatched or empty image signatures", async () => {
    for (const body of [form(png, "image/gif"), form(new Uint8Array([1, 2])), form(new Uint8Array())]) {
      await expectError(body, 415, "UNSUPPORTED_IMAGE");
    }
  });
  it("rejects oversized images before invoking the provider", async () => {
    const bytes = new Uint8Array(MAX_ANALYSIS_IMAGE_BYTES + 1); bytes.set(png);
    await expectError(form(bytes), 413, "IMAGE_TOO_LARGE");
  });
  it("accepts the exact 10 MB boundary", async () => {
    const bytes = new Uint8Array(MAX_ANALYSIS_IMAGE_BYTES); bytes.set(png);
    const response = await post(form(bytes)); assert.equal(response.status, 200); await response.arrayBuffer();
    assert.equal(received?.bytes.length, MAX_ANALYSIS_IMAGE_BYTES);
  });
  it("requires both dimensions to be positive safe integers", async () => {
    for (const key of ["viewportWidth", "viewportHeight"]) {
      for (const value of ["0", "-1", "1.2", "NaN", "1e3", "9007199254740992", ""]) {
        const body = form(); body.set(key, value); await expectError(body, 400, "INVALID_REQUEST");
      }
      const body = form(); body.delete(key); await expectError(body, 400, "INVALID_REQUEST");
    }
  });
  it("rejects targetStack, duplicate fields and extra files", async () => {
    const stack = form(); stack.set("targetStack", "REACT_TAILWIND");
    const duplicate = form(); duplicate.append("viewportWidth", "640");
    const extra = form(); extra.append("image", new Blob([png], { type: "image/png" }), "second.png");
    for (const body of [stack, duplicate, extra]) await expectError(body, 400, "INVALID_REQUEST");
  });
  it("rejects JSON and user-supplied image URLs", async () => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "https://example.com/image.png", viewportWidth: 640, viewportHeight: 480 }) });
    assert.equal(response.status, 400);
    assert.equal(ApiErrorResponseSchema.parse(await response.json()).error.code, "INVALID_REQUEST");
    assert.equal(calls, 0);
  });
  it("validates provider JSON in the use case and maps invalid output", async () => {
    analyze = async () => ({ providerBody: "secret-provider-body" });
    const result = await expectError(form(), 502, "AI_OUTPUT_INVALID", 1);
    assert.equal(result.error.message, "No se pudo interpretar correctamente la interfaz.");
  });
  it("maps provider rate limits to a safe Spanish error", async () => {
    analyze = async () => { throw new ProviderFailureError("RATE_LIMITED"); };
    const result = await expectError(form(), 429, "AI_RATE_LIMITED", 1);
    assert.equal(result.error.message, "El servicio de análisis está temporalmente limitado. Inténtalo nuevamente.");
  });
  it("maps provider availability failures to a safe Spanish error", async () => {
    analyze = async () => { throw new ProviderFailureError("UNAVAILABLE"); };
    const result = await expectError(form(), 503, "AI_UNAVAILABLE", 1);
    assert.equal(result.error.message, "El servicio de análisis no está disponible temporalmente.");
  });
  it("does not leak unexpected SDK messages or secrets", async () => {
    analyze = async () => { throw new Error("OpenAI SDK secret-api-key provider-body"); };
    await expectError(form(), 500, "INTERNAL_ERROR", 1);
  });
  it("propagates client disconnect cancellation to the provider", async () => {
    let started!: () => void;
    let cancelled!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const done = new Promise<void>((resolve) => { cancelled = resolve; });
    analyze = async (_input, signal) => {
      assert.ok(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { cancelled(); reject(new ProviderFailureError("UNAVAILABLE")); }, { once: true });
        started();
      });
    };
    const controller = new AbortController();
    const request = fetch(url, { method: "POST", body: form(), signal: controller.signal });
    const rejected = assert.rejects(request, { name: "AbortError" });
    const timeout = AbortSignal.timeout(5000);
    const expired = new Promise<never>((_resolve, reject) => timeout.addEventListener("abort", () => reject(new Error("Cancellation test timed out."))));
    await Promise.race([ready, expired]); controller.abort();
    await rejected; await Promise.race([done, expired]);
  });
});
