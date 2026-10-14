import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_API_BASE_URL } from "../src/features/api/apiBaseUrl.ts";

const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")) as {
  app: { security: { csp?: unknown; devCsp?: unknown } };
};

function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

const csp = config.app.security.csp;
assert.equal(typeof csp, "string", "tauri.conf.json must define app.security.csp as a string");
const policy = directives(csp as string);
const connect = policy.get("connect-src") ?? [];

test("a single CSP applies to dev and packaged builds (no weaker devCsp override)", () => {
  assert.equal(config.app.security.devCsp, undefined);
});

test("connect-src allows IPC and the default local backend origin", () => {
  const backend = new URL(DEFAULT_API_BASE_URL).origin;
  assert.ok(connect.includes("ipc:") && connect.includes("http://ipc.localhost"));
  assert.ok(connect.includes(backend), `backend origin ${backend} must be listed`);
  assert.ok(connect.includes("http://127.0.0.1:3000"));
});

test("connect-src allows exactly one explicit HTTPS Supabase project origin for authentication", () => {
  const supabase = connect.filter((source) => /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(source));
  assert.equal(supabase.length, 1, `expected one https://<project-ref>.supabase.co origin, got ${connect.join(" ")}`);
});

test("connect-src stays closed: no wildcard, bare scheme, or arbitrary host", () => {
  const allowed = [/^ipc:$/, /^http:\/\/ipc\.localhost$/, /^http:\/\/(localhost|127\.0\.0\.1):3000$/, /^https:\/\/[a-z0-9-]+\.supabase\.co$/];
  for (const source of connect) {
    assert.ok(allowed.some((pattern) => pattern.test(source)), `unexpected connect-src source: ${source}`);
  }
  assert.ok(!connect.some((source) => source.includes("*") || /^[a-z]+:$/.test(source) && source !== "ipc:"));
});

test("CSP keeps its restrictive baseline", () => {
  assert.deepEqual(policy.get("default-src"), ["'self'"]);
  for (const [name, sources] of policy) {
    assert.ok(!sources.includes("'unsafe-eval'"), `${name} must not allow unsafe-eval`);
    if (name === "script-src") assert.ok(!sources.includes("'unsafe-inline'"));
  }
});
