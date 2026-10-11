import type { GeneratedProject } from "../generation/generatedProject.ts";
import { createLocalIsolatedPreviewEngine } from "./previewEngine.ts";
import { PREVIEW_ENTRY_PATH, type PreviewEngine, type PreviewProject, type PreviewState } from "./previewTypes.ts";

function snapshotProject(project: GeneratedProject): PreviewProject {
  const files = project.files.map((file) => Object.freeze({ ...file }));
  return Object.freeze({ target: project.target, generatorVersion: project.generatorVersion, files: Object.freeze(files) });
}

/**
 * Deterministic preview lifecycle:
 *   EMPTY  --setProject(p)--> READY (or ERROR/NO_ENTRY when src/App.tsx is missing)
 *   READY|SUCCESS|ERROR(ENGINE_FAILURE) --render()--> RENDERING --> SUCCESS | ERROR(ENGINE_FAILURE)
 *   any --setProject(null) / clear()--> EMPTY
 * Any new setProject/render/clear aborts and supersedes in-flight work.
 * The model has no network, AI or Tauri dependency; it only talks to the injected engine.
 */
export function createPreviewModel(engine: PreviewEngine = createLocalIsolatedPreviewEngine()) {
  let state: PreviewState = {
    status: "EMPTY",
    project: null,
    revision: 0,
    engine: engine.kind,
    error: null,
    documentHtml: null,
  };
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();

  function update(next: Omit<PreviewState, "revision" | "engine">) {
    state = Object.freeze({ ...next, revision: state.revision + 1, engine: engine.kind });
    listeners.forEach((listener) => listener());
  }
  function supersede() {
    controller?.abort();
    controller = null;
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setProject(project: GeneratedProject | null) {
      supersede();
      if (!project) { update({ status: "EMPTY", project: null, error: null, documentHtml: null }); return; }
      const snapshot = snapshotProject(project);
      const hasEntry = snapshot.files.some((file) => file.path === PREVIEW_ENTRY_PATH);
      update(hasEntry
        ? { status: "READY", project: snapshot, error: null, documentHtml: null }
        : { status: "ERROR", project: snapshot, error: "NO_ENTRY", documentHtml: null });
    },
    clear() {
      supersede();
      update({ status: "EMPTY", project: null, error: null, documentHtml: null });
    },
    /** Resolves when this render attempt settles, including when it was superseded. */
    async render(): Promise<void> {
      const project = state.project;
      if (!project || state.error === "NO_ENTRY") return;
      supersede();
      const current = new AbortController();
      controller = current;
      update({ status: "RENDERING", project, error: null, documentHtml: null });
      const revision = state.revision;
      try {
        const result = await engine.render(project, current.signal);
        if (revision === state.revision) {
          update({
            status: "SUCCESS",
            project,
            error: null,
            documentHtml: result ? result.documentHtml : null,
          });
        }
      } catch {
        if (revision === state.revision) {
          update({ status: "ERROR", project, error: "ENGINE_FAILURE", documentHtml: null });
        }
      } finally {
        if (controller === current) controller = null;
      }
    },
    dispose() {
      supersede();
      listeners.clear();
    },
  };
}
export type PreviewModel = ReturnType<typeof createPreviewModel>;
