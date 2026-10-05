import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Test } from "@nestjs/testing";
import { AI_PROVIDER } from "../src/analysis/analysis.constants.js";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ApiErrorResponseSchema } from "@vision2code/contracts";
import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/configure-application.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("HTTP boundary", () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue({ analyze() { throw new Error("Unexpected analysis call."); } }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useLogger(false);
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  after(async () => { await app?.close(); });

  function request(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
  }

  it("serves health with a generated request ID and no implementation header", async () => {
    const response = await request("/api/v1/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "vision2code-api" });
    assert.match(response.headers.get("x-request-id") ?? "", uuidPattern);
    assert.equal(response.headers.get("x-powered-by"), null);
  });

  it("propagates a valid incoming request ID", async () => {
    const response = await request("/api/v1/health", { headers: { "X-Request-Id": "desktop:request-123" } });
    assert.equal(response.headers.get("x-request-id"), "desktop:request-123");
    await response.arrayBuffer();
  });

  it("replaces empty, overlong, and malformed request IDs with a UUID", async () => {
    for (const value of ["", "a".repeat(129), "invalid value", "first, second"]) {
      const response = await request("/api/v1/health", { headers: { "X-Request-Id": value } });
      assert.match(response.headers.get("x-request-id") ?? "", uuidPattern);
      await response.arrayBuffer();
    }
  });

  it("returns a Spanish NOT_FOUND envelope correlated with its response header", async () => {
    const response = await request("/api/v1/missing", { headers: { "X-Request-Id": "missing-123" } });
    assert.equal(response.status, 404);
    const body = ApiErrorResponseSchema.parse(await response.json());
    assert.deepEqual(body, {
      error: { code: "NOT_FOUND", message: "No se encontró el recurso solicitado.", requestId: "missing-123" },
    });
    assert.equal(response.headers.get("x-request-id"), body.error.requestId);
  });

  it("does not expose an unversioned health endpoint", async () => {
    for (const path of ["/health", "/", "/api/v1", "/api/v1/"]) {
      const response = await request(path);
      assert.equal(response.status, 404);
      const body = ApiErrorResponseSchema.parse(await response.json());
      assert.equal(body.error.code, "NOT_FOUND");
      assert.equal(body.error.requestId, response.headers.get("x-request-id"));
    }
  });

  it("normalizes malformed JSON before routing and still includes the request ID", async () => {
    const response = await request("/api/v1/missing", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Request-Id": "bad-json-123" }, body: "{",
    });
    assert.equal(response.status, 400);
    const body = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(body.error.code, "INVALID_REQUEST");
    assert.equal(body.error.message, "La solicitud no es válida.");
    assert.equal(body.error.requestId, "bad-json-123");
    assert.equal(response.headers.get("x-request-id"), body.error.requestId);
  });

  it("allows the explicit Vite origin and exposes only the correlation header", async () => {
    const response = await request("/api/v1/health", { headers: { Origin: "http://localhost:1420" } });
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:1420");
    assert.equal(response.headers.get("access-control-expose-headers"), "X-Request-Id");
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
    await response.arrayBuffer();
  });

  it("does not grant CORS access to an unlisted origin", async () => {
    const response = await request("/api/v1/health", { headers: { Origin: "https://unlisted.example" } });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    await response.arrayBuffer();
  });

  it("includes a request ID on CORS preflight responses", async () => {
    const response = await request("/api/v1/health", {
      method: "OPTIONS", headers: { Origin: "http://localhost:1420", "Access-Control-Request-Method": "GET" },
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get("x-request-id") ?? "", uuidPattern);
    assert.equal(response.headers.get("access-control-allow-methods"), "GET,POST");
  });

  it("allows POST preflight from explicit packaged Tauri origins", async () => {
    for (const origin of ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]) {
      const response = await request("/api/v1/analyses", {
        method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type" },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal(response.headers.get("access-control-allow-methods"), "GET,POST");
      assert.equal(response.headers.get("access-control-allow-credentials"), null);
    }
  });

});
