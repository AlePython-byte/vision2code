import type { AnalysisFidelity } from "@vision2code/contracts";
import { ConfigurationError } from "../configuration-error.js";
import type { AnalysisProfile } from "./analysis-profiles.js";

/**
 * Per-user analysis limit, so one authenticated account cannot spend the provider quota of all.
 * Pure and in memory: no I/O, an injectable clock, and a bounded number of tracked users.
 *
 * - The key is the verified JWT `sub` (AuthenticatedUser.id), never a client value or the IP.
 * - Budget: cost units over a sliding window of one hour. One unit is 1,000 tokens of the mode's
 *   output cap (`maxOutputTokens`, which bounds visible and reasoning tokens), rounded up, so the
 *   weights follow the profiles (fast 6, balanced 10, precise 14 by default) and their env overrides.
 * - Concurrency: at most `maxConcurrent` analyses in flight per user.
 * - Charging: a slot is taken before the upload is read and always released when the response closes
 *   (success, error, timeout, cancellation, client disconnect). Units are charged only right before
 *   the provider is called and are never refunded afterwards (the call costs even if it fails or is
 *   truncated); a request rejected before that (bad image, bad fidelity, ...) is never charged.
 *
 * The state lives in this process: it restarts with the server and is not shared between instances.
 */

export const ANALYSIS_QUOTA_WINDOW_MS = 60 * 60 * 1000;
/** Tokens of output cap per cost unit. */
export const TOKENS_PER_UNIT = 1_000;
/** A busy user is told to retry after this long: a running analysis cannot be timed in advance. */
export const CONCURRENCY_RETRY_SECONDS = 15;

export interface AnalysisQuotaConfiguration {
  /** Cost units a user may spend per sliding hour. */
  readonly unitsPerHour: number;
  /** Analyses one user may have in flight at the same time. */
  readonly maxConcurrent: number;
  /** Users tracked at once; idle users (nothing in the window, nothing running) are dropped first. */
  readonly maxTrackedUsers: number;
}

/** Defaults: 160 units = 11 precise, 16 balanced or 26 fast analyses per user and hour (default profiles). */
export const DEFAULT_ANALYSIS_QUOTA: AnalysisQuotaConfiguration = Object.freeze({ unitsPerHour: 160, maxConcurrent: 2, maxTrackedUsers: 10_000 });

/** Hard caps in code: environment values beyond them are clamped, never honored. */
export const ANALYSIS_QUOTA_LIMITS = Object.freeze({
  // At least one analysis of the most expensive possible mode (20,000 tokens = 20 units) must fit.
  unitsPerHour: Object.freeze({ min: 20, max: 2_000 }),
  maxConcurrent: Object.freeze({ min: 1, max: 4 }),
  maxTrackedUsers: Object.freeze({ min: 100, max: 100_000 }),
});

export function analysisUnits(profile: Pick<AnalysisProfile, "maxOutputTokens">): number {
  return Math.max(1, Math.ceil(profile.maxOutputTokens / TOKENS_PER_UNIT));
}

export type QuotaRejection = { readonly reason: "CONCURRENCY" | "BUDGET" | "CAPACITY"; readonly retryAfterSeconds: number };

/** Held by one request from before its upload is read until its response closes. */
export interface AnalysisLease {
  /** Charges the mode's units; returns the rejection instead when the budget no longer allows it. */
  charge(fidelity: AnalysisFidelity): QuotaRejection | null;
  /** Idempotent: frees the concurrency slot. */
  release(): void;
}

interface UserState {
  charges: { at: number; units: number }[];
  active: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

export class AnalysisQuota {
  private readonly users = new Map<string, UserState>();
  private readonly units: Readonly<Record<AnalysisFidelity, number>>;
  private readonly minUnits: number;

  constructor(
    private readonly configuration: AnalysisQuotaConfiguration,
    profiles: Readonly<Record<AnalysisFidelity, Pick<AnalysisProfile, "maxOutputTokens">>>,
    private readonly now: () => number = Date.now,
  ) {
    this.units = Object.freeze({ fast: analysisUnits(profiles.fast), balanced: analysisUnits(profiles.balanced), precise: analysisUnits(profiles.precise) });
    this.minUnits = Math.min(this.units.fast, this.units.balanced, this.units.precise);
  }

  unitsFor(fidelity: AnalysisFidelity): number { return this.units[fidelity]; }

  /** Users currently tracked (for tests and diagnostics; never exposes who). */
  get trackedUsers(): number { return this.users.size; }

  /**
   * The cheap check before the upload is read: rejects a user already at the concurrency cap or
   * without budget for even the cheapest mode; otherwise takes a concurrency slot.
   */
  acquire(userId: string): AnalysisLease | QuotaRejection {
    const now = this.now();
    let user = this.users.get(userId);
    if (user === undefined) {
      if (this.users.size >= this.configuration.maxTrackedUsers) this.sweep(now);
      if (this.users.size >= this.configuration.maxTrackedUsers) {
        // Fail closed: forgetting someone's charges to make room would hand them a fresh budget.
        return { reason: "CAPACITY", retryAfterSeconds: this.capacityRetry(now) };
      }
      user = { charges: [], active: 0 };
      this.users.set(userId, user);
    }
    this.prune(user, now);
    if (user.active >= this.configuration.maxConcurrent) return { reason: "CONCURRENCY", retryAfterSeconds: CONCURRENCY_RETRY_SECONDS };
    const budget = this.wait(user, this.minUnits, now);
    if (budget !== null) { this.forgetIfIdle(userId, user); return { reason: "BUDGET", retryAfterSeconds: budget }; }
    user.active++;
    const state = user;
    let released = false;
    return {
      charge: (fidelity) => {
        const at = this.now();
        this.prune(state, at);
        const units = this.units[fidelity];
        const retry = this.wait(state, units, at);
        if (retry !== null) return { reason: "BUDGET", retryAfterSeconds: retry };
        state.charges.push({ at, units });
        return null;
      },
      release: () => {
        if (released) return;
        released = true;
        state.active--;
        this.forgetIfIdle(userId, state);
      },
    };
  }

  private prune(user: UserState, now: number): void {
    const start = now - ANALYSIS_QUOTA_WINDOW_MS;
    while (user.charges.length > 0 && user.charges[0]!.at <= start) user.charges.shift();
  }

  /** Seconds until `units` fit in the window, or null when they fit now. Charges are in time order. */
  private wait(user: UserState, units: number, now: number): number | null {
    let used = user.charges.reduce((sum, charge) => sum + charge.units, 0);
    if (used + units <= this.configuration.unitsPerHour) return null;
    for (const charge of user.charges) {
      used -= charge.units;
      if (used + units <= this.configuration.unitsPerHour) return seconds(charge.at + ANALYSIS_QUOTA_WINDOW_MS - now);
    }
    return seconds(ANALYSIS_QUOTA_WINDOW_MS);
  }

  private forgetIfIdle(userId: string, user: UserState): void {
    if (user.active === 0 && user.charges.length === 0 && this.users.get(userId) === user) this.users.delete(userId);
  }

  /** Drops every user with nothing in the window and nothing running. */
  private sweep(now: number): void {
    for (const [userId, user] of this.users) {
      this.prune(user, now);
      this.forgetIfIdle(userId, user);
    }
  }

  /** When the table is full of active users: the earliest moment one of them can become idle. */
  private capacityRetry(now: number): number {
    let earliest = ANALYSIS_QUOTA_WINDOW_MS;
    for (const user of this.users.values()) {
      if (user.active > 0) continue;
      const last = user.charges[user.charges.length - 1];
      if (last !== undefined) earliest = Math.min(earliest, last.at + ANALYSIS_QUOTA_WINDOW_MS - now);
    }
    return seconds(earliest);
  }
}

function integer(environment: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = environment[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigurationError(`${name} must be a positive integer.`);
  return clamp(Number(raw), min, max);
}

/**
 * Reads ANALYSIS_QUOTA_UNITS_PER_HOUR, ANALYSIS_QUOTA_MAX_CONCURRENT and ANALYSIS_QUOTA_MAX_USERS.
 * Values beyond the hard caps are clamped; malformed values stop startup with a message naming the
 * variable (never its value).
 */
export function readAnalysisQuotaConfiguration(environment: NodeJS.ProcessEnv = process.env): AnalysisQuotaConfiguration {
  const limits = ANALYSIS_QUOTA_LIMITS;
  const base = DEFAULT_ANALYSIS_QUOTA;
  return Object.freeze({
    unitsPerHour: integer(environment, "ANALYSIS_QUOTA_UNITS_PER_HOUR", base.unitsPerHour, limits.unitsPerHour.min, limits.unitsPerHour.max),
    maxConcurrent: integer(environment, "ANALYSIS_QUOTA_MAX_CONCURRENT", base.maxConcurrent, limits.maxConcurrent.min, limits.maxConcurrent.max),
    maxTrackedUsers: integer(environment, "ANALYSIS_QUOTA_MAX_USERS", base.maxTrackedUsers, limits.maxTrackedUsers.min, limits.maxTrackedUsers.max),
  });
}
