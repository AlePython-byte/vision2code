import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AnalysisResponseSchema, ApiErrorResponseSchema } from "@vision2code/contracts";
import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/configure-application.js";
import { AI_PROVIDER, ANALYSIS_QUOTA, MAX_ANALYSIS_IMAGE_BYTES } from "../src/analysis/analysis.constants.js";
import { AnalysisQuota } from "../src/analysis/analysis-quota.js";
import { DEFAULT_ANALYSIS_PROFILES } from "../src/analysis/analysis-profiles.js";
import type { AnalysisImageInput } from "../src/analysis/analysis-image-input.js";
import type { AIProvider } from "../src/ai/ai-provider.js";
import { ProviderFailureError } from "../src/analysis/provider-failure.error.js";
import { SUPABASE_JWT_VERIFIER } from "../src/auth/supabase-auth.guard.js";
import { JoseSupabaseJwtVerifier } from "../src/auth/supabase-jwt-verifier.js";

const fixture: unknown = JSON.parse(readFileSync(new URL("../../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const issuer = "https://example-project.supabase.co/auth/v1";

describe("analysis HTTP boundary without live AI", () => {
  let app: NestExpressApplication;
  let url: string;
  let calls = 0;
  let received: AnalysisImageInput | undefined;
  let analyze: AIProvider["analyze"];
  let token: string;
  let foreignToken: string;
  let expiredToken: string;

  before(async () => {
    const keys = await generateKeyPair("RS256");
    const foreign = await generateKeyPair("RS256");
    const sign = (key: Parameters<SignJWT["sign"]>[0], expiresAt: string | number = "2h") => new SignJWT({ email: "user@example.com", role: "authenticated" })
      .setProtectedHeader({ alg: "RS256", kid: "analysis-key" }).setIssuer(issuer).setAudience("authenticated")
      .setSubject("33333333-3333-4333-8333-333333333333").setIssuedAt().setExpirationTime(expiresAt).sign(key);
    token = await sign(keys.privateKey);
    foreignToken = await sign(foreign.privateKey);
    expiredToken = await sign(keys.privateKey, Math.floor(Date.now() / 1000) - 60);
    const verifier = new JoseSupabaseJwtVerifier({ expectedIssuer: issuer, expectedAudience: "authenticated", keySetOverride: async () => keys.publicKey });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AI_PROVIDER)
      .useValue({ analyze(input: AnalysisImageInput, signal?: AbortSignal) {
        calls += 1; received = input; return analyze(input, signal);
      } }).overrideProvider(SUPABASE_JWT_VERIFIER).useValue(verifier)
      // These tests are about the HTTP boundary, not the per-user limit (analysis-quota-http.test.ts):
      // one user sends dozens of analyses here, so the quota is generous.
      .overrideProvider(ANALYSIS_QUOTA).useValue(new AnalysisQuota({ unitsPerHour: 100_000, maxConcurrent: 4, maxTrackedUsers: 100 }, DEFAULT_ANALYSIS_PROFILES))
      .compile();
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
  function post(body: FormData, authorization: string | null = `Bearer ${token}`) {
    const headers: Record<string, string> = { "X-Request-Id": "analysis-test" };
    if (authorization !== null) headers.Authorization = authorization;
    return fetch(url, { method: "POST", body, headers, signal: AbortSignal.timeout(10000) });
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

  async function expectUnauthorized(authorization: string | null, body = form()) {
    const response = await post(body, authorization);
    assert.equal(response.status, 401);
    const result = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(result.error.code, "UNAUTHORIZED");
    assert.equal(result.error.requestId, "analysis-test");
    assert.equal(calls, 0, "the AI provider is never invoked without a verified session");
    assert.equal(received, undefined);
  }
  it("rejects a request without a token before invoking the provider", async () => {
    await expectUnauthorized(null);
  });
  it("rejects malformed, foreign-signed and expired tokens before invoking the provider", async () => {
    for (const authorization of ["Bearer", "Bearer ", "Basic dXNlcjpwYXNz", token, "Bearer not-a-jwt",
      `Bearer ${foreignToken}`, `Bearer ${expiredToken}`]) {
      await expectUnauthorized(authorization);
    }
  });
  it("authenticates before parsing the upload: invalid bodies without a token are still 401", async () => {
    const oversized = new Uint8Array(MAX_ANALYSIS_IMAGE_BYTES + 1); oversized.set(png);
    for (const body of [form(oversized), form(png, "image/gif"), (() => { const missing = form(); missing.delete("image"); return missing; })()]) {
      await expectUnauthorized(null, body);
    }
  });
  it("a verified token reaches the analysis service", async () => {
    const response = await post(form());
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    await response.arrayBuffer();
  });
  it("allows the Authorization header in the analysis preflight from every desktop origin", async () => {
    for (const origin of ["http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]) {
      const response = await fetch(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type,x-request-id" } });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      const allowed = (response.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(",").map((value) => value.trim());
      assert.ok(allowed.includes("authorization"), `Authorization must be allowed from ${origin}`);
      assert.equal(calls, 0);
    }
  });
  it("returns the shared response and forwards only image bytes, dimensions and the (default) mode", async () => {
    const response = await post(form());
    assert.equal(response.status, 200);
    assert.deepEqual(AnalysisResponseSchema.parse(await response.json()), { requestId: "analysis-test", uiSchema: fixture });
    assert.equal(calls, 1);
    // No fidelity field: analyzed as balanced, the default every older client gets.
    assert.deepEqual(received, { bytes: png, mimeType: "image/png", width: 640, height: 480, fidelity: "balanced" });
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
  // ---- TASK 011D: fidelity mode -------------------------------------------------------------
  it("forwards each valid fidelity mode to the provider", async () => {
    for (const fidelity of ["fast", "balanced", "precise"]) {
      const body = form(); body.set("fidelity", fidelity);
      const response = await post(body);
      assert.equal(response.status, 200, fidelity); await response.arrayBuffer();
      assert.equal(received?.fidelity, fidelity);
    }
  });
  it("rejects an unknown, uppercase, empty or duplicated fidelity with the standard 400 before the provider", async () => {
    for (const value of ["turbo", "PRECISE", "", "x".repeat(40)]) {
      const body = form(); body.set("fidelity", value);
      await expectError(body, 400, "INVALID_REQUEST");
    }
    const duplicated = form(); duplicated.set("fidelity", "fast"); duplicated.append("fidelity", "precise");
    await expectError(duplicated, 400, "INVALID_REQUEST");
  });
  it("still requires a verified session when a fidelity is sent", async () => {
    const body = form(); body.set("fidelity", "precise");
    await expectUnauthorized(null, body);
  });
  it("maps a truncated provider output and rejected mode settings to clear, safe errors", async () => {
    analyze = async () => { throw new ProviderFailureError("TRUNCATED"); };
    const truncated = await expectError(form(), 502, "AI_OUTPUT_TRUNCATED", 1);
    assert.match(truncated.error.message, /se interrumpió antes de terminar/);
    analyze = async () => { throw new ProviderFailureError("UNSUPPORTED_SETTINGS"); };
    calls = 0;
    const unsupported = await expectError(form(), 502, "AI_SETTINGS_UNSUPPORTED", 1);
    assert.match(unsupported.error.message, /no admite la configuración de este modo/);
  });
  it("rejects JSON and user-supplied image URLs", async () => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
    const request = fetch(url, { method: "POST", body: form(), headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    const rejected = assert.rejects(request, { name: "AbortError" });
    const timeout = AbortSignal.timeout(5000);
    const expired = new Promise<never>((_resolve, reject) => timeout.addEventListener("abort", () => reject(new Error("Cancellation test timed out."))));
    await Promise.race([ready, expired]); controller.abort();
    await rejected; await Promise.race([done, expired]);
  });
});
