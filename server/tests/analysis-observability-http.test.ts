import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ApiErrorResponseSchema } from "@vision2code/contracts";
import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/configure-application.js";
import { AI_PROVIDER, ANALYSIS_DEADLINES, ANALYSIS_QUOTA } from "../src/analysis/analysis.constants.js";
import { DEFAULT_ANALYSIS_PROFILES } from "../src/analysis/analysis-profiles.js";
import { AnalysisQuota } from "../src/analysis/analysis-quota.js";
import type { AnalysisUsage } from "../src/analysis/analysis-summary-log.js";
import type { AnalysisImageInput } from "../src/analysis/analysis-image-input.js";
import { InvalidAnalysisOutputError } from "../src/analysis/invalid-analysis-output.error.js";
import { ProviderFailureError } from "../src/analysis/provider-failure.error.js";
import { SUPABASE_JWT_VERIFIER } from "../src/auth/supabase-auth.guard.js";
import { JoseSupabaseJwtVerifier } from "../src/auth/supabase-jwt-verifier.js";

const fixture: unknown = JSON.parse(readFileSync(new URL("../../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new TextEncoder().encode("IMAGE-BYTES-MARKER")]);
const issuer = "https://example-project.supabase.co/auth/v1";
const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const usage: AnalysisUsage = { inputTokens: 2_700, outputTokens: 9_000, reasoningTokens: 6_500 };

type Analyze = (input: AnalysisImageInput, signal: AbortSignal | undefined, onUsage: ((usage: AnalysisUsage) => void) | undefined) => Promise<unknown>;

describe("analysis timeout and summary log over HTTP (no live AI)", () => {
  let app: NestExpressApplication;
  let url: string;
  let token = "";
  let calls = 0;
  let analyze: Analyze;
  let quota: AnalysisQuota;
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const newQuota = (unitsPerHour: number) => new AnalysisQuota({ unitsPerHour, maxConcurrent: 1, maxTrackedUsers: 100 }, DEFAULT_ANALYSIS_PROFILES);

  before(async () => {
    const keys = await generateKeyPair("RS256");
    token = await new SignJWT({ email: "user@example.com", role: "authenticated" }).setProtectedHeader({ alg: "RS256", kid: "obs-key" })
      .setIssuer(issuer).setAudience("authenticated").setSubject(userId).setIssuedAt().setExpirationTime("2h").sign(keys.privateKey);
    const verifier = new JoseSupabaseJwtVerifier({ expectedIssuer: issuer, expectedAudience: "authenticated", keySetOverride: async () => keys.publicKey });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue({ analyze(input: AnalysisImageInput, signal?: AbortSignal, onUsage?: (usage: AnalysisUsage) => void) {
        calls += 1; return analyze(input, signal, onUsage);
      } })
      .overrideProvider(SUPABASE_JWT_VERIFIER).useValue(verifier)
      // A real timer decides, with deadlines of 150 ms instead of 90 to 180 s.
      .overrideProvider(ANALYSIS_DEADLINES).useValue({ fast: 150, balanced: 150, precise: 150 })
      .overrideProvider(ANALYSIS_QUOTA).useValue({ acquire: (user: string) => quota.acquire(user) })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useLogger(false);
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/api/v1/analyses`;
  });
  after(async () => { await app?.close(); });
  beforeEach(() => {
    calls = 0; lines.length = 0; raw.length = 0;
    quota = newQuota(20);
    analyze = async () => fixture;
    mock.method(console, "info", (text: unknown) => {
      raw.push(String(text));
      try {
        const parsed = JSON.parse(String(text)) as Record<string, unknown>;
        if (parsed.context === "AnalysisSummary") lines.push(parsed);
      } catch { /* other output */ }
    });
  });
  afterEach(() => { mock.restoreAll(); });

  function form(fidelity?: string, mime = "image/png") {
    const body = new FormData();
    body.set("image", new Blob([png], { type: mime }), "screenshot");
    body.set("viewportWidth", "640"); body.set("viewportHeight", "480");
    if (fidelity !== undefined) body.set("fidelity", fidelity);
    return body;
  }
  const post = (body: FormData, signal: AbortSignal = AbortSignal.timeout(10_000)) =>
    fetch(url, { method: "POST", body, headers: { Authorization: `Bearer ${token}`, "X-Request-Id": "obs-test" }, signal });
  /** A provider that never answers until its signal aborts, as a stuck call would. */
  const hang = (onAbort?: () => void): Analyze => (_input, signal) => new Promise<never>((_resolve, reject) => {
    signal?.addEventListener("abort", () => { onAbort?.(); reject(new ProviderFailureError("UNAVAILABLE")); }, { once: true });
  });
  async function slotFree() {
    for (let attempt = 0; attempt < 200; attempt++) {
      const lease = quota.acquire(userId);
      if ("release" in lease) { lease.release(); return; }
      if (lease.reason !== "CONCURRENCY") return; // out of budget, but the slot itself is free
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("a concurrency slot leaked");
  }

  it("the server's deadline is a 504 AI_TIMEOUT with the exact error body and no Retry-After", async () => {
    analyze = hang();
    const response = await post(form("precise"));
    assert.equal(response.status, 504);
    const text = await response.text();
    assert.deepEqual(ApiErrorResponseSchema.parse(JSON.parse(text)), { error: { code: "AI_TIMEOUT",
      message: "El análisis tardó demasiado. Prueba con un modo más rápido o con una captura más simple.", requestId: "obs-test" } });
    assert.equal(response.headers.get("retry-after"), null);
    assert.equal(response.headers.get("x-request-id"), "obs-test");
    for (const secret of [token, userId, "OpenAI", "IMAGE-BYTES-MARKER", "TimeoutError", "AbortError"]) assert.ok(!text.includes(secret), secret);
  });

  it("a timeout is charged (the call was made) and frees the concurrency slot", async () => {
    analyze = hang();
    assert.equal((await post(form("precise"))).status, 504);
    await slotFree();
    // 16 of 20 units were charged for the timed-out analysis: a fast one (6) no longer fits.
    analyze = async () => fixture;
    const before = calls;
    const blocked = await post(form("fast"));
    assert.equal(blocked.status, 429);
    assert.equal(ApiErrorResponseSchema.parse(await blocked.json()).error.code, "ANALYSIS_QUOTA_EXCEEDED");
    assert.equal(calls, before, "the provider was not called again");
    // With one slot and a roomy budget, many timeouts in a row all get in: nothing leaks.
    quota = newQuota(2_000);
    analyze = hang();
    for (let cycle = 0; cycle < 4; cycle++) assert.equal((await post(form("fast"))).status, 504, `cycle ${cycle}`);
    await slotFree();
  });

  it("a client that disconnects is not a timeout: it is logged as client_abort and frees the slot", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    // Without its signal the provider would only end at the 150 ms deadline: the disconnect must come first.
    analyze = (input, signal, onUsage) => { started(); return hang()(input, signal, onUsage); };
    const controller = new AbortController();
    const request = post(form("fast"), controller.signal).catch((error: Error) => error.name);
    await ready;
    controller.abort();
    assert.equal(await request, "AbortError");
    await slotFree();
    for (let attempt = 0; attempt < 100 && lines.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.outcome, "client_abort");
  });

  it("one summary line per analysis that reached the provider, with mode, duration, outcome and tokens", async () => {
    analyze = async (_input, _signal, onUsage) => { onUsage?.(usage); await new Promise((resolve) => setTimeout(resolve, 20)); return fixture; };
    assert.equal((await post(form("balanced"))).status, 200);
    assert.equal(lines.length, 1);
    const line = lines[0]!;
    assert.deepEqual(Object.keys(line).sort(), ["context", "durationMs", "fidelity", "inputTokens", "outcome", "outputTokens", "reasoningTokens", "requestId"]);
    assert.equal(line.requestId, "obs-test");
    assert.equal(line.fidelity, "balanced");
    assert.equal(line.outcome, "ok");
    assert.ok(Number.isInteger(line.durationMs) && (line.durationMs as number) >= 15 && (line.durationMs as number) < 2_000, String(line.durationMs));
    assert.deepEqual([line.inputTokens, line.outputTokens, line.reasoningTokens], [2_700, 9_000, 6_500]);
  });

  it("every outcome is named: timeout, truncated, invalid and provider_error; tokens are null when unreported", async () => {
    const cases: [string, Analyze, string, number][] = [
      ["timeout", hang(), "precise", 504],
      ["truncated", async (_i, _s, onUsage) => { onUsage?.(usage); throw new ProviderFailureError("TRUNCATED"); }, "precise", 502],
      ["invalid", async () => { throw new InvalidAnalysisOutputError(); }, "fast", 502],
      ["provider_error", async () => { throw new ProviderFailureError("UNAVAILABLE"); }, "fast", 503],
      ["provider_error", async () => { throw new ProviderFailureError("RATE_LIMITED"); }, "fast", 429],
    ];
    for (const [outcome, provider, fidelity, status] of cases) {
      quota = newQuota(2_000);
      lines.length = 0;
      analyze = provider;
      assert.equal((await post(form(fidelity))).status, status, outcome);
      assert.equal(lines.length, 1, outcome);
      assert.equal(lines[0]!.outcome, outcome);
      assert.equal(lines[0]!.fidelity, fidelity);
      const tokens = [lines[0]!.inputTokens, lines[0]!.outputTokens, lines[0]!.reasoningTokens];
      assert.deepEqual(tokens, outcome === "truncated" ? [2_700, 9_000, 6_500] : [null, null, null], outcome);
    }
  });

  it("requests that never reached the provider write no summary", async () => {
    assert.equal((await post(form("fast", "image/gif"))).status, 415);
    assert.equal((await post(form("turbo"))).status, 400);
    assert.equal(calls, 0);
    assert.equal(lines.length, 0);
  });

  it("the log holds no secret and no content: not the token, the image, the schema, the user or an error message", async () => {
    analyze = async (_input, _signal, onUsage) => { onUsage?.(usage); return fixture; };
    await post(form("fast"));
    quota = newQuota(2_000);
    analyze = async () => { throw new Error(`leaky ${token} IMAGE-BYTES-MARKER`); };
    await post(form("fast"));
    const base64 = Buffer.from(png).toString("base64");
    const text = raw.join("\n");
    assert.equal(lines.length, 2);
    for (const secret of [token, "Bearer", userId, "IMAGE-BYTES-MARKER", base64, base64.slice(0, 16), "leaky", "Error:", JSON.stringify(fixture).slice(0, 40)]) {
      assert.ok(!text.includes(secret), `the log contains ${secret.slice(0, 16)}`);
    }
  });
});
