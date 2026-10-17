import assert from "node:assert/strict";
import test from "node:test";
import { ANALYSIS_SERVER_TIMEOUT_MS } from "@vision2code/contracts";
import { DEFAULT_ANALYSIS_DEADLINES, MIN_ANALYSIS_DEADLINE_SECONDS, readAnalysisDeadlines } from "../src/analysis/analysis-deadlines.js";
import { ConfigurationError } from "../src/configuration-error.js";

test("deadlines default to the contract's and can only be shortened, never beyond it or below the floor", () => {
  assert.deepEqual(readAnalysisDeadlines({}), ANALYSIS_SERVER_TIMEOUT_MS);
  assert.deepEqual(DEFAULT_ANALYSIS_DEADLINES, { fast: 120_000, balanced: 180_000, precise: 300_000 });
  assert.deepEqual(readAnalysisDeadlines({ ANALYSIS_PRECISE_TIMEOUT_SECONDS: "20", ANALYSIS_FAST_TIMEOUT_SECONDS: " 60 " }),
    { fast: 60_000, balanced: 180_000, precise: 20_000 });
  assert.equal(readAnalysisDeadlines({ ANALYSIS_PRECISE_TIMEOUT_SECONDS: "99999" }).precise, 300_000, "the client waits the contract's deadline + 30 s: never longer");
  assert.equal(readAnalysisDeadlines({ ANALYSIS_BALANCED_TIMEOUT_SECONDS: "0" }).balanced, MIN_ANALYSIS_DEADLINE_SECONDS * 1000);
});

test("a malformed deadline stops startup naming the variable, never its value", () => {
  for (const value of ["-5", "1.5", "slow", "1e3", "secret-value-42"]) {
    assert.throws(() => readAnalysisDeadlines({ ANALYSIS_PRECISE_TIMEOUT_SECONDS: value }), (error: Error) =>
      error instanceof ConfigurationError && error.message.includes("ANALYSIS_PRECISE_TIMEOUT_SECONDS") && !error.message.includes(value), value);
  }
});
