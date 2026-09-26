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
