import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LIFECYCLE_EVENTS, logLifecycle } from "../src/features/lifecycle/lifecycleLog.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const rust = read("../src-tauri/src/lifecycle.rs");
const lib = read("../src-tauri/src/lib.rs");

test("the webview can only send the closed list of event names Rust accepts", () => {
  const block = /pub const CLIENT_EVENTS: &\[&str\] = &\[([\s\S]*?)\];/.exec(rust)?.[1] ?? "";
  const names = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(names, [...LIFECYCLE_EVENTS]);
  for (const name of LIFECYCLE_EVENTS) assert.match(name, /^[a-z]+(:[a-z]+)+$/, "names only: no room for paths, e-mails or tokens");
  assert.match(rust, /if !CLIENT_EVENTS\.contains\(&event\) \{\s*return Err/);
});

test("it is off unless VISION2CODE_DEBUG_LIFECYCLE=1 and writes to the app's data dir", () => {
  assert.match(rust, /pub const ENV: &str = "VISION2CODE_DEBUG_LIFECYCLE";/);
  assert.match(rust, /value\.map\(str::trim\) == Some\("1"\)/);
  assert.match(lib, /lifecycle::Lifecycle::new\(debug_lifecycle, app\.path\(\)\.app_local_data_dir\(\)\.ok\(\)\)/);
  assert.match(rust, /pub const FILE_NAME: &str = "lifecycle\.log";/);
});

test("closing is only observed, never prevented or delayed", () => {
  assert.doesNotMatch(lib, /prevent_close|prevent_exit|api\.prevent/);
  assert.match(lib, /tauri::WindowEvent::CloseRequested \{ \.\. \} => log\.log/);
  assert.match(lib, /tauri::WindowEvent::Destroyed => log\.log/);
  assert.match(lib, /tauri::RunEvent::ExitRequested \{ code, \.\. \} => log\.log/);
  assert.match(lib, /tauri::RunEvent::Exit => log\.log\("app:exit"\)/);
  assert.match(lib, /async fn lifecycle_log\(/, "async: the file write never runs on the main thread");
});

test("logLifecycle is fire-and-forget: no-op outside Tauri, never throws, sends only the name", async () => {
  assert.doesNotThrow(() => logLifecycle("signout:start"), "outside Tauri it does nothing");
  const calls: unknown[] = [];
  logLifecycle("vault:save:start", async (command, args) => { calls.push([command, args]); });
  logLifecycle("page:hide", async () => { throw new Error("IPC down"); });
  const result = logLifecycle("signout:done", () => new Promise(() => { /* never answers */ }));
  assert.equal(result, undefined, "it returns immediately, so a stuck IPC can never block sign-out or closing");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls, [["lifecycle_log", { event: "vault:save:start" }]]);
});

test("sign-out, vault writes and page hide are marked", () => {
  const app = read("../src/App.tsx");
  assert.match(app, /logLifecycle\("signout:start"\);\s*void model\.signOut\(\)\.then\(\(\) => logLifecycle\("signout:done"\), \(\) => logLifecycle\("signout:error"\)\);/);
  assert.match(app, /window\.addEventListener\("pagehide", onHide\)/);
  const storage = read("../src/features/auth/tauriStrongholdStorage.ts");
  for (const event of ["vault:init:start", "vault:init:done", "vault:init:fallback", "vault:save:start", "vault:save:done", "vault:save:error", "vault:remove:start", "vault:remove:done", "vault:remove:error"]) {
    assert.ok(storage.includes(`logLifecycle("${event}")`), event);
  }
});
