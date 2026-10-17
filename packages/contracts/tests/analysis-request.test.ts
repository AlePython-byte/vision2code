import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYSIS_CLIENT_GRACE_MS, ANALYSIS_SERVER_TIMEOUT_MS, AnalysisFidelitySchema, ApiErrorCodeSchema,
  DEFAULT_ANALYSIS_FIDELITY, analysisClientTimeoutMs,
} from "../dist/index.js";

test("fidelity is exactly fast, balanced or precise, lowercase, defaulting to balanced", () => {
  assert.deepEqual(AnalysisFidelitySchema.options, ["fast", "balanced", "precise"]);
  for (const value of ["fast", "balanced", "precise"]) assert.equal(AnalysisFidelitySchema.safeParse(value).success, true);
  for (const value of ["FAST", "Precise", "turbo", "", null, 1, undefined]) assert.equal(AnalysisFidelitySchema.safeParse(value).success, false, String(value));
  assert.equal(DEFAULT_ANALYSIS_FIDELITY, "balanced");
});

test("per-mode deadlines: precise waits longest, and the client always outlasts the server", () => {
  assert.deepEqual(ANALYSIS_SERVER_TIMEOUT_MS, { fast: 120_000, balanced: 180_000, precise: 300_000 });
  assert.ok(Object.isFrozen(ANALYSIS_SERVER_TIMEOUT_MS));
  for (const mode of AnalysisFidelitySchema.options) {
    assert.equal(analysisClientTimeoutMs(mode), ANALYSIS_SERVER_TIMEOUT_MS[mode] + ANALYSIS_CLIENT_GRACE_MS);
  }
  assert.deepEqual([analysisClientTimeoutMs("fast"), analysisClientTimeoutMs("balanced"), analysisClientTimeoutMs("precise")], [150_000, 210_000, 330_000]);
});

test("the error contract names truncated output and unsupported mode settings", () => {
  for (const code of ["AI_OUTPUT_TRUNCATED", "AI_SETTINGS_UNSUPPORTED"]) assert.equal(ApiErrorCodeSchema.safeParse(code).success, true, code);
});
