import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ANALYSIS_PROFILES, readAnalysisProfiles } from "../src/analysis/analysis-profiles.js";
import {
  ANALYSIS_QUOTA_LIMITS, ANALYSIS_QUOTA_WINDOW_MS, AnalysisQuota, CONCURRENCY_RETRY_SECONDS, DEFAULT_ANALYSIS_QUOTA,
  analysisUnits, readAnalysisQuotaConfiguration,
} from "../src/analysis/analysis-quota.js";
import type { AnalysisLease, AnalysisQuotaConfiguration, QuotaRejection } from "../src/analysis/analysis-quota.js";
import { ConfigurationError } from "../src/configuration-error.js";

const MINUTE = 60_000;
function setup(configuration: Partial<AnalysisQuotaConfiguration> = {}) {
  let now = 1_000_000;
  const quota = new AnalysisQuota({ ...DEFAULT_ANALYSIS_QUOTA, ...configuration }, DEFAULT_ANALYSIS_PROFILES, () => now);
  return { quota, advance: (ms: number) => { now += ms; } };
}
const isLease = (value: AnalysisLease | QuotaRejection): value is AnalysisLease => "release" in value;
/** One whole analysis: slot, charge, release. Returns the rejection, if any. */
function run(quota: AnalysisQuota, user: string, fidelity: "fast" | "balanced" | "precise"): QuotaRejection | null {
  const lease = quota.acquire(user);
  if (!isLease(lease)) return lease;
  try { return lease.charge(fidelity); } finally { lease.release(); }
}

describe("analysis quota", () => {
  it("weights follow each mode's output cap: 1 unit per 1,000 tokens, rounded up", () => {
    assert.deepEqual([analysisUnits(DEFAULT_ANALYSIS_PROFILES.fast), analysisUnits(DEFAULT_ANALYSIS_PROFILES.balanced),
      analysisUnits(DEFAULT_ANALYSIS_PROFILES.precise)], [6, 10, 16]);
    assert.equal(analysisUnits({ maxOutputTokens: 6_001 }), 7);
    const overridden = readAnalysisProfiles({ ANALYSIS_PRECISE_MAX_OUTPUT_TOKENS: "20000" });
    assert.equal(new AnalysisQuota(DEFAULT_ANALYSIS_QUOTA, overridden).unitsFor("precise"), 20, "an env override of the cap moves the weight with it");
    assert.deepEqual(DEFAULT_ANALYSIS_QUOTA, { unitsPerHour: 160, maxConcurrent: 2, maxTrackedUsers: 10_000 });
  });

  it("sliding window: spends the budget, then frees it charge by charge as each one turns an hour old", () => {
    const { quota, advance } = setup({ unitsPerHour: 30 });
    assert.equal(run(quota, "a", "balanced"), null); // 10 at t0
    advance(10 * MINUTE);
    assert.equal(run(quota, "a", "balanced"), null); // 20 at t0+10
    advance(10 * MINUTE);
    assert.equal(run(quota, "a", "balanced"), null); // 30 at t0+20
    advance(5 * MINUTE);
    const blocked = run(quota, "a", "fast");
    assert.deepEqual(blocked, { reason: "BUDGET", retryAfterSeconds: 35 * 60 }, "the oldest charge expires 35 min later");
    advance(35 * MINUTE - 1_000);
    assert.equal(run(quota, "a", "fast")?.reason, "BUDGET", "one second before, still full");
    advance(1_000);
    assert.equal(run(quota, "a", "balanced"), null, "partial expiry: exactly the first 10 units came back");
    assert.equal(run(quota, "a", "fast")?.reason, "BUDGET");
    advance(ANALYSIS_QUOTA_WINDOW_MS);
    for (let index = 0; index < 3; index++) assert.equal(run(quota, "a", "balanced"), null, "total expiry: the whole budget is back");
  });

  it("the wait is how long until enough old charges leave the window for this mode", () => {
    const { quota, advance } = setup({ unitsPerHour: 40 });
    assert.equal(run(quota, "a", "precise"), null); // 16 at t0
    advance(20 * MINUTE);
    assert.equal(run(quota, "a", "precise"), null); // 32 at t0+20
    // A fast analysis (6) fits now; a precise one (16) must wait until the first charge leaves.
    assert.equal(run(quota, "a", "fast"), null); // 38
    const wait = run(quota, "a", "precise");
    assert.deepEqual(wait, { reason: "BUDGET", retryAfterSeconds: 40 * 60 });
  });

  it("precise exhausts the budget before fast", () => {
    const count = (fidelity: "fast" | "precise") => {
      const { quota } = setup();
      let done = 0;
      while (run(quota, "a", fidelity) === null) done++;
      return done;
    };
    assert.deepEqual([count("precise"), count("fast")], [10, 26]);
  });

  it("users are isolated: A's spending never limits B", () => {
    const { quota } = setup({ unitsPerHour: 20 });
    assert.equal(run(quota, "a", "precise"), null);
    assert.equal(run(quota, "a", "precise")?.reason, "BUDGET");
    assert.equal(run(quota, "b", "precise"), null);
    const busyA = quota.acquire("a");
    assert.ok(!isLease(busyA) && busyA.reason === "BUDGET", "A has 4 units left, below the cheapest mode: rejected before the upload");
  });

  it("concurrency: at most N in flight per user; a slot comes back on release, and only once", () => {
    const { quota } = setup({ maxConcurrent: 2 });
    const first = quota.acquire("a");
    const second = quota.acquire("a");
    assert.ok(isLease(first) && isLease(second));
    assert.deepEqual(quota.acquire("a"), { reason: "CONCURRENCY", retryAfterSeconds: CONCURRENCY_RETRY_SECONDS });
    assert.ok(isLease(quota.acquire("b")), "another user is not affected");
    first.release();
    first.release(); // idempotent: the response "close" event and the controller's finally both release
    const third = quota.acquire("a");
    assert.ok(isLease(third));
    const fourth = quota.acquire("a");
    assert.ok(!isLease(fourth) && fourth.reason === "CONCURRENCY", "a double release did not free a second slot");
    second.release(); third.release();
  });

  it("no slot leaks after many cycles, whatever the outcome", () => {
    const { quota, advance } = setup({ unitsPerHour: 2_000, maxConcurrent: 1 });
    for (let cycle = 0; cycle < 500; cycle++) {
      const lease = quota.acquire("a");
      assert.ok(isLease(lease), `cycle ${cycle}`);
      if (cycle % 3 === 0) lease.charge("fast"); // reached the provider (success, error, timeout: all the same here)
      // otherwise rejected before the provider (bad image, cancellation before the call): never charged
      lease.release();
      advance(ANALYSIS_QUOTA_WINDOW_MS / 100);
    }
    advance(ANALYSIS_QUOTA_WINDOW_MS);
    const lease = quota.acquire("a");
    assert.ok(isLease(lease));
    lease.release();
    assert.equal(quota.trackedUsers, 0, "an idle user is forgotten");
  });

  it("a request rejected before the provider is never charged", () => {
    const { quota } = setup({ unitsPerHour: 20 });
    for (let index = 0; index < 50; index++) {
      const lease = quota.acquire("a");
      assert.ok(isLease(lease));
      lease.release(); // e.g. 415 or 400 after the upload: no charge() call
    }
    assert.equal(run(quota, "a", "precise"), null, "the whole budget is still there");
  });

  it("memory is bounded: idle users are dropped and the table never grows past the maximum", () => {
    const { quota, advance } = setup({ maxTrackedUsers: 100 });
    for (let index = 0; index < 100; index++) assert.equal(run(quota, `user-${index}`, "fast"), null);
    assert.equal(quota.trackedUsers, 100);
    // Full of users with charges in the window: a new user is refused (fail closed) rather than
    // forgetting someone's charges, which would hand them a fresh budget.
    const refused = quota.acquire("newcomer");
    assert.ok(!isLease(refused) && refused.reason === "CAPACITY" && refused.retryAfterSeconds === 3_600);
    assert.equal(quota.trackedUsers, 100);
    advance(ANALYSIS_QUOTA_WINDOW_MS + 1);
    const admitted = quota.acquire("newcomer");
    assert.ok(isLease(admitted), "once their charges expire, the sweep frees the table");
    assert.equal(quota.trackedUsers, 1);
    admitted.release();
    assert.equal(quota.trackedUsers, 0);
  });

  it("reads the env with hard caps; malformed values name the variable, never the value", () => {
    assert.deepEqual(readAnalysisQuotaConfiguration({}), DEFAULT_ANALYSIS_QUOTA);
    assert.deepEqual(readAnalysisQuotaConfiguration({ ANALYSIS_QUOTA_UNITS_PER_HOUR: "48", ANALYSIS_QUOTA_MAX_CONCURRENT: "1", ANALYSIS_QUOTA_MAX_USERS: "500" }),
      { unitsPerHour: 48, maxConcurrent: 1, maxTrackedUsers: 500 });
    assert.deepEqual(readAnalysisQuotaConfiguration({ ANALYSIS_QUOTA_UNITS_PER_HOUR: "999999", ANALYSIS_QUOTA_MAX_CONCURRENT: "50", ANALYSIS_QUOTA_MAX_USERS: "99999999" }),
      { unitsPerHour: ANALYSIS_QUOTA_LIMITS.unitsPerHour.max, maxConcurrent: ANALYSIS_QUOTA_LIMITS.maxConcurrent.max, maxTrackedUsers: ANALYSIS_QUOTA_LIMITS.maxTrackedUsers.max });
    assert.deepEqual(readAnalysisQuotaConfiguration({ ANALYSIS_QUOTA_UNITS_PER_HOUR: "0", ANALYSIS_QUOTA_MAX_CONCURRENT: "0", ANALYSIS_QUOTA_MAX_USERS: "1" }),
      { unitsPerHour: 20, maxConcurrent: 1, maxTrackedUsers: 100 }, "a zero budget would block everyone: the floor still fits one analysis of any mode");
    for (const name of ["ANALYSIS_QUOTA_UNITS_PER_HOUR", "ANALYSIS_QUOTA_MAX_CONCURRENT", "ANALYSIS_QUOTA_MAX_USERS"]) {
      for (const value of ["-5", "1.5", "ten", "1e3", "secret-value-42"]) {
        assert.throws(() => readAnalysisQuotaConfiguration({ [name]: value }), (error: Error) =>
          error instanceof ConfigurationError && error.message.includes(name) && !error.message.includes(value), `${name}=${value}`);
      }
    }
  });
});
