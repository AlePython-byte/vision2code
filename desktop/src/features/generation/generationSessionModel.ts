import { GeneratedProjectSchema, UISchemaSchema } from "@vision2code/contracts";
import type { CreateGenerationInput, GenerationDetail, GenerationSummary } from "@vision2code/contracts";
import { ProjectsClientError } from "../projects/projectsClient.ts";
import type { ProjectsClient, ProjectsErrorCode } from "../projects/projectsClient.ts";
import type { CompletedGenerationArtifact } from "./generationArtifact.ts";
import type { GeneratedProject } from "./generatedProject.ts";

/**
 * IDLE: no result. PROJECT_REQUIRED: generated locally without a project selected at analysis start.
 * NOT_PERSISTABLE: the artifact failed the shared contracts (a generator defect, never sent to the API).
 */
export type GenerationSaveStatus = "IDLE" | "PROJECT_REQUIRED" | "NOT_PERSISTABLE" | "SAVING" | "SAVED" | "SAVE_FAILED";
export type GenerationRestoreStatus = "IDLE" | "LOADING" | "FAILED";
export type GenerationOrigin = "GENERATED" | "RESTORED";

export interface GenerationSessionState {
  readonly artifact: CompletedGenerationArtifact | null;
  readonly origin: GenerationOrigin | null;
  /** Project the current result belongs to (captured at analysis start, or the restored generation's project). */
  readonly projectId: string | null;
  readonly generationId: string | null;
  readonly saveStatus: GenerationSaveStatus;
  readonly saveError: ProjectsErrorCode | null;
  /** Save requests issued for the current artifact; above 1 means a retry. */
  readonly saveAttempts: number;
  readonly restoreStatus: GenerationRestoreStatus;
  readonly restoreError: ProjectsErrorCode | null;
  readonly revision: number;
}

export interface GenerationSessionDependencies {
  readonly client: Pick<ProjectsClient, "createGeneration" | "getGeneration">;
  /** Receives confirmed generations so project lists stay current without a refetch. */
  readonly projects?: { recordGeneration(projectId: string, generation: GenerationSummary): void };
  /** Loads code into the editor and preview; both copy the project, so edits never reach the artifact. */
  readonly loadProject: (project: GeneratedProject) => void;
  readonly onUnauthorized?: () => void;
}

function safeCode(error: unknown): ProjectsErrorCode {
  return error instanceof ProjectsClientError ? error.code : "UNKNOWN";
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Detached, immutable copy: later edits elsewhere can never alter what is persisted or retried. */
function own<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

type SaveOutcome = Pick<GenerationSessionState, "artifact" | "projectId" | "generationId" | "saveStatus" | "saveError" | "saveAttempts">;

/**
 * Single owner of the current generation result and its cloud persistence.
 * A save response only updates the session while that same stored artifact is shown; responses for
 * a replaced result are discarded (the project list still records committed generations).
 * Retrying reuses the stored artifact and its captured project; it never analyzes or generates again.
 *
 * One analysis result is persisted at most once per session: restoring another generation keeps the
 * last generated result and its save outcome, so generating that same result again returns to it
 * (same stored artifact, generation id and status, a pending save included) instead of saving twice.
 */
export function createGenerationSessionModel(deps: GenerationSessionDependencies) {
  const initial = { artifact: null, origin: null, projectId: null, generationId: null,
    saveStatus: "IDLE", saveError: null, saveAttempts: 0, restoreStatus: "IDLE", restoreError: null } as const;
  let state: GenerationSessionState = Object.freeze({ ...initial, revision: 0 });
  let restoreEpoch = 0;
  let resetEpoch = 0;
  // Identity of the last artifact handed to complete(); re-opening the same result never saves twice.
  // While a restored generation is shown, `outcome` keeps this result's own save state.
  let lastInput: { artifact: CompletedGenerationArtifact; loadable: boolean; outcome: SaveOutcome | null } | null = null;
  const listeners = new Set<() => void>();

  function update(changes: Partial<Omit<GenerationSessionState, "revision">>) {
    state = Object.freeze({ ...state, ...changes, revision: state.revision + 1 });
    listeners.forEach((listener) => listener());
  }

  function unauthorized(code: ProjectsErrorCode, reset: number) {
    if (code === "UNAUTHORIZED" && reset === resetEpoch) deps.onUnauthorized?.();
  }

  const showing = (artifact: CompletedGenerationArtifact) => state.origin === "GENERATED" && state.artifact === artifact;

  /** Applies a save result to the session, or to the remembered outcome while a restore is shown. */
  function settle(artifact: CompletedGenerationArtifact, changes: Partial<SaveOutcome>) {
    if (showing(artifact)) update(changes);
    else if (lastInput?.outcome?.artifact === artifact) lastInput.outcome = { ...lastInput.outcome, ...changes };
  }

  async function save(artifact: CompletedGenerationArtifact, projectId: string): Promise<void> {
    const reset = resetEpoch;
    update({ saveStatus: "SAVING", saveError: null, saveAttempts: state.saveAttempts + 1 });
    const body: CreateGenerationInput = {
      sourceImagePath: null,
      sourceImageName: artifact.sourceImageName,
      sourceImageMimeType: artifact.sourceImageMimeType,
      uiSchema: artifact.uiSchema,
      generatedProject: artifact.generatedProject,
      generationTarget: artifact.generationTarget,
      fidelityMode: artifact.fidelityMode,
    };
    try {
      const generation = await deps.client.createGeneration(projectId, body);
      if (reset !== resetEpoch) return;
      // The server committed this generation, so the project list reflects it even if the session moved on.
      deps.projects?.recordGeneration(projectId, generation);
      settle(artifact, { saveStatus: "SAVED", saveError: null, generationId: generation.id });
    } catch (error) {
      const code = safeCode(error);
      unauthorized(code, reset);
      if (reset !== resetEpoch) return;
      settle(artifact, { saveStatus: "SAVE_FAILED", saveError: code });
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },

    /** Shows a successful generation immediately, then persists it under the project captured at analysis start. */
    complete(artifact: CompletedGenerationArtifact): Promise<void> {
      if (lastInput?.artifact === artifact && state.artifact !== null && state.origin === "GENERATED") {
        // Same analysis result generated again: reload the original code, keep the existing save outcome.
        if (lastInput.loadable) deps.loadProject(state.artifact.generatedProject);
        return Promise.resolve();
      }
      const remembered = lastInput?.artifact === artifact ? lastInput.outcome : null;
      if (lastInput && remembered?.artifact) {
        // Same analysis result after a restore: return to it with its own save outcome; never save again.
        ++restoreEpoch;
        const loadable = lastInput.loadable;
        lastInput = { artifact, loadable, outcome: null };
        if (loadable) deps.loadProject(remembered.artifact.generatedProject);
        update({ ...remembered, origin: "GENERATED", restoreStatus: "IDLE", restoreError: null });
        return Promise.resolve();
      }
      ++restoreEpoch;
      const project = GeneratedProjectSchema.safeParse(artifact.generatedProject);
      const schema = UISchemaSchema.safeParse(artifact.uiSchema);
      const stored = own(project.success && schema.success
        ? { ...artifact, generatedProject: project.data, uiSchema: schema.data } : artifact);
      lastInput = { artifact, loadable: project.success, outcome: null };
      if (project.success) deps.loadProject(stored.generatedProject);
      const base = { artifact: stored, origin: "GENERATED" as const, projectId: artifact.targetProjectId,
        generationId: null, saveError: null, saveAttempts: 0, restoreStatus: "IDLE" as const, restoreError: null };
      if (!project.success || !schema.success) {
        update({ ...base, saveStatus: "NOT_PERSISTABLE" });
        return Promise.resolve();
      }
      if (artifact.targetProjectId === null) {
        update({ ...base, saveStatus: "PROJECT_REQUIRED" });
        return Promise.resolve();
      }
      update({ ...base, saveStatus: "IDLE" });
      return save(stored, artifact.targetProjectId);
    },

    /**
     * Re-sends the same stored artifact to the same captured project; ignored unless the last save failed.
     * Known risk: without idempotency keys, a response lost after the server committed (e.g. a network drop)
     * reports SAVE_FAILED, and retrying then stores a duplicate generation.
     */
    retrySave(): Promise<void> {
      const { artifact, saveStatus, projectId } = state;
      if (saveStatus !== "SAVE_FAILED" || artifact === null || projectId === null) return Promise.resolve();
      return save(artifact, projectId);
    },

    /** Restores a stored generation without analysis or generation; failures keep the current work untouched. */
    async openGeneration(projectId: string, generationId: string): Promise<boolean> {
      const request = ++restoreEpoch;
      const reset = resetEpoch;
      update({ restoreStatus: "LOADING", restoreError: null });
      let generation: GenerationDetail;
      try {
        generation = await deps.client.getGeneration(projectId, generationId);
      } catch (error) {
        const code = safeCode(error);
        unauthorized(code, reset);
        if (request === restoreEpoch && reset === resetEpoch) update({ restoreStatus: "FAILED", restoreError: code });
        return false;
      }
      if (request !== restoreEpoch || reset !== resetEpoch) return false;
      if (generation.projectId !== projectId || generation.id !== generationId) {
        update({ restoreStatus: "FAILED", restoreError: "UNKNOWN" });
        return false;
      }
      // Keep the generated result (and its save outcome) so generating it again never saves twice.
      if (lastInput && state.origin === "GENERATED") {
        const { artifact: shown, projectId: shownProject, generationId, saveStatus, saveError, saveAttempts } = state;
        lastInput.outcome = { artifact: shown, projectId: shownProject, generationId, saveStatus, saveError, saveAttempts };
      }
      const artifact = own<CompletedGenerationArtifact>({
        uiSchema: generation.uiSchema,
        generatedProject: generation.generatedProject,
        fidelityMode: generation.fidelityMode,
        generationTarget: generation.generationTarget,
        sourceImageName: generation.sourceImageName,
        sourceImageMimeType: generation.sourceImageMimeType,
        targetProjectId: generation.projectId,
      });
      deps.loadProject(artifact.generatedProject);
      update({ artifact, origin: "RESTORED", projectId: generation.projectId, generationId: generation.id,
        saveStatus: "SAVED", saveError: null, saveAttempts: 0, restoreStatus: "IDLE", restoreError: null });
      return true;
    },

    clearRestoreError() {
      if (state.restoreError !== null) update({ restoreStatus: "IDLE", restoreError: null });
    },

    /** A new analysis or screenshot replaces the result; pending responses for it are discarded. */
    clear() {
      ++restoreEpoch;
      lastInput = null;
      if (state.artifact !== null || state.restoreStatus !== "IDLE") update(initial);
    },

    /** Session boundary (sign-out or expiration): drop everything and ignore every in-flight response. */
    reset() {
      ++restoreEpoch;
      ++resetEpoch;
      lastInput = null;
      update(initial);
    },
  };
}
export type GenerationSessionModel = ReturnType<typeof createGenerationSessionModel>;
