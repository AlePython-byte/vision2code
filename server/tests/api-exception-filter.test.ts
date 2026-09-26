import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { HttpException, Logger } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { ApiErrorResponseSchema } from "@vision2code/contracts";
import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";

test("the global filter hides unexpected exception details without a test-only route", (context) => {
  context.mock.method(Logger.prototype, "error", () => {});
  let status: number | undefined;
  let body: unknown;
  const headers = new Map<string, string>();
  const response = {
    headersSent: false,
    setHeader(name: string, value: string) { headers.set(name, value); },
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; },
  };
  // The filter uses only these HTTP context methods; no server route is added for this test.
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ requestId: "error-123" }),
      getResponse: () => response,
    }),
  } as ArgumentsHost;

  const filter = new ApiExceptionFilter();
  for (const error of [new Error("sensitive internal details"), "unexpected thrown value"]) {
    filter.catch(error, host);
    assert.equal(status, 500);
    assert.deepEqual(ApiErrorResponseSchema.parse(body), {
      error: { code: "INTERNAL_ERROR", message: "Ha ocurrido un error inesperado.", requestId: "error-123" },
    });
    assert.equal(headers.get("X-Request-Id"), "error-123");
  }

  for (const httpStatus of [400, 403, 404, 413, 422, 503]) {
    filter.catch(new HttpException({ message: "private implementation detail", stack: "private trace" }, httpStatus), host);
    assert.equal(status, httpStatus);
    const envelope = ApiErrorResponseSchema.parse(body);
    assert.equal(envelope.error.code, httpStatus >= 500 ? "INTERNAL_ERROR" : httpStatus === 404 ? "NOT_FOUND" : "INVALID_REQUEST");
    assert.equal(JSON.stringify(body).includes("private"), false);
  }
});
