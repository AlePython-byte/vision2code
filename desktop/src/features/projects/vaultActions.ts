import type { ProjectsModel } from "./projectsModel.ts";
import type { GenerationSessionModel } from "../generation/generationSessionModel.ts";
import type { ToastModel } from "../feedback/toastModel.ts";

export const VAULT_OPEN_TOAST_KEY = "vault-open";
export type VaultOpenOutcome = "OPENED" | "SUPERSEDED" | "FAILED" | "UNAUTHORIZED";
type VaultProjects = Pick<ProjectsModel, "selectProject" | "getSnapshot" | "getSelectionEpoch" | "getSessionEpoch">;

function selectionOutcome(projects: VaultProjects, projectId: string, selectionEpoch: number, sessionEpoch: number): VaultOpenOutcome {
  const state = projects.getSnapshot();
  if (projects.getSessionEpoch() !== sessionEpoch || state.error === "UNAUTHORIZED") return "UNAUTHORIZED";
  if (projects.getSelectionEpoch() !== selectionEpoch || state.selectedProjectId !== projectId) return "SUPERSEDED";
  // A stale error from another operation cannot invalidate a confirmed detail.
  return state.selectedProject?.id === projectId ? "OPENED" : "FAILED";
}

async function selectForVault(projects: VaultProjects, projectId: string): Promise<{ outcome: VaultOpenOutcome; selectionEpoch: number; sessionEpoch: number }> {
  const sessionEpoch = projects.getSessionEpoch();
  const request = projects.selectProject(projectId);
  const selectionEpoch = projects.getSelectionEpoch();
  try { await request; }
  catch {
    const outcome = selectionOutcome(projects, projectId, selectionEpoch, sessionEpoch);
    return { outcome: outcome === "OPENED" ? "FAILED" : outcome, selectionEpoch, sessionEpoch };
  }
  return { outcome: selectionOutcome(projects, projectId, selectionEpoch, sessionEpoch), selectionEpoch, sessionEpoch };
}

function showOpenFailure(toasts: Pick<ToastModel, "show">) {
  toasts.show({ key: VAULT_OPEN_TOAST_KEY, tone: "error", eyebrow: "toastEyebrowError",
    message: "vaultOpenFailed", persistent: false, durationMs: 4000 });
}

export async function openVaultProject(
  projects: VaultProjects,
  toasts: Pick<ToastModel, "show">,
  projectId: string,
  navigate: () => void,
): Promise<VaultOpenOutcome> {
  const { outcome } = await selectForVault(projects, projectId);
  if (outcome === "FAILED") showOpenFailure(toasts);
  if (outcome !== "OPENED") return outcome;
  navigate();
  return "OPENED";
}

export async function openVaultLatest(
  projects: VaultProjects,
  session: Pick<GenerationSessionModel, "openGeneration">,
  toasts: Pick<ToastModel, "show">,
  projectId: string,
  generationId: string,
  navigate: () => void,
): Promise<VaultOpenOutcome> {
  const selected = await selectForVault(projects, projectId);
  if (selected.outcome === "FAILED") showOpenFailure(toasts);
  if (selected.outcome !== "OPENED") return selected.outcome;
  const opened = await session.openGeneration(projectId, generationId);
  const outcome = selectionOutcome(projects, projectId, selected.selectionEpoch, selected.sessionEpoch);
  if (outcome !== "OPENED") return outcome;
  // The generation session already reports restore failures through its own toast channel.
  if (!opened) return "FAILED";
  navigate();
  return "OPENED";
}
