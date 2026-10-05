import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import OpenAI from "openai";
import { UISchemaSchema } from "@vision2code/contracts";
import { OpenAIProvider } from "../src/analysis/providers/openai.provider.js";
import { readOpenAIConfiguration, DEFAULT_OPENAI_MODEL, OPENAI_MAX_OUTPUT_TOKENS } from "../src/analysis/providers/openai.configuration.js";
import { ANALYSIS_TIMEOUT_MS } from "../src/analysis/analysis.constants.js";
import { ANALYZER_SYSTEM_PROMPT } from "../src/analysis/prompts/analyzer-system.v1.js";
import { ProviderFailureError } from "../src/analysis/provider-failure.error.js";
import { InvalidAnalysisOutputError } from "../src/analysis/invalid-analysis-output.error.js";
import { AnalyzeInterfaceUseCase } from "../src/analysis/analyze-interface.use-case.js";
import type { AnalysisImageInput } from "../src/analysis/analysis-image-input.js";

const fixture: unknown = JSON.parse(readFileSync(new URL("../../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8"));
const input: AnalysisImageInput = { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png", width: 640, height: 480 };
const configuration = { apiKey: "test-only-secret-never-sent", model: DEFAULT_OPENAI_MODEL };

function response(text = JSON.stringify(fixture), status = "completed", refusal = false) {
  return Response.json({ id: "resp_test", object: "response", status,
    output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed",
      content: [refusal ? { type: "refusal", refusal: "secret-provider-body" } : { type: "output_text", text, annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  });
}

// Every SDK instance uses this injected transport. No test reads a real API key or calls OpenAI.
function provider(fetch: typeof globalThis.fetch, model = DEFAULT_OPENAI_MODEL) {
  return new OpenAIProvider({ ...configuration, model }, new OpenAI({
    apiKey: configuration.apiKey, baseURL: "https://api.openai.com/v1", fetch, logLevel: "off",
    // Deliberately retain SDK retry defaults here to verify per-request overrides.
  }));
}

test("provider configuration requires a key and uses the documented configurable model", () => {
  for (const environment of [{}, { OPENAI_API_KEY: " " }]) {
    assert.throws(() => readOpenAIConfiguration(environment), /OPENAI_API_KEY is required/);
  }
  assert.deepEqual(readOpenAIConfiguration({ OPENAI_API_KEY: " test-only " }), { apiKey: "test-only", model: "gpt-6.1-sol" });
  assert.equal(readOpenAIConfiguration({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "configured-model" }).model, "configured-model");
  assert.throws(() => readOpenAIConfiguration({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: " " }), /OPENAI_MODEL/);
  assert.throws(() => new OpenAIProvider({ apiKey: "", model: DEFAULT_OPENAI_MODEL }), /OPENAI_API_KEY/);
  assert.equal(ANALYSIS_TIMEOUT_MS, 120_000);
  assert.equal(OPENAI_MAX_OUTPUT_TOKENS, 8000);
});

test("Responses wire request includes prompt, metadata, data URL and recursive strict Structured Outputs", async () => {
  let calls = 0;
  const adapter = provider(async (url, options) => {
    calls += 1;
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(options?.method, "POST");
    assert.equal(typeof options?.body, "string");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "gpt-6.1-sol");
    assert.equal(body.instructions, ANALYZER_SYSTEM_PROMPT);
    assert.match(body.instructions, /15-20 meaningful total nodes/);
    assert.match(body.instructions, /Keep nesting shallow/);
    assert.match(body.instructions, /guidance targets, not hard limits/);
    assert.match(body.instructions, /Prioritize global layout, main sections, visible text, and primary controls/);
    assert.match(body.instructions, /Preserve visible text and primary layout relationships/);
    assert.match(body.instructions, /Merge visually related\s+elements/);
    assert.match(body.instructions, /Omit micro-decoration and non-essential visual fragments/);
    assert.match(body.instructions, /nodes for every icon or minor label unless structurally important/);
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(body.max_output_tokens, OPENAI_MAX_OUTPUT_TOKENS);
    assert.equal(body.store, false);
    const content = body.input[0].content;
    assert.match(content[0].text, /640px.*480px.*UISchema v1 only/);
    assert.deepEqual(content[1], { type: "input_image", detail: "auto", image_url: "data:image/png;base64,iVBORw==" });
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.match(JSON.stringify(body.text.format.schema), /"\$ref"/);
    assert.doesNotMatch(JSON.stringify(body), /targetStack|outputStack|REACT_TAILWIND|HTML_CSS/);
    assert.ok(options?.signal);
    return response();
  });
  assert.deepEqual(await adapter.analyze(input), fixture);
  assert.equal(calls, 1);
});

test("the configured model is forwarded without a provider-side hardcoded override", async () => {
  const adapter = provider(async (_url, options) => {
    assert.equal(JSON.parse(String(options?.body)).model, "configured-model"); return response();
  }, "configured-model");
  await adapter.analyze(input);
});

test("the recursive wire schema resolves references and keeps all object properties required", async () => {
  await provider(async (_url, options) => {
    const schema: Record<string, unknown> = JSON.parse(String(options?.body)).text.format.schema;
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const object = value as Record<string, unknown>;
      if (typeof object.$ref === "string") {
        assert.ok(object.$ref.startsWith("#/"));
        let resolved: unknown = schema;
        for (const key of object.$ref.slice(2).split("/")) {
          assert.ok(resolved && typeof resolved === "object");
          resolved = (resolved as Record<string, unknown>)[key.replaceAll("~1", "/").replaceAll("~0", "~")];
        }
        assert.ok(resolved);
      }
      if (object.type === "object") {
        assert.equal(object.additionalProperties, false);
        assert.deepEqual([...(object.required as string[])].sort(), Object.keys(object.properties as object).sort());
      }
      Object.values(object).forEach(visit);
    }
    visit(schema); return response();
  }).analyze(input);
});

test("the use case validates valid JSON returned by the real adapter", async () => {
  const valid = new AnalyzeInterfaceUseCase(provider(async () => response()));
  assert.deepEqual(await valid.execute(input), UISchemaSchema.parse(fixture));
  const invalid = new AnalyzeInterfaceUseCase(provider(async () => response('{"secret-provider-body":true}')));
  await assert.rejects(invalid.execute(input), InvalidAnalysisOutputError);
});

test("malformed, refused and incomplete responses are invalid output without exposing content", async () => {
  for (const makeResponse of [() => response("secret-provider-body"), () => response("", "completed", true), () => response("{}", "incomplete")]) {
    await assert.rejects(provider(async () => makeResponse()).analyze(input), (error: unknown) => {
      assert.ok(error instanceof InvalidAnalysisOutputError);
      assert.doesNotMatch(JSON.stringify(error) + error.message, /secret|provider-body/); return true;
    });
  }
});

for (const [status, kind] of [[429, "RATE_LIMITED"], [500, "UNAVAILABLE"], [401, "UNAVAILABLE"]] as const) {
  test(`SDK HTTP ${status} is sanitized and makes exactly one attempt`, async () => {
    let calls = 0;
    const adapter = provider(async () => {
      calls += 1;
      return Response.json({ error: { message: `${configuration.apiKey} secret-provider-body`, type: "internal_error" } }, { status });
    });
    await assert.rejects(adapter.analyze(input), (error: unknown) => {
      assert.ok(error instanceof ProviderFailureError); assert.equal(error.kind, kind);
      assert.equal("cause" in error, false);
      assert.doesNotMatch(JSON.stringify(error) + error.message, /test-only|secret|provider-body|OpenAI/); return true;
    });
    assert.equal(calls, 1);
  });
}

test("network failure maps to unavailable without retrying or leaking details", async () => {
  let calls = 0;
  await assert.rejects(provider(async () => { calls += 1; throw new Error("secret-network-details"); }).analyze(input),
    (error: unknown) => error instanceof ProviderFailureError && error.kind === "UNAVAILABLE" && !error.message.includes("secret"));
  assert.equal(calls, 1);
});

test("failed and cancelled Responses statuses map to provider unavailability", async () => {
  for (const status of ["failed", "cancelled"]) {
    await assert.rejects(provider(async () => response("secret-provider-body", status)).analyze(input),
      (error: unknown) => error instanceof ProviderFailureError && error.kind === "UNAVAILABLE");
  }
});

test("the SDK transport times out at the named deadline without retries", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let calls = 0;
  let aborted = false;
  const adapter = provider(async (_url, options) => new Promise<Response>((_resolve, reject) => {
    calls += 1;
    assert.ok(options?.signal);
    options.signal.addEventListener("abort", () => { aborted = true; reject(new Error("secret-timeout-details")); }, { once: true });
    started();
  }));
  const pending = assert.rejects(adapter.analyze(input),
    (error: unknown) => error instanceof ProviderFailureError && error.kind === "UNAVAILABLE");
  await ready;
  context.mock.timers.tick(ANALYSIS_TIMEOUT_MS - 1);
  assert.equal(aborted, false);
  context.mock.timers.tick(1);
  await pending;
  assert.equal(aborted, true);
  assert.equal(calls, 1);
});

test("cancellation aborts the SDK transport and returns a sanitized availability failure", async () => {
  const controller = new AbortController();
  let aborted = false;
  const adapter = provider(async (_url, options) => new Promise<Response>((_resolve, reject) => {
    assert.ok(options?.signal);
    options.signal.addEventListener("abort", () => { aborted = true; reject(new Error("secret-abort-details")); }, { once: true });
    controller.abort();
  }));
  await assert.rejects(adapter.analyze(input, controller.signal),
    (error: unknown) => error instanceof ProviderFailureError && error.kind === "UNAVAILABLE");
  assert.equal(aborted, true);
});
