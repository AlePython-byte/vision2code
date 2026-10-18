/**
 * Webview side of the optional lifecycle log (see desktop/src-tauri/src/lifecycle.rs). Fire-and-forget: it never
 * awaits, never throws and does nothing outside Tauri; Rust ignores it unless VISION2CODE_DEBUG_LIFECYCLE=1.
 * Only these names exist, so nothing personal (paths, e-mails, tokens) can be sent.
 */
export const LIFECYCLE_EVENTS = [
  "signout:start", "signout:done", "signout:error",
  "vault:init:start", "vault:init:done", "vault:init:fallback",
  "vault:save:start", "vault:save:done", "vault:save:error",
  "vault:remove:start", "vault:remove:done", "vault:remove:error",
  "vault:clear:start", "vault:clear:done", "vault:clear:error", "vault:write:blocked",
  "page:hide",
] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

type Invoke = (command: string, args: { event: LifecycleEvent }) => Promise<unknown>;

export function logLifecycle(event: LifecycleEvent, invoke?: Invoke): void {
  if (!invoke && (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window))) return;
  const send = invoke
    ? Promise.resolve(invoke)
    : import("@tauri-apps/api/core").then((module) => module.invoke as Invoke);
  void send.then((call) => call("lifecycle_log", { event })).catch(() => { /* logging must never affect the app */ });
}
