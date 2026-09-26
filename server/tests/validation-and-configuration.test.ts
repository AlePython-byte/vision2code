import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { readConfiguration } from "../src/configuration.js";
import { ZodValidationPipe } from "../src/http/zod-validation.pipe.js";

test("configuration supplies the default port and validates explicit ports", () => {
  assert.equal(readConfiguration({}).port, 3000);
  assert.equal(readConfiguration({ PORT: "4200" }).port, 4200);
  for (const PORT of ["", "0", "-1", "65536", "3.5", "invalid", "1e3"]) {
    assert.throws(() => readConfiguration({ PORT }), /PORT/);
  }
});

test("the reusable pipe returns parsed output and rejects invalid input without exposing Zod details", async () => {
  const pipe = new ZodValidationPipe(z.string().trim().min(1).transform((value) => value.toUpperCase()));
  assert.equal(await pipe.transform(" value "), "VALUE");
  await assert.rejects(pipe.transform(42), BadRequestException);
  await assert.rejects(pipe.transform(" "), BadRequestException);
});

test("the validation pipe supports asynchronous refinements", async () => {
  const pipe = new ZodValidationPipe(z.string().refine(async (value) => value === "valid"));
  assert.equal(await pipe.transform("valid"), "valid");
  await assert.rejects(pipe.transform("invalid"), BadRequestException);
});
