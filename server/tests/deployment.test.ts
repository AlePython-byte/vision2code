import "reflect-metadata";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AI_PROVIDER } from "../src/analysis/analysis.constants.js";
import { AppModule } from "../src/app.module.js";
import { configureApplication } from "../src/configure-application.js";
import { DEFAULT_CORS_ORIGINS, readConfiguration, readCorsOrigins } from "../src/configuration.js";

describe("deployment configuration", () => {
  it("listens on loopback locally and on every interface when hosted, HOST overrides", () => {
    assert.equal(readConfiguration({}).host, "127.0.0.1");
    assert.equal(readConfiguration({ NODE_ENV: "production" }).host, "0.0.0.0");
    assert.equal(readConfiguration({ NODE_ENV: "production", HOST: "127.0.0.1" }).host, "127.0.0.1");
  });

  it("adds CORS origins from the environment to the defaults and rejects anything unsafe", () => {
    assert.deepEqual(readCorsOrigins({}), [...DEFAULT_CORS_ORIGINS]);
    const origins = readCorsOrigins({ CORS_ALLOWED_ORIGINS: " https://app.example.com , http://localhost:1420,," });
    assert.ok(origins.includes("https://app.example.com"));
    assert.equal(origins.filter((origin) => origin === "http://localhost:1420").length, 1);
    for (const value of ["*", "https://a.example/path", "not a url", "https://a.example/", "null"]) {
      assert.throws(() => readCorsOrigins({ CORS_ALLOWED_ORIGINS: value }), /CORS_ALLOWED_ORIGINS/);
    }
  });
});

describe("CORS from the environment", () => {
  it("allows a configured origin and denies an unconfigured one", async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue({ analyze() { throw new Error("Unexpected analysis call."); } }).compile();
    const app = module.createNestApplication<NestExpressApplication>();
    app.useLogger(false);
    configureApplication(app, readCorsOrigins({ CORS_ALLOWED_ORIGINS: "https://demo.example.com" }));
    await app.listen(0, "127.0.0.1");
    try {
      const baseUrl = await app.getUrl();
      const call = async (origin: string) => {
        const response = await fetch(`${baseUrl}/api/v1/health`, { headers: { Origin: origin }, signal: AbortSignal.timeout(5000) });
        await response.arrayBuffer();
        return response.headers.get("access-control-allow-origin");
      };
      assert.equal(await call("https://demo.example.com"), "https://demo.example.com");
      assert.equal(await call("tauri://localhost"), "tauri://localhost");
      assert.equal(await call("https://evil.example.com"), null);
    } finally {
      await app.close();
    }
  });
});

describe("server process", () => {
  it("starts on the PORT it is given and answers /api/v1/health without authentication", { timeout: 25_000 }, async () => {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
      });
    });
    const entry = fileURLToPath(new URL("../src/main.js", import.meta.url));
    // Hermetic environment: only what Node needs to run plus harmless placeholders. Nothing from the
    // developer's shell, CI or a .env file leaks in. DATABASE_URL/DIRECT_URL are deliberately absent:
    // PrismaService connects at startup only when DATABASE_URL is set, so a placeholder address would make
    // the server try a real connection and abort (see the next test); /health must not need a database.
    const environment: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      PORT: String(port),
      NODE_ENV: "test",
      SUPABASE_URL: "https://example.supabase.co",
      OPENAI_API_KEY: "test-key",
    };
    if (process.platform === "win32" && process.env.SystemRoot) environment.SystemRoot = process.env.SystemRoot;
    const child = spawn(process.execPath, [entry], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-4000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let exit: string | undefined;
    child.once("exit", (code, signal) => { exit = `code=${code} signal=${signal}`; });
    const ansi = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
    const diagnostics = () => `child ${exit ?? "still running"}; output tail:
${output.replace(ansi, "").slice(-1500)}`;
    try {
      const deadline = Date.now() + 20_000;
      let status = 0;
      while (status !== 200 && exit === undefined && Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
          await response.arrayBuffer();
          status = response.status;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      assert.equal(status, 200, diagnostics());
    } finally {
      child.kill();
    }
  });
});
