import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AnalysisResponseSchema, ApiErrorCodeSchema } from "../dist/index.js";

const uiSchema: unknown = JSON.parse(readFileSync(new URL("./fixtures/simple-interface.json", import.meta.url), "utf8"));

test("analysis response validates the request ID and UISchema without accepting extra output", () => {
  const response = { requestId: "analysis-123", uiSchema };
  assert.deepEqual(AnalysisResponseSchema.parse(response), response);
  for (const invalid of [{ ...response, requestId: "invalid id" }, { ...response, uiSchema: {} },
    { ...response, sourceCode: "untrusted" }, { uiSchema }, { requestId: "analysis-123" }]) {
    assert.equal(AnalysisResponseSchema.safeParse(invalid).success, false);
  }
});

test("analysis failures use the shared API error vocabulary", () => {
  for (const code of ["UNSUPPORTED_IMAGE", "IMAGE_TOO_LARGE", "AI_RATE_LIMITED", "AI_UNAVAILABLE", "AI_OUTPUT_INVALID"]) {
    assert.equal(ApiErrorCodeSchema.parse(code), code);
  }
  assert.equal(ApiErrorCodeSchema.safeParse("SDK_ERROR").success, false);
});
