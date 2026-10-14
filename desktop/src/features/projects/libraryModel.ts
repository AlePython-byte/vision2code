import type { GenerationSummary } from "@vision2code/contracts";
import { ProjectsClientError } from "./projectsClient.ts";
import type { ProjectsClient, ProjectsErrorCode } from "./projectsClient.ts";

export type LibraryEntryStatus = "IDLE" | "LOADING" | "READY" | "ERROR";

export interface LibraryEntry {
  readonly status: LibraryEntryStatus;
  /** Summaries only, newest first. */
  readonly items: readonly GenerationSummary[];
  readonly error: ProjectsErrorCode | null;
}

export interface LibraryState {
  readonly open: boolean;
  /** Project to expand when the dialog opens (e.g. from the Code view chip). */
  readonly focusProjectId: string | null;
  /** Element that opened the dialog; focus returns to it on close. */
  readonly trigger: HTMLElement | null;
  readonly entries: Readonly<Record<string, LibraryEntry>>;
  readonly revision: number;
}

export interface LibraryDependencies {
  readonly client: Pick<ProjectsClient, "listGenerations">;
  /** Injected so the library never imports the auth feature. */
  readonly onUnauthorized?: () => void;
}

const EMPTY_ENTRY: LibraryEntry = Object.freeze({ status: "IDLE", items: Object.freeze([]), error: null });

function safeCode(error: unknown): ProjectsErrorCode {
  return error instanceof ProjectsClientError ? error.code : "UNKNOWN";
}

function newestFirst(items: readonly GenerationSummary[]): GenerationSummary[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => Date.parse(b.item.createdAt) - Date.parse(a.item.createdAt) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Cross-project library: owns the dialog's open state and a lazily filled cache of generation summaries
 * per project. It only lists summaries (never analysis, AI or the generator) and is independent of the
 * single-project history model. Responses are guarded by a per-project epoch plus a session reset epoch.
 */
export function createLibraryModel(deps: LibraryDependencies) {
  let state: LibraryState = Object.freeze({
    open: false, focusProjectId: null, trigger: null, entries: Object.freeze({}), revision: 0,
  });
  const epochs = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();
  let resetEpoch = 0;
  const listeners = new Set<() => void>();

  function update(changes: Partial<Omit<LibraryState, "revision">>) {
    state = Object.freeze({ ...state, ...changes, revision: state.revision + 1 });
    listeners.forEach((listener) => listener());
  }
  function setEntry(projectId: string, entry: LibraryEntry) {
    update({ entries: Object.freeze({ ...state.entries, [projectId]: Object.freeze(entry) }) });
  }

  /**
   * Loads (or refreshes) one project's generations. Concurrent calls for the same project share one
   * request; already loaded items stay visible while a refresh runs or fails.
   */
  function loadProject(projectId: string): Promise<void> {
    const running = inFlight.get(projectId);
    if (running) return running;
    const run = (epochs.get(projectId) ?? 0) + 1;
    epochs.set(projectId, run);
    const reset = resetEpoch;
    const previous = state.entries[projectId] ?? EMPTY_ENTRY;
    setEntry(projectId, { status: "LOADING", items: previous.items, error: null });
    const request = (async () => {
      try {
        const items = await deps.client.listGenerations(projectId);
        if (reset !== resetEpoch || epochs.get(projectId) !== run) return;
        setEntry(projectId, { status: "READY", items: Object.freeze(newestFirst(items)), error: null });
      } catch (error) {
        if (reset !== resetEpoch || epochs.get(projectId) !== run) return;
        const code = safeCode(error);
        const current = state.entries[projectId] ?? EMPTY_ENTRY;
        setEntry(projectId, { status: "ERROR", items: current.items, error: code });
        if (code === "UNAUTHORIZED") deps.onUnauthorized?.();
      }
    })().finally(() => { if (inFlight.get(projectId) === request) inFlight.delete(projectId); });
    inFlight.set(projectId, request);
    return request;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    openDialog(focusProjectId: string | null = null, trigger: HTMLElement | null = null) {
      update({ open: true, focusProjectId, trigger });
    },
    closeDialog() {
      if (state.open) update({ open: false, focusProjectId: null, trigger: null });
    },

    loadProject,

    /** Same as loadProject; named for the error state's Retry action. */
    retry: loadProject,

    /** The project is gone: drop its cached list and focus, and ignore its responses still in flight. */
    forgetProject(projectId: string) {
      epochs.set(projectId, (epochs.get(projectId) ?? 0) + 1);
      inFlight.delete(projectId);
      if (!(projectId in state.entries) && state.focusProjectId !== projectId) return;
      const entries = Object.fromEntries(Object.entries(state.entries).filter(([id]) => id !== projectId));
      update({ entries: Object.freeze(entries), focusProjectId: state.focusProjectId === projectId ? null : state.focusProjectId });
    },

    /** Session boundary: close the dialog, drop every cached list and ignore responses still in flight. */
    reset() {
      ++resetEpoch;
      epochs.clear();
      inFlight.clear();
      update({ open: false, focusProjectId: null, trigger: null, entries: Object.freeze({}) });
    },
  };
}
export type LibraryModel = ReturnType<typeof createLibraryModel>;
