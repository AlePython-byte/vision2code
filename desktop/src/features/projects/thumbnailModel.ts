import type { FidelityMode } from "@vision2code/contracts";
import { ProjectsClientError } from "./projectsClient.ts";
import type { ProjectsClient, ProjectsErrorCode } from "./projectsClient.ts";
import { schemaThumbnail, type SchemaThumbnailModel } from "./thumbnailBlocks.ts";

export type ThumbnailStatus = "LOADING" | "READY" | "ERROR";

export interface ThumbnailEntry {
  readonly status: ThumbnailStatus;
  /** Present when READY; kept as the small block model, never the schema or the generated code. */
  readonly thumbnail: SchemaThumbnailModel | null;
  readonly fidelityMode: FidelityMode | null;
  readonly error: ProjectsErrorCode | null;
}

export interface ThumbnailState {
  /** Keyed by generation id: generations are immutable, so a READY entry never needs refreshing. */
  readonly entries: Readonly<Record<string, ThumbnailEntry>>;
  readonly revision: number;
}

export interface ThumbnailDependencies {
  readonly client: Pick<ProjectsClient, "getGeneration">;
  /** Injected so thumbnails never import the auth feature. */
  readonly onUnauthorized?: () => void;
  /** Detail requests in flight at once (each carries a whole generation); default 3. */
  readonly concurrency?: number;
}

const LOADING: ThumbnailEntry = Object.freeze({ status: "LOADING", thumbnail: null, fidelityMode: null, error: null });

/**
 * Thumbnails and fidelity chips for the Projects and Library screens. Project and generation SUMMARIES carry no
 * UISchema, so the model asks for the detail of one generation, derives the block model (`schemaThumbnail`) and
 * keeps only that plus the fidelity mode. Requests are queued with a small concurrency limit; the same generation is
 * never requested twice at once; a failed one is retried the next time it is requested; every response from before
 * a `reset` (sign-out, user change) is ignored.
 */
export function createThumbnailModel(deps: ThumbnailDependencies) {
  const limit = Math.max(1, deps.concurrency ?? 3);
  let state: ThumbnailState = Object.freeze({ entries: Object.freeze({}), revision: 0 });
  const listeners = new Set<() => void>();
  const queue: Array<{ projectId: string; generationId: string }> = [];
  const waiting = new Set<string>();
  let running = 0;
  let epoch = 0;

  function setEntry(generationId: string, entry: ThumbnailEntry) {
    state = Object.freeze({ entries: Object.freeze({ ...state.entries, [generationId]: Object.freeze(entry) }), revision: state.revision + 1 });
    listeners.forEach((listener) => listener());
  }

  function pump() {
    while (running < limit && queue.length > 0) {
      const next = queue.shift()!;
      waiting.delete(next.generationId);
      void run(next.projectId, next.generationId);
    }
  }

  async function run(projectId: string, generationId: string) {
    const mine = epoch;
    running += 1;
    try {
      const detail = await deps.client.getGeneration(projectId, generationId);
      if (mine !== epoch) return;
      setEntry(generationId, { status: "READY", thumbnail: schemaThumbnail(detail.uiSchema), fidelityMode: detail.fidelityMode, error: null });
    } catch (error) {
      if (mine !== epoch) return;
      const code: ProjectsErrorCode = error instanceof ProjectsClientError ? error.code : "UNKNOWN";
      setEntry(generationId, { status: "ERROR", thumbnail: null, fidelityMode: null, error: code });
      if (code === "UNAUTHORIZED") deps.onUnauthorized?.();
    } finally {
      // After a reset the counter started again from zero: a stale request must not subtract from it.
      if (mine === epoch) running -= 1;
      pump();
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    /** Idempotent: READY, queued and in-flight generations are left alone; ERROR ones are tried again. */
    request(projectId: string, generationId: string) {
      const current = state.entries[generationId];
      if (current && current.status !== "ERROR") return;
      if (waiting.has(generationId)) return;
      setEntry(generationId, LOADING);
      waiting.add(generationId);
      queue.push({ projectId, generationId });
      pump();
    },

    /** Session boundary: drop everything and ignore responses still in flight. */
    reset() {
      epoch += 1;
      queue.length = 0;
      waiting.clear();
      running = 0;
      if (Object.keys(state.entries).length === 0) return;
      state = Object.freeze({ entries: Object.freeze({}), revision: state.revision + 1 });
      listeners.forEach((listener) => listener());
    },
  };
}

export type ThumbnailModel = ReturnType<typeof createThumbnailModel>;
