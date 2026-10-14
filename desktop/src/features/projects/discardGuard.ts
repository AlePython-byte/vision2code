/**
 * Confirmation for actions that would replace the editor's working copy while it has unsaved drafts.
 * The guard is a small observable: callers `request()` and await the answer; one dialog component renders it.
 * Cancel (or Esc, or a session reset) always answers false and changes nothing.
 */
export interface DiscardGuardState {
  readonly open: boolean;
  /** Element that opened the dialog; focus returns to it when the dialog closes. */
  readonly trigger: HTMLElement | null;
  readonly revision: number;
}

export function createDiscardGuard() {
  let state: DiscardGuardState = Object.freeze({ open: false, trigger: null, revision: 0 });
  let pending: ((confirmed: boolean) => void) | null = null;
  const listeners = new Set<() => void>();

  function update(open: boolean, trigger: HTMLElement | null) {
    state = Object.freeze({ open, trigger, revision: state.revision + 1 });
    listeners.forEach((listener) => listener());
  }
  function settle(confirmed: boolean) {
    const resolve = pending;
    pending = null;
    if (state.open) update(false, null);
    resolve?.(confirmed);
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Only one confirmation can be open at a time; a second request is answered false right away. */
    request(trigger: HTMLElement | null = null): Promise<boolean> {
      if (pending) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        pending = resolve;
        update(true, trigger);
      });
    },
    confirm() { settle(true); },
    cancel() { settle(false); },
  };
}
export type DiscardGuard = ReturnType<typeof createDiscardGuard>;

/** True when the work may be replaced: no local edits, or the user confirmed discarding them. */
export async function mayReplaceWorkingCopy(
  hasLocalEdits: (() => boolean) | undefined,
  confirmDiscard: ((trigger: HTMLElement | null) => Promise<boolean>) | undefined,
  trigger: HTMLElement | null,
): Promise<boolean> {
  if (!hasLocalEdits?.()) return true;
  if (!confirmDiscard) return false;
  return confirmDiscard(trigger);
}
