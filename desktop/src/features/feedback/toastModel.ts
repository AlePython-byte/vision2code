export type ToastTone = "success" | "error" | "info" | "progress";

export interface ToastAction {
  /** i18n key of the visible label (also used as its accessible name). */
  readonly label: string;
  readonly run: () => void;
}

export interface ToastInput {
  /** Channel key: showing a toast with an existing key replaces it in place. */
  readonly key: string;
  readonly tone: ToastTone;
  /** i18n keys; the viewport localizes them so a language switch applies to visible toasts. */
  readonly message: string;
  readonly eyebrow: string;
  readonly persistent: boolean;
  /** Required for non-persistent toasts; ignored for persistent ones. */
  readonly durationMs?: number;
  readonly action?: ToastAction;
}

export interface Toast extends ToastInput {
  readonly id: string;
  readonly dismissible: true;
}

export interface ToastState {
  /** Oldest first. */
  readonly toasts: readonly Toast[];
  readonly revision: number;
}

export interface ToastScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly now: () => number;
}

export const MAX_VISIBLE_TOASTS = 3;
export const DEFAULT_TOAST_DURATION_MS = 4000;

export const defaultToastScheduler: ToastScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
  now: () => Date.now(),
};

interface Timer {
  handle: unknown | null;
  remainingMs: number;
  startedAt: number;
}

/**
 * Framework-independent toast queue. At most MAX_VISIBLE_TOASTS are visible; to make room the oldest
 * transient toast is evicted, and a persistent toast is never evicted for a transient one.
 * Only transient toasts auto-dismiss, through the injected scheduler.
 */
export function createToastModel(scheduler: ToastScheduler = defaultToastScheduler) {
  let state: ToastState = Object.freeze({ toasts: Object.freeze([]), revision: 0 });
  let sequence = 0;
  const timers = new Map<string, Timer>();
  // Toasts under hover or keyboard focus; a replaced toast keeps waiting until it is released.
  const paused = new Set<string>();
  const listeners = new Set<() => void>();

  function update(toasts: Toast[]) {
    state = Object.freeze({ toasts: Object.freeze(toasts), revision: state.revision + 1 });
    listeners.forEach((listener) => listener());
  }

  function stopTimer(id: string) {
    const timer = timers.get(id);
    if (timer?.handle != null) scheduler.clearTimeout(timer.handle);
    timers.delete(id);
  }

  function run(id: string, timer: Timer) {
    timer.startedAt = scheduler.now();
    timer.handle = scheduler.setTimeout(() => {
      timer.handle = null;
      timers.delete(id);
      remove(id);
    }, timer.remainingMs);
  }

  function startTimer(toast: Toast) {
    stopTimer(toast.id);
    if (toast.persistent) return;
    const timer: Timer = { handle: null, remainingMs: Math.max(0, toast.durationMs ?? DEFAULT_TOAST_DURATION_MS), startedAt: 0 };
    timers.set(toast.id, timer);
    if (!paused.has(toast.id)) run(toast.id, timer);
  }

  function remove(id: string) {
    stopTimer(id);
    paused.delete(id);
    if (state.toasts.some((toast) => toast.id === id)) update(state.toasts.filter((toast) => toast.id !== id));
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    /** Returns the visible toast's id, or null when a transient toast found no room. */
    show(input: ToastInput): string | null {
      const existing = state.toasts.find((toast) => toast.key === input.key);
      if (existing) {
        const replaced: Toast = { ...input, id: existing.id, dismissible: true };
        update(state.toasts.map((toast) => toast.id === existing.id ? replaced : toast));
        startTimer(replaced);
        return replaced.id;
      }
      let toasts = [...state.toasts];
      if (toasts.length >= MAX_VISIBLE_TOASTS) {
        const evict = toasts.find((toast) => !toast.persistent) ?? (input.persistent ? toasts[0] : undefined);
        if (!evict) return null;
        stopTimer(evict.id);
        paused.delete(evict.id);
        toasts = toasts.filter((toast) => toast.id !== evict.id);
      }
      const toast: Toast = { ...input, id: `toast-${++sequence}`, dismissible: true };
      update([...toasts, toast]);
      startTimer(toast);
      return toast.id;
    },

    /** Hover or keyboard focus: freezes the remaining auto-dismiss time. */
    pause(id: string) {
      if (!state.toasts.some((toast) => toast.id === id)) return;
      paused.add(id);
      const timer = timers.get(id);
      if (!timer || timer.handle == null) return;
      scheduler.clearTimeout(timer.handle);
      timer.handle = null;
      timer.remainingMs = Math.max(0, timer.remainingMs - (scheduler.now() - timer.startedAt));
    },

    resume(id: string) {
      paused.delete(id);
      const timer = timers.get(id);
      if (!timer || timer.handle != null) return;
      run(id, timer);
    },

    dismiss: remove,

    dismissByKey(key: string) {
      const toast = state.toasts.find((item) => item.key === key);
      if (toast) remove(toast.id);
    },

    clear() {
      for (const id of [...timers.keys()]) stopTimer(id);
      paused.clear();
      if (state.toasts.length) update([]);
    },

    dispose() {
      for (const id of [...timers.keys()]) stopTimer(id);
      paused.clear();
      state = Object.freeze({ toasts: Object.freeze([]), revision: state.revision + 1 });
      listeners.clear();
    },
  };
}
export type ToastModel = ReturnType<typeof createToastModel>;
