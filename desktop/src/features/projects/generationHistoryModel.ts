import type { GenerationSummary } from "@vision2code/contracts";
import { ProjectsClientError } from "./projectsClient.ts";
import type { ProjectsClient, ProjectsErrorCode } from "./projectsClient.ts";
import { resolveHistoryProjectId } from "./historySelectors.ts";

export type GenerationHistoryStatus = "IDLE" | "LOADING" | "READY" | "ERROR";

export interface GenerationHistoryState {
  readonly projectId: string | null;
  readonly status: GenerationHistoryStatus;
  /** Summaries only, newest first (the server orders by createdAt DESC). */
  readonly items: readonly GenerationSummary[];
  readonly error: ProjectsErrorCode | null;
  readonly revision: number;
}

interface HistorySessionSource {
  getSnapshot(): {
    readonly artifact: unknown;
    readonly projectId: string | null;
    readonly generationId: string | null;
    readonly origin: "GENERATED" | "RESTORED" | null;
  };
  subscribe(listener: () => void): () => void;
}

interface HistoryProjectsSource {
  getSnapshot(): { readonly selectedProjectId: string | null };
  subscribe(listener: () => void): () => void;
}

export interface GenerationHistoryDependencies {
  readonly client: Pick<ProjectsClient, "listGenerations">;
  readonly session: HistorySessionSource;
  readonly projects: HistoryProjectsSource;
  /** Injected so the history never imports the auth feature. */
  readonly onUnauthorized?: () => void;
}

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
 * Read-only list of the saved generations of the project the Code view is about. It never changes the
 * session, editor or preview, and it never analyzes or generates: it only lists summaries.
 * Responses are guarded by an epoch, so a stale list can never replace a newer one.
 */
export function createGenerationHistoryModel(deps: GenerationHistoryDependencies) {
  let state: GenerationHistoryState = Object.freeze({
    projectId: null, status: "IDLE", items: Object.freeze([]), error: null, revision: 0,
  });
  let epoch = 0;
  // Last session generation id already accounted for (listed or being listed).
  let handledGenerationId: string | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  function update(changes: Partial<Omit<GenerationHistoryState, "revision">>) {
    state = Object.freeze({ ...state, ...changes, revision: state.revision + 1 });
    listeners.forEach((listener) => listener());
  }

  async function load(projectId: string, keepItems: boolean) {
    const run = ++epoch;
    update({ projectId, status: "LOADING", error: null, items: keepItems ? state.items : Object.freeze([]) });
    try {
      const items = await deps.client.listGenerations(projectId);
      if (run !== epoch) return;
      update({ status: "READY", error: null, items: Object.freeze(newestFirst(items)) });
    } catch (error) {
      if (run !== epoch) return;
      const code = safeCode(error);
      // Previous items for the same project stay visible; the tray offers Retry.
      update({ status: "ERROR", error: code });
      if (code === "UNAUTHORIZED") deps.onUnauthorized?.();
    }
  }

  function sync() {
    if (disposed) return;
    const session = deps.session.getSnapshot();
    const projectId = resolveHistoryProjectId(session, deps.projects.getSnapshot());
    if (projectId !== state.projectId) {
      // The fresh list for the new project already covers whatever the session currently shows.
      handledGenerationId = session.artifact !== null ? session.generationId : null;
      ++epoch;
      if (projectId === null) {
        update({ projectId: null, status: "IDLE", items: Object.freeze([]), error: null });
      } else {
        void load(projectId, false);
      }
      return;
    }
    if (projectId === null || session.generationId === handledGenerationId) return;
    handledGenerationId = session.generationId;
    const id = session.generationId;
    if (id === null || state.items.some((item) => item.id === id)) return;
    // A restore is already on the server, so a list being fetched covers it; a NEW save may postdate it.
    if (state.status === "LOADING" && session.origin !== "GENERATED") return;
    void load(projectId, true);
  }

  const unsubscribers = [deps.session.subscribe(sync), deps.projects.subscribe(sync)];
  sync();

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Reloads the current project's history after a failure (or on demand). */
    retry(): Promise<void> {
      if (state.projectId === null || state.status === "LOADING") return Promise.resolve();
      return load(state.projectId, true);
    },
    /** Session boundary: forget everything and ignore every response still in flight. */
    reset() {
      ++epoch;
      handledGenerationId = null;
      update({ projectId: null, status: "IDLE", items: Object.freeze([]), error: null });
    },
    dispose() {
      disposed = true;
      ++epoch;
      unsubscribers.forEach((off) => off());
      listeners.clear();
    },
  };
}
export type GenerationHistoryModel = ReturnType<typeof createGenerationHistoryModel>;
