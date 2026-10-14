import type { GenerationSessionModel } from "../generation/generationSessionModel.ts";
import { selectHistoryGeneration, type HistorySelectOutcome } from "./historyActions.ts";

/**
 * Opens a generation chosen in the library. The discard guard and the restore itself are exactly the
 * history tray's flow (selectHistoryGeneration); only a successful pick closes the dialog and goes to Code.
 * Cancelling the discard prompt or a failed restore leave the dialog open and the current work untouched.
 */
export async function chooseLibraryGeneration(input: {
  readonly session: Pick<GenerationSessionModel, "openGeneration">;
  readonly library: { closeDialog(): void };
  readonly projectId: string;
  readonly generationId: string;
  readonly currentGenerationId: string | null;
  readonly hasLocalEdits: () => boolean;
  readonly confirmDiscard: (trigger: HTMLElement | null) => Promise<boolean>;
  readonly trigger: HTMLElement | null;
  readonly openCode: () => void;
}): Promise<HistorySelectOutcome> {
  const outcome = await selectHistoryGeneration(input);
  if (outcome === "OPENED" || outcome === "CURRENT") {
    input.library.closeDialog();
    input.openCode();
  }
  return outcome;
}
