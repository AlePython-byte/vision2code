import assert from "node:assert/strict";
import test from "node:test";
import { ApiErrorResponseSchema, RequestIdSchema } from "../dist/index.js";

test("API error envelope validates correlation metadata and rejects leaked fields", () => {
  const error = { code: "INTERNAL_ERROR", message: "Ha ocurrido un error inesperado.", requestId: "test-123" };
  assert.equal(ApiErrorResponseSchema.safeParse({ error }).success, true);
  for (const value of [
    { error: { ...error, code: "FUTURE_ERROR" } },
    { error: { ...error, requestId: "" } },
    { error: { ...error, message: "" } },
    { error: { ...error, stack: "internal detail" } },
    { error, debug: "internal detail" },
  ]) assert.equal(ApiErrorResponseSchema.safeParse(value).success, false);
});

test("request IDs are bounded, printable correlation identifiers", () => {
  for (const value of ["request-123", "client:001_abc.def", "a".repeat(128)]) {
    assert.equal(RequestIdSchema.safeParse(value).success, true);
  }
  for (const value of ["", " ", "line\r\nbreak", "a".repeat(129), "two, values", ["a", "b"]]) {
    assert.equal(RequestIdSchema.safeParse(value).success, false);
  }
});

test("the analysis quota error carries the wait in seconds; nothing else is added", () => {
  const error = { code: "ANALYSIS_QUOTA_EXCEEDED", message: "Has alcanzado tu límite de análisis.", requestId: "test-123" };
  assert.equal(ApiErrorResponseSchema.safeParse({ error }).success, true, "retryAfterSeconds is optional");
  assert.equal(ApiErrorResponseSchema.safeParse({ error: { ...error, retryAfterSeconds: 120 } }).success, true);
  for (const retryAfterSeconds of [0, -1, 1.5, 86_401, "120", null]) {
    assert.equal(ApiErrorResponseSchema.safeParse({ error: { ...error, retryAfterSeconds } }).success, false, String(retryAfterSeconds));
  }
  assert.equal(ApiErrorResponseSchema.safeParse({ error: { ...error, retryAfterSeconds: 60, remainingUnits: 3 } }).success, false, "no other quota detail leaks");
});

test("the analysis timeout is its own error code, with no wait attached", () => {
  const error = { code: "AI_TIMEOUT", message: "El análisis tardó demasiado.", requestId: "test-123" };
  assert.equal(ApiErrorResponseSchema.safeParse({ error }).success, true);
  assert.equal(ApiErrorResponseSchema.safeParse({ error: { ...error, code: "AI_TIME_OUT" } }).success, false);
});
