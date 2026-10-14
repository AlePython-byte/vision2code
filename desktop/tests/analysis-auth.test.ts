import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AnalysisResponseSchema } from "@vision2code/contracts";
import { AnalysisClientError, createAnalysisClient, DEFAULT_API_BASE_URL } from "../src/features/analysis/analysisClient.ts";
import { createAnalysisModel } from "../src/features/analysis/analysisModel.ts";
import { createWorkspaceServices } from "../src/features/workspace/workspaceServices.ts";
import { deferred, screenshot, uiSchemaFixture } from "./generation-fixtures.ts";

const result = AnalysisResponseSchema.parse({ requestId: "auth-test", uiSchema: uiSchemaFixture });
const signal = () => new AbortController().signal;
const unauthorizedBody = { error: { code: "UNAUTHORIZED", message: "No autorizado.", requestId: "server-401" } };

function counted(respond: () => Promise<Response> | Response = () => Response.json(result)) {
  const requests: { url: string; authorization: string | null }[] = [];
  const transport: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), authorization: new Headers(init?.headers).get("Authorization") });
    return respond();
  };
  return { requests, transport };
}

test("the analysis client sends the session's bearer token, read fresh for every request", async () => {
  let issued = 0;
  const { requests, transport } = counted();
  const analyze = createAnalysisClient(undefined, transport, { getAccessToken: async () => `token-${++issued}` });
  assert.deepEqual(await analyze(screenshot(), signal()), result);
  await analyze(screenshot(), signal());
  assert.deepEqual(requests, [
    { url: DEFAULT_API_BASE_URL + "/analyses", authorization: "Bearer token-1" },
    { url: DEFAULT_API_BASE_URL + "/analyses", authorization: "Bearer token-2" },
  ]);
});

test("without a token nothing is sent: UNAUTHORIZED and onUnauthorized exactly once", async () => {
  for (const getAccessToken of [async () => null, async () => "  ", async () => { throw new Error("storage locked"); }]) {
    let expired = 0;
    const { requests, transport } = counted();
    const analyze = createAnalysisClient(undefined, transport, { getAccessToken, onUnauthorized: () => { expired++; } });
    await assert.rejects(analyze(screenshot(), signal()), (error) => error instanceof AnalysisClientError && error.code === "UNAUTHORIZED");
    assert.equal(requests.length, 0, "no request reaches the server");
    assert.equal(expired, 1);
  }
});

test("a 401 response calls onUnauthorized once per request, with or without the error envelope", async () => {
  for (const respond of [() => Response.json(unauthorizedBody, { status: 401 }), () => new Response("denied", { status: 401 })]) {
    let expired = 0;
    const { transport } = counted(respond);
    const analyze = createAnalysisClient(undefined, transport, { getAccessToken: async () => "stale", onUnauthorized: () => { expired++; } });
    const error = await analyze(screenshot(), signal()).catch((reason: unknown) => reason);
    assert.ok(error instanceof AnalysisClientError);
    assert.equal(error.code, "UNAUTHORIZED");
    assert.match(error.message, /sesión/);
    assert.equal(expired, 1);
  }
});

test("5xx, rate limits, invalid output and network failures never expire the session", async () => {
  const failures: (() => Promise<Response> | Response)[] = [
    () => Response.json({ error: { code: "AI_UNAVAILABLE", message: "x", requestId: "r1" } }, { status: 503 }),
    () => Response.json({ error: { code: "INTERNAL_ERROR", message: "x", requestId: "r2" } }, { status: 500 }),
    () => Response.json({ error: { code: "AI_RATE_LIMITED", message: "x", requestId: "r3" } }, { status: 429 }),
    () => new Response("bad gateway", { status: 502 }),
    () => { throw new TypeError("Failed to fetch"); },
  ];
  for (const respond of failures) {
    let expired = 0;
    const { transport } = counted(respond);
    const analyze = createAnalysisClient(undefined, transport, { getAccessToken: async () => "token", onUnauthorized: () => { expired++; } });
    await assert.rejects(analyze(screenshot(), signal()), AnalysisClientError);
    assert.equal(expired, 0);
  }
});

test("cancelling while the token is read sends nothing and does not expire the session", async () => {
  const token = deferred<string | null>();
  let expired = 0;
  const { requests, transport } = counted();
  const analyze = createAnalysisClient(undefined, transport, { getAccessToken: () => token.promise, onUnauthorized: () => { expired++; } });
  const controller = new AbortController();
  const running = analyze(screenshot(), controller.signal);
  controller.abort();
  token.resolve(null);
  await assert.rejects(running, /cancelado/);
  assert.equal(requests.length, 0);
  assert.equal(expired, 0);
});

test("the analysis model reports the 401 as a safe error and expires the session once", async () => {
  let expired = 0;
  const { transport } = counted(() => Response.json(unauthorizedBody, { status: 401 }));
  const model = createAnalysisModel(createAnalysisClient(undefined, transport, { getAccessToken: async () => "stale", onUnauthorized: () => { expired++; } }));
  model.setScreenshot(screenshot());
  await model.analyze();
  assert.equal(model.getSnapshot().status, "ERROR");
  assert.match(model.getSnapshot().error ?? "", /sesión/);
  assert.equal(expired, 1);
});

test("workspace services build the authenticated analysis client from the injected token and callback", async () => {
  let expired = 0;
  let status = 200;
  const requests: { url: string; authorization: string | null }[] = [];
  const services = createWorkspaceServices({
    getAccessToken: async () => "workspace-token",
    onUnauthorized: () => { expired++; },
    baseUrl: "http://localhost:3000/api/v1",
    transport: async (url, init) => {
      requests.push({ url: String(url), authorization: new Headers(init?.headers).get("Authorization") });
      return status === 200 ? Response.json(result) : Response.json(unauthorizedBody, { status });
    },
  });
  await services.analyzeScreenshot(screenshot(), signal());
  assert.deepEqual(requests, [{ url: "http://localhost:3000/api/v1/analyses", authorization: "Bearer workspace-token" }]);
  status = 401;
  await assert.rejects(services.analyzeScreenshot(screenshot(), signal()), AnalysisClientError);
  assert.equal(expired, 1);
  status = 503;
  await assert.rejects(services.analyzeScreenshot(screenshot(), signal()), AnalysisClientError);
  assert.equal(expired, 1, "5xx never expires the session");
});

test("the capture console receives the services' authenticated client end to end", () => {
  const read = (file: string) => readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  assert.match(read("workspace/ApplicationShell.tsx"), /<Workspace [^>]*analyzeScreenshot=\{services\?\.analyzeScreenshot\}/);
  assert.match(read("workspace/Workspace.tsx"), /<CaptureConsole [^>]*analyzeScreenshot=\{analyzeScreenshot\}/);
  assert.match(read("analysis/CaptureConsole.tsx"), /useAnalysis\([^)]*, analyzeScreenshot\)/);
  assert.match(read("analysis/useAnalysis.ts"), /createAnalysisModel\(analyzeScreenshot \?\? createAnalysisClient\(/);
  // The analysis feature never imports auth; the token and the expiry callback are injected.
  for (const file of ["analysis/analysisClient.ts", "analysis/analysisModel.ts", "analysis/useAnalysis.ts", "analysis/CaptureConsole.tsx"]) {
    assert.doesNotMatch(read(file), /from "\.\.\/auth\//, file);
  }
});
