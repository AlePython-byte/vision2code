import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../src/app.module.js";
import { SUPABASE_JWT_VERIFIER } from "../src/auth/supabase-auth.guard.js";
import { JoseSupabaseJwtVerifier } from "../src/auth/supabase-jwt-verifier.js";
import { configureApplication } from "../src/configure-application.js";
import { AI_PROVIDER } from "../src/analysis/analysis.constants.js";
import { ApiErrorResponseSchema } from "@vision2code/contracts";

describe("Backend Auth Module & JWT Verification", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let privateKey: any;
  let publicKeyJwk: any;
  const issuer = "https://example-project.supabase.co/auth/v1";
  const audience = "authenticated";

  before(async () => {
    // Generate an in-memory asymmetric keypair (RS256) for deterministic tests
    const keyPair = await generateKeyPair("RS256");
    privateKey = keyPair.privateKey;
    publicKeyJwk = await exportJWK(keyPair.publicKey);
    publicKeyJwk.kid = "test-key-id-1";
    publicKeyJwk.alg = "RS256";

    // In-memory key getter simulating JWKS
    const keySetOverride = async (header: any) => {
      if (header.kid && header.kid !== publicKeyJwk.kid) {
        throw new Error("Unknown key ID");
      }
      return keyPair.publicKey;
    };

    const testVerifier = new JoseSupabaseJwtVerifier({
      expectedIssuer: issuer,
      expectedAudience: audience,
      keySetOverride,
    });

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue({ analyze() { throw new Error("Unexpected analysis call."); } })
      .overrideProvider(SUPABASE_JWT_VERIFIER).useValue(testVerifier)
      .compile();

    app = module.createNestApplication<NestExpressApplication>();
    app.useLogger(false);
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  after(async () => {
    await app?.close();
  });

  function makeRequest(path: string, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
  }

  async function createValidJwt(payload: Record<string, any> = {}, overrides: Record<string, any> = {}) {
    const builder = new SignJWT({
      email: "user@example.com",
      role: "authenticated",
      ...payload,
    })
      .setProtectedHeader({ alg: "RS256", kid: publicKeyJwk.kid })
      .setIssuedAt()
      .setIssuer(overrides.issuer !== undefined ? overrides.issuer : issuer)
      .setAudience(overrides.audience !== undefined ? overrides.audience : audience)
      .setExpirationTime(overrides.expirationTime !== undefined ? overrides.expirationTime : "2h");

    if (overrides.sub !== null) {
      builder.setSubject(overrides.sub ?? "usr_test_12345");
    }

    return builder.sign(privateKey);
  }

  it("1. no bearer token returns 401 and standard error envelope", async () => {
    const response = await makeRequest("/api/v1/auth/me");
    assert.equal(response.status, 401);
    const body = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  it("2. malformed Authorization header returns 401", async () => {
    for (const header of ["Basic 12345", "Bearer", "Bearer token extra", "Token abc"]) {
      const response = await makeRequest("/api/v1/auth/me", { Authorization: header });
      assert.equal(response.status, 401);
      const body = ApiErrorResponseSchema.parse(await response.json());
      assert.equal(body.error.code, "UNAUTHORIZED");
    }
  });

  it("3. malformed JWT string returns 401", async () => {
    const response = await makeRequest("/api/v1/auth/me", { Authorization: "Bearer not-a-real-jwt" });
    assert.equal(response.status, 401);
    const body = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  it("4. expired JWT returns 401", async () => {
    const expiredToken = await createValidJwt({}, { expirationTime: "-10s" });
    const response = await makeRequest("/api/v1/auth/me", { Authorization: `Bearer ${expiredToken}` });
    assert.equal(response.status, 401);
    const body = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  it("5. wrong signing key returns 401", async () => {
    const otherKeyPair = await generateKeyPair("RS256");
    const otherToken = await new SignJWT({ email: "user@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: publicKeyJwk.kid })
      .setSubject("usr_test_12345")
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime("2h")
      .sign(otherKeyPair.privateKey);

    const response = await makeRequest("/api/v1/auth/me", { Authorization: `Bearer ${otherToken}` });
    assert.equal(response.status, 401);
    const body = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  it("6. wrong issuer returns 401", async () => {
    const tokenWrongIssuer = await createValidJwt({}, { issuer: "https://attacker.supabase.co/auth/v1" });
    const response = await makeRequest("/api/v1/auth/me", { Authorization: `Bearer ${tokenWrongIssuer}` });
    assert.equal(response.status, 401);
    const body = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  it("7. missing sub claim returns 401", async () => {
    const tokenNoSub = await createValidJwt({}, { sub: null });
    const response = await makeRequest("/api/v1/auth/me", { Authorization: `Bearer ${tokenNoSub}` });
    assert.equal(response.status, 401);
    const body = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  it("8. valid JWT succeeds and returns verified identity", async () => {
    const token = await createValidJwt({ email: "developer@vision2code.app" }, { sub: "usr_verified_999" });
    const response = await makeRequest("/api/v1/auth/me", { Authorization: `Bearer ${token}` });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      id: "usr_verified_999",
      email: "developer@vision2code.app",
    });
  });

  it("9. @CurrentUser extracts verified sub identity exclusively", async () => {
    const token = await createValidJwt({ email: "auditor@domain.com" }, { sub: "usr_auditor_42" });
    const response = await makeRequest("/api/v1/auth/me", { Authorization: `Bearer ${token}` });
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.id, "usr_auditor_42");
    assert.equal(body.email, "auditor@domain.com");
  });

  it("10. spoofed body or header userId cannot alter verified identity", async () => {
    const token = await createValidJwt({ email: "real@domain.com" }, { sub: "real_sub_100" });
    const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-User-Id": "spoofed_admin_id",
      },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as any;
    assert.equal(body.id, "real_sub_100");
  });

  it("11. response never includes bearer token or sensitive auth secrets", async () => {
    const token = await createValidJwt();
    const response = await makeRequest("/api/v1/auth/me", { Authorization: `Bearer ${token}` });
    const text = await response.text();
    assert.ok(!text.includes(token));
    assert.ok(!text.includes("RS256"));
    assert.ok(!text.includes("privateKey"));
  });

  it("12. auth error uses standard API error envelope with request ID", async () => {
    const response = await makeRequest("/api/v1/auth/me", {
      "X-Request-Id": "req-custom-auth-1",
    });
    assert.equal(response.status, 401);
    const body = ApiErrorResponseSchema.parse(await response.json());
    assert.equal(body.error.requestId, "req-custom-auth-1");
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  it("13. verifier does not expose raw cryptographic error detail to clients", async () => {
    const response = await makeRequest("/api/v1/auth/me", {
      Authorization: "Bearer garbage.corrupt.token",
    });
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.ok(!text.includes("JWS"));
    assert.ok(!text.includes("JWKS"));
    assert.ok(!text.includes("signature"));
    assert.ok(!text.includes("jose"));
  });
});
