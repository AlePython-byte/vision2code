import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { UISchemaSchema } from "@vision2code/contracts";
import type { UINode } from "@vision2code/contracts";
import type { AIProvider } from "../src/ai/ai-provider.js";
import { AnalysisImageInputSchema } from "../src/analysis/analysis-image-input.js";
import type { AnalysisImageInput } from "../src/analysis/analysis-image-input.js";
import { AnalyzeInterfaceUseCase } from "../src/analysis/analyze-interface.use-case.js";
import { InvalidAnalysisOutputError } from "../src/analysis/invalid-analysis-output.error.js";

// Tests run from server/dist/tests; fixtures stay outside all production exports.
const fixtures = new URL("../../../packages/contracts/tests/fixtures/", import.meta.url);
const validOutput: unknown = JSON.parse(readFileSync(new URL("simple-interface.json", fixtures), "utf8"));
const invalidOutput: unknown = JSON.parse(readFileSync(new URL("invalid-analysis-output.json", fixtures), "utf8"));

function createInput(): AnalysisImageInput {
  // Synthetic bytes exercise the application boundary, not an image decoder.
  return { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png", width: 640, height: 480 };
}

class StubAIProvider implements AIProvider {
  calls = 0;
  receivedInput: AnalysisImageInput | undefined;
  receivedSignal: AbortSignal | undefined;

  constructor(private readonly output: unknown) {}

  async analyze(input: AnalysisImageInput, signal?: AbortSignal): Promise<unknown> {
    this.calls += 1;
    this.receivedInput = input;
    this.receivedSignal = signal;
    return this.output;
  }
}

test("published recursive declarations preserve strong child types", () => {
  // These assignments must also pass tsc against the built public package entry point.
  type IsAny<Value> = 0 extends (1 & Value) ? true : false;
  const childIsAny: IsAny<UINode["children"][number]> = false;
  const childIdIsAny: IsAny<UINode["children"][number]["id"]> = false;
  assert.equal(childIsAny, false);
  assert.equal(childIdIsAny, false);
});

test("valid provider output returns a runtime-validated UISchema", async () => {
  const provider = new StubAIProvider(validOutput);
  const result = await new AnalyzeInterfaceUseCase(provider).execute(createInput());
  assert.deepEqual(result, UISchemaSchema.parse(validOutput));
  assert.notEqual(result, validOutput);
  assert.equal(provider.calls, 1);
});

test("invalid provider output throws a compact application error without a validation dump", async () => {
  for (const output of [invalidOutput, null, undefined, "```json {} ```", {}, []]) {
    const useCase = new AnalyzeInterfaceUseCase(new StubAIProvider(output));
    await assert.rejects(useCase.execute(createInput()), (error: unknown) => {
      assert.ok(error instanceof InvalidAnalysisOutputError);
      assert.equal(error.name, "InvalidAnalysisOutputError");
      assert.equal(error.message, "Provider output does not satisfy UISchema v1.");
      assert.equal("issues" in error, false);
      return true;
    });
  }
});

test("the provider receives unchanged image bytes, metadata, and the abort signal", async () => {
  const input = createInput();
  const provider = new StubAIProvider(validOutput);
  const signal = new AbortController().signal;
  await new AnalyzeInterfaceUseCase(provider).execute(input, signal);
  assert.deepEqual(provider.receivedInput, input);
  assert.equal(provider.receivedInput?.bytes, input.bytes);
  assert.equal(provider.receivedSignal, signal);
  assert.deepEqual(Object.keys(provider.receivedInput ?? {}).sort(), ["bytes", "height", "mimeType", "width"]);
});

test("output stack selection cannot enter the analysis input", async () => {
  const provider = new StubAIProvider(validOutput);
  const inputWithStack = { ...createInput(), outputStack: "REACT_TAILWIND" };
  await assert.rejects(new AnalyzeInterfaceUseCase(provider).execute(inputWithStack));
  assert.equal(provider.calls, 0);
  assert.equal(AnalysisImageInputSchema.safeParse(inputWithStack).success, false);
});

test("the analysis boundary accepts only the supported MIME types and positive integer dimensions", () => {
  for (const mimeType of ["image/png", "image/jpeg", "image/webp"]) {
    assert.equal(AnalysisImageInputSchema.safeParse({ ...createInput(), mimeType }).success, true);
  }
  for (const patch of [
    { mimeType: "image/svg+xml" }, { mimeType: "image/gif" }, { width: 0 }, { height: -1 }, { width: 1.5 },
    { bytes: new Uint8Array() }, { bytes: "base64" }, { bytes: [1, 2, 3] },
  ]) assert.equal(AnalysisImageInputSchema.safeParse({ ...createInput(), ...patch }).success, false);
});

test("provider failures propagate without retries or fake successful output", async () => {
  const failure = new Error("Provider unavailable in test.");
  let calls = 0;
  const provider: AIProvider = { async analyze() { calls += 1; throw failure; } };
  await assert.rejects(new AnalyzeInterfaceUseCase(provider).execute(createInput()), (error: unknown) => error === failure);
  assert.equal(calls, 1);
});

test("a cancelled request does not invoke the provider", async () => {
  const controller = new AbortController();
  controller.abort();
  const provider = new StubAIProvider(validOutput);
  await assert.rejects(new AnalyzeInterfaceUseCase(provider).execute(createInput(), controller.signal), { name: "AbortError" });
  assert.equal(provider.calls, 0);
});

test("cancellation during provider work prevents returning a late result", async () => {
  const controller = new AbortController();
  const provider: AIProvider = { async analyze() { controller.abort(); return validOutput; } };
  await assert.rejects(new AnalyzeInterfaceUseCase(provider).execute(createInput(), controller.signal), { name: "AbortError" });
});
