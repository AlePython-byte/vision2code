import type { ToastScheduler } from "../src/features/feedback/toastModel.ts";

/** Deterministic virtual clock: timers only fire through advance(). */
export function fakeScheduler() {
  let now = 0;
  let sequence = 0;
  const tasks = new Map<number, { at: number; callback: () => void }>();
  const scheduler: ToastScheduler & { advance(ms: number): void; pending(): number } = {
    setTimeout(callback, delayMs) {
      const id = ++sequence;
      tasks.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout(handle) { tasks.delete(handle as number); },
    now: () => now,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next: [number, { at: number; callback: () => void }] | null = null;
        for (const entry of tasks) if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        tasks.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = target;
    },
    pending: () => tasks.size,
  };
  return scheduler;
}
