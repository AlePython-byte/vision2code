import "reflect-metadata";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { Test } from "@nestjs/testing";
import type { LoggerService } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ApiErrorResponseSchema } from "@vision2code/contracts";
import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/configure-application.js";
import { AI_PROVIDER, ANALYSIS_QUOTA } from "../src/analysis/analysis.constants.js";
import { DEFAULT_ANALYSIS_PROFILES } from "../src/analysis/analysis-profiles.js";
import { AnalysisQuota, CONCURRENCY_RETRY_SECONDS } from "../src/analysis/analysis-quota.js";
import type { AnalysisQuotaConfiguration } from "../src/analysis/analysis-quota.js";
import type { AnalysisImageInput } from "../src/analysis/analysis-image-input.js";
import type { AIProvider } from "../src/ai/ai-provider.js";
import { ProviderFailureError } from "../src/analysis/provider-failure.error.js";
import { SUPABASE_JWT_VERIFIER } from "../src/auth/supabase-auth.guard.js";
import { JoseSupabaseJwtVerifier } from "../src/auth/supabase-jwt-verifier.js";

const fixture: unknown = JSON.parse(readFileSync(new URL("../../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
// A PNG signature followed by bytes that would be recognizable in a log, as raw text or base64.
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new TextEncoder().encode("IMAGE-BYTES-MARKER")]);
const issuer = "https://example-project.supabase.co/auth/v1";
const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("per-user analysis quota over HTTP (no live AI)", () => {
  let app: NestExpressApplication;
  let url: string;
  let calls = 0;
  let analyze: AIProvider["analyze"];
  let now = 0;
  let quota: AnalysisQuota;
  let acquires = 0;
  const logs: string[] = [];
  const tokens: Record<"a1" | "a2" | "b", string> = { a1: "", a2: "", b: "" };

  const reset = (configuration: Partial<AnalysisQuotaConfiguration> = {}) => {
    quota = new AnalysisQuota({ unitsPerHour: 19, maxConcurrent: 2, maxTrackedUsers: 100, ...configuration }, DEFAULT_ANALYSIS_PROFILES, () => now);
  };

  before(async () => {
    const keys = await generateKeyPair("RS256");
    const sign = (subject: string, jti: string) => new SignJWT({ email: `${jti}@example.com`, role: "authenticated" })
      .setProtectedHeader({ alg: "RS256", kid: "quota-key" }).setIssuer(issuer).setAudience("authenticated")
      .setSubject(subject).setJti(jti).setIssuedAt().setExpirationTime("2h").sign(keys.privateKey);
    tokens.a1 = await sign(userA, "first-device");
    tokens.a2 = await sign(userA, "second-device");
    tokens.b = await sign(userB, "other-user");
    const verifier = new JoseSupabaseJwtVerifier({ expectedIssuer: issuer, expectedAudience: "authenticated", keySetOverride: async () => keys.publicKey });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue({ analyze(input: AnalysisImageInput, signal?: AbortSignal) { calls += 1; return analyze(input, signal); } })
      .overrideProvider(SUPABASE_JWT_VERIFIER).useValue(verifier)
      // Delegates to the quota of the current test, and counts every look at it.
      .overrideProvider(ANALYSIS_QUOTA).useValue({ acquire: (userId: string) => { acquires += 1; return quota.acquire(userId); } })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    const collect = (...parts: unknown[]) => { logs.push(parts.map((part) => typeof part === "string" ? part : JSON.stringify(part)).join(" ")); };
    const logger: LoggerService = { log: collect, error: collect, warn: collect, debug: collect, verbose: collect, fatal: collect };
    app.useLogger(logger);
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/api/v1/analyses`;
  });
  after(async () => { await app?.close(); });
  beforeEach(() => { calls = 0; acquires = 0; now = 1_000_000; reset(); analyze = async () => fixture; });

  function form(fidelity?: string, bytes = png, mime = "image/png") {
    const body = new FormData();
    body.set("image", new Blob([bytes], { type: mime }), "screenshot");
    body.set("viewportWidth", "640"); body.set("viewportHeight", "480");
    if (fidelity !== undefined) body.set("fidelity", fidelity);
    return body;
  }
  function post(body: FormData, token: string | null = tokens.a1, signal: AbortSignal = AbortSignal.timeout(10_000)) {
    const headers: Record<string, string> = { "X-Request-Id": "quota-test" };
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    return fetch(url, { method: "POST", body, headers, signal });
  }
  async function status(body: FormData, token: string | null = tokens.a1) {
    const response = await post(body, token);
    await response.arrayBuffer();
    return response.status;
  }
  async function expectQuota(response: Response, retryAfterSeconds: number) {
    assert.equal(response.status, 429);
    const raw = await response.text();
    const result = ApiErrorResponseSchema.parse(JSON.parse(raw));
    assert.deepEqual(result, { error: { code: "ANALYSIS_QUOTA_EXCEEDED", message: "Has alcanzado tu límite de análisis por ahora. Inténtalo de nuevo más tarde.",
      requestId: "quota-test", retryAfterSeconds } });
    assert.equal(response.headers.get("retry-after"), String(retryAfterSeconds));
    assert.notEqual(result.error.code, "AI_RATE_LIMITED", "our own limit, not the provider's");
    const visible = raw + JSON.stringify([...response.headers]);
    for (const secret of [tokens.a1, tokens.a2, userA, "OpenAI", "provider", "units", "IMAGE-BYTES-MARKER"]) assert.ok(!visible.includes(secret), secret);
  }
  /** Waits until the user's slots are free again (the release runs when the response closes). */
  async function slotsFree(user: string, count: number) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const leases = Array.from({ length: count }, () => quota.acquire(user));
      const free = leases.every((lease) => "release" in lease);
      for (const lease of leases) if ("release" in lease) lease.release();
      if (free) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(`${user}: a slot leaked`);
  }

  it("401 comes first: without a valid session the quota is never read, even when the user is out of budget", async () => {
    assert.equal(await status(form("precise")), 200);
    assert.equal(await status(form("fast")), 429, "A is out of budget");
    acquires = 0; calls = 0;
    for (const token of [null, "not-a-jwt", tokens.a1.slice(0, -4) + "AAAA"]) assert.equal(await status(form("fast"), token), 401);
    assert.equal(acquires, 0, "the limiter was never consulted");
    assert.equal(calls, 0);
  });

  it("over budget: an exact 429 with Retry-After, the provider is never called, and the body is not even read", async () => {
    assert.equal(await status(form("precise")), 200);
    assert.equal(calls, 1);
    await expectQuota(await post(form("fast")), 3_600);
    // Rejected before the multipart body is parsed: an unsupported image still gets the 429, not a 415.
    await expectQuota(await post(form("fast", png, "image/gif")), 3_600);
    now += 30 * 60_000;
    await expectQuota(await post(form()), 1_800);
    assert.equal(calls, 1, "the provider is not invoked while limited");
    now += 30 * 60_000;
    assert.equal(await status(form("precise")), 200, "an hour later the budget is back");
  });

  it("weights per mode: precise spends the budget before fast does", async () => {
    // 20 units: three fast analyses (6 each), or one precise (14, leaving 5).
    for (let index = 0; index < 3; index++) assert.equal(await status(form("fast")), 200);
    assert.equal(await status(form("fast")), 429);
    reset();
    assert.equal(await status(form("precise")), 200);
    assert.equal(await status(form("fast")), 429);
    reset();
    assert.equal(await status(form("balanced")), 200);
    // 10 left: the check before the upload lets it in (fast would fit), the exact charge after reading the mode refuses precise.
    const before = calls;
    await expectQuota(await post(form("precise")), 3_600);
    assert.equal(calls, before, "the refused precise analysis never reached the provider");
    assert.equal(await status(form("fast")), 200, "the refused precise analysis was not charged");
  });

  it("requests rejected before the provider are never charged", async () => {
    reset({ unitsPerHour: 19 });
    for (const body of [form("turbo"), form("PRECISE"), form("precise", png, "image/gif"), form("precise", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))]) {
      assert.ok([400, 415].includes(await status(body)));
    }
    assert.equal(calls, 0);
    assert.equal(await status(form("precise")), 200, "the full budget is still there");
  });

  it("the provider failing, truncating or timing out still costs: the call was made", async () => {
    analyze = async () => { throw new ProviderFailureError("TRUNCATED"); };
    assert.equal(await status(form("precise")), 502);
    analyze = async () => fixture;
    assert.equal(await status(form("fast")), 429);
    assert.equal(calls, 1);
  });

  it("the key is the verified sub: two tokens of A share a budget, B has its own", async () => {
    assert.equal(await status(form("precise"), tokens.a1), 200);
    assert.equal(await status(form("fast"), tokens.a2), 429, "another token of the same user");
    assert.equal(await status(form("precise"), tokens.b), 200, "another user");
    assert.equal(await status(form("fast"), tokens.b), 429);
  });

  it("concurrency: the cap holds per user, and the slot always comes back", async () => {
    reset({ unitsPerHour: 2_000, maxConcurrent: 2 });
    const pending: (() => void)[] = [];
    analyze = () => new Promise((resolve) => { pending.push(() => resolve(fixture)); });
    const first = post(form("fast"));
    const second = post(form("fast"), tokens.a2);
    for (let attempt = 0; pending.length < 2 && attempt < 400; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(pending.length, 2);
    await expectQuota(await post(form("fast")), CONCURRENCY_RETRY_SECONDS);
    assert.equal(calls, 2, "the third analysis of A never reached the provider");
    const other = post(form("fast"), tokens.b);
    for (let attempt = 0; pending.length < 3 && attempt < 400; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(pending.length, 3, "B is not blocked by A's analyses");
    pending.splice(0).forEach((resolve) => resolve());
    assert.deepEqual([(await first).status, (await second).status, (await other).status], [200, 200, 200]);
    await slotsFree(userA, 2);
  });

  it("no slot leaks after success, provider error, timeout, invalid upload or client disconnect", async () => {
    reset({ unitsPerHour: 2_000, maxConcurrent: 1 });
    for (let cycle = 0; cycle < 5; cycle++) {
      analyze = async () => fixture;
      assert.equal(await status(form("fast")), 200);
      analyze = async () => { throw new ProviderFailureError("UNAVAILABLE"); };
      assert.equal(await status(form("fast")), 503);
      // The deadline path ends the same way: the signal aborts and the provider rejects.
      analyze = async () => { throw new ProviderFailureError("UNAVAILABLE"); };
      assert.equal(await status(form("fast")), 503);
      assert.equal(await status(form("fast", png, "image/gif")), 415);
      assert.equal(await status(form("nope")), 400);

      let started!: () => void;
      let cancelled!: () => void;
      const ready = new Promise<void>((resolve) => { started = resolve; });
      const done = new Promise<void>((resolve) => { cancelled = resolve; });
      analyze = async (_input, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => { cancelled(); reject(new ProviderFailureError("UNAVAILABLE")); }, { once: true });
        started();
      });
      const controller = new AbortController();
      const request = post(form("fast"), tokens.a1, controller.signal).catch((error: Error) => error.name);
      await ready;
      controller.abort();
      assert.equal(await request, "AbortError");
      await done;
      await slotsFree(userA, 1);
    }
    analyze = async () => fixture;
    assert.equal(await status(form("fast")), 200, "with one slot, the next analysis still gets in");
  });

  it("logs carry no tokens, no image bytes and no user id", async () => {
    logs.length = 0;
    assert.equal(await status(form("precise")), 200);
    assert.equal(await status(form("fast"), tokens.a2), 429);
    analyze = async () => { throw new Error(`leaky ${tokens.a1}`); };
    reset();
    assert.equal(await status(form("fast")), 500);
    const text = logs.join("\n");
    const base64 = Buffer.from(png).toString("base64");
    for (const secret of [tokens.a1, tokens.a2, "Bearer", "IMAGE-BYTES-MARKER", base64, base64.slice(0, 16), userA]) {
      assert.ok(!text.includes(secret), `logs contain ${secret.slice(0, 12)}…`);
    }
  });
});
