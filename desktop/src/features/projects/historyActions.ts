import type { GenerationSessionModel } from "../generation/generationSessionModel.ts";
import { mayReplaceWorkingCopy } from "./discardGuard.ts";

export type HistorySelectOutcome = "CURRENT" | "CANCELLED" | "OPENED" | "FAILED";

/**
 * Restores a saved generation chosen from the history. Selecting the current generation is a no-op;
 * unsaved editor drafts require confirmation first. Restoring never analyzes or generates; failures
 * leave the current work untouched and are reported by the session's own restore toast.
 */
export async function selectHistoryGeneration(input: {
  readonly session: Pick<GenerationSessionModel, "openGeneration">;
  readonly projectId: string;
  readonly generationId: string;
  readonly currentGenerationId: string | null;
  readonly hasLocalEdits: () => boolean;
  readonly confirmDiscard: (trigger: HTMLElement | null) => Promise<boolean>;
  readonly trigger: HTMLElement | null;
}): Promise<HistorySelectOutcome> {
  if (input.generationId === input.currentGenerationId) return "CURRENT";
  const allowed = await mayReplaceWorkingCopy(input.hasLocalEdits, input.confirmDiscard, input.trigger);
  if (!allowed) return "CANCELLED";
  return (await input.session.openGeneration(input.projectId, input.generationId)) ? "OPENED" : "FAILED";
}
