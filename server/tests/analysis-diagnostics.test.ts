import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { TestContext } from "node:test";
import OpenAI from "openai";
import { UISchemaSchema } from "@vision2code/contracts";
import { OpenAIProvider } from "../src/analysis/providers/openai.provider.js";
import { AnalyzeInterfaceUseCase } from "../src/analysis/analyze-interface.use-case.js";
import { InvalidAnalysisOutputError } from "../src/analysis/invalid-analysis-output.error.js";
import { ProviderFailureError } from "../src/analysis/provider-failure.error.js";
import { logAnalysisDiagnostic } from "../src/analysis/analysis-diagnostics.js";

const fixture = UISchemaSchema.parse(JSON.parse(readFileSync(
  new URL("../../../packages/contracts/tests/fixtures/simple-interface.json", import.meta.url), "utf8")));
const input = { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png" as const, width: 640, height: 480 };
const secret = "SENSITIVE_TEST_SENTINEL";

function capture(context: TestContext) {
  const environment = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  context.after(() => {
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
  });
  const entries: Array<Record<string, unknown>> = [];
  context.mock.method(console, "info", (message: string) => { entries.push(JSON.parse(message)); });
  context.after(() => {
    const serialized = JSON.stringify(entries);
    assert.doesNotMatch(serialized, /SENSITIVE_TEST_SENTINEL|iVBORw==|Authorization|Bearer|data:image|Mi espacio/);
  });
  return entries;
}

// All provider responses use a local SDK transport; no real credentials or live network calls.
function adapter(payload: unknown, status = 200) {
  return new OpenAIProvider({ apiKey: secret, model: "gpt-6.1-sol" }, new OpenAI({
    apiKey: secret, logLevel: "off", fetch: async () => Response.json(payload, { status }),
  }));
}
function payload(text: string, status = "completed") {
  return { id: "resp_test", object: "response", status, output: [{ id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] };
}

test("diagnostics identify token-limited incomplete responses using safe metadata", async (context) => {
  const entries = capture(context);
  await assert.rejects(adapter({
    ...payload(secret, "incomplete"),
    incomplete_details: { reason: "max_output_tokens", privateDetail: secret },
    output_parsed: { privateContent: secret },
  }).analyze(input), InvalidAnalysisOutputError);
  const response = entries.find((entry) => entry.event === "provider_response");
  assert.deepEqual(response?.incompleteDetails, { reason: "max_output_tokens" });
  assert.equal(response?.status, "incomplete");
  assert.equal(response?.completed, false);
  assert.equal(response?.incomplete, true);
  assert.equal(response?.hasParsedOutput, true);
  assert.equal(entries.some((entry) => entry.event === "output_parse_failed"), false);
});

test("create responses without output_parsed still parse and validate successfully", async (context) => {
  const entries = capture(context);
  const result = await new AnalyzeInterfaceUseCase(adapter(payload(JSON.stringify(fixture)))).execute(input);
  assert.deepEqual(result, fixture);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.hasParsedOutput, false);
  assert.equal(entries[0]?.hasOutputText, true);
  assert.equal(entries[0]?.completed, true);
  assert.equal(entries[0]?.parser, "JSON.parse");
});

test("missing text and malformed JSON are distinguished from final schema failures", async (context) => {
  const entries = capture(context);
  for (const text of ["", secret]) {
    await assert.rejects(adapter(payload(text)).analyze(input), InvalidAnalysisOutputError);
  }
  assert.equal(entries.filter((entry) => entry.event === "output_parse_failed").length, 2);
  assert.equal(entries.some((entry) => entry.event === "ui_schema_validation_failed"), false);
  assert.equal(entries[0]?.hasOutputText, false);
  assert.ok(entries.some((entry) => entry.errorName === "SyntaxError"));
});

test("final validation diagnostics contain only bounded issue paths and codes", async (context) => {
  const entries = capture(context);
  const invalid = { ...fixture, root: { ...fixture.root, style: { ...fixture.root.style, opacity: secret }, [secret]: secret } };
  await assert.rejects(new AnalyzeInterfaceUseCase(adapter(payload(JSON.stringify(invalid)))).execute(input), InvalidAnalysisOutputError);
  const validation = entries.find((entry) => entry.event === "ui_schema_validation_failed");
  assert.ok(validation);
  const issues = validation.issues as Array<{ path: string; code: string }>;
  assert.ok(issues.some((issue) => issue.path === "root.style.opacity" && issue.code === "invalid_type"));
  for (const issue of issues) assert.deepEqual(Object.keys(issue).sort(), ["code", "path"]);
  assert.equal(entries.some((entry) => entry.event === "output_parse_failed"), false);
});

test("SDK diagnostics retain status and allowlisted codes but never error messages or headers", async (context) => {
  const entries = capture(context);
  for (const code of ["rate_limit_exceeded", secret]) {
    await assert.rejects(adapter({ error: { code, message: secret, type: secret }, headers: { Authorization: secret } }, 429).analyze(input), ProviderFailureError);
  }
  const errors = entries.filter((entry) => entry.event === "provider_error");
  assert.equal(errors[0]?.httpStatus, 429);
  assert.equal(errors[0]?.errorName, "RateLimitError");
  assert.equal(errors[0]?.errorCode, "rate_limit_exceeded");
  assert.equal(errors[1]?.errorCode, "other");
});

test("untrusted response status and incomplete reason are redacted", async (context) => {
  const entries = capture(context);
  await assert.rejects(adapter({ ...payload(secret, secret), incomplete_details: { reason: secret },
    error: { code: secret, message: secret } }).analyze(input), InvalidAnalysisOutputError);
  assert.equal(entries[0]?.status, "other");
  assert.deepEqual(entries[0]?.incompleteDetails, { reason: "other" });
  assert.equal(entries[0]?.errorCode, "other");
});

test("diagnostics cap large Zod issue lists", async (context) => {
  const entries = capture(context);
  await assert.rejects(new AnalyzeInterfaceUseCase({ async analyze() {
    return { ...fixture, root: { ...fixture.root, children: Array.from({ length: 30 }, () => ({})) } };
  } }).execute(input), InvalidAnalysisOutputError);
  assert.equal((entries[0]?.issues as unknown[]).length, 20);
  assert.equal(entries[0]?.truncated, true);
});

test("development diagnostics are disabled in production", async (context) => {
  const entries = capture(context);
  process.env.NODE_ENV = "production";
  await assert.rejects(new AnalyzeInterfaceUseCase(adapter(payload("{}"))).execute(input), InvalidAnalysisOutputError);
  assert.deepEqual(entries, []);
});

test("a failed diagnostic sink cannot change analysis results", (context) => {
  capture(context);
  context.mock.method(console, "info", () => { throw new Error("Logging sink unavailable."); });
  assert.doesNotThrow(() => logAnalysisDiagnostic("test_event", { completed: true }));
});
