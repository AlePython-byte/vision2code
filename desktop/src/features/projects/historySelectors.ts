import type { GenerationSummary } from "@vision2code/contracts";
import type { GenerationOrigin, GenerationSaveStatus } from "../generation/generationSessionModel.ts";

export type HistoryLanguage = "es" | "en";

/**
 * Which project's history the Code view shows. A result (even a local-only one) owns the view:
 * a local-only result has no history and is never attached to the selected project.
 */
export function resolveHistoryProjectId(
  session: { readonly artifact: unknown; readonly projectId: string | null },
  projects: { readonly selectedProjectId: string | null },
): string | null {
  return session.artifact !== null ? session.projectId : projects.selectedProjectId;
}

/** History is newest first, so the newest generation carries the highest number. */
export function generationNumber(items: readonly unknown[], index: number): number {
  return items.length - index;
}

export function generationNumberOf(items: readonly GenerationSummary[], generationId: string | null): number | null {
  if (generationId === null) return null;
  const index = items.findIndex((item) => item.id === generationId);
  return index < 0 ? null : generationNumber(items, index);
}

export function formatGenerationNumber(value: number): string {
  return String(value).padStart(2, "0");
}

const JUST_NOW: Record<HistoryLanguage, string> = { es: "justo ahora", en: "just now" };
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Minute/hour/day granularity for the history log. `now` is injectable for deterministic tests.
 * (relativeProjectDate keeps its own day-level behavior for the Vault.)
 */
export function relativeTimeLabel(value: string, language: HistoryLanguage, now: Date = new Date()): string {
  const date = new Date(value);
  const elapsed = now.getTime() - date.getTime();
  if (!Number.isFinite(elapsed)) return "";
  if (elapsed < MINUTE_MS) return JUST_NOW[language];
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "always" });
  if (elapsed < HOUR_MS) return formatter.format(-Math.floor(elapsed / MINUTE_MS), "minute");
  if (elapsed < DAY_MS) return formatter.format(-Math.floor(elapsed / HOUR_MS), "hour");
  const day = (item: Date) => Date.UTC(item.getFullYear(), item.getMonth(), item.getDate());
  const days = Math.max(1, Math.round((day(now) - day(date)) / DAY_MS));
  if (days === 1) return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-1, "day");
  if (days < 30) return formatter.format(-days, "day");
  return new Intl.DateTimeFormat(language, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export type ResultChipTone = "success" | "info" | "progress" | "warning" | "neutral" | "error";
export type ResultChipLabel = "chipGenerated" | "chipRestored" | "chipSaving" | "chipUnsaved" | "chipLocal" | "chipNotSaveable";

export interface ResultChip {
  readonly tone: ResultChipTone;
  readonly label: ResultChipLabel;
  /** Only for RESTORED: the generation's position in the project history, when known. */
  readonly number: number | null;
  /** Local editor drafts exist on top of the shown generation. */
  readonly edited: boolean;
}

/** Pure chip derivation; null when there is no result to describe. */
export function deriveResultChip(input: {
  readonly origin: GenerationOrigin | null;
  readonly saveStatus: GenerationSaveStatus;
  readonly draftCount: number;
  readonly generationNumber: number | null;
}): ResultChip | null {
  if (input.origin === null) return null;
  const edited = input.draftCount > 0;
  if (input.origin === "RESTORED") return { tone: "info", label: "chipRestored", number: input.generationNumber, edited };
  switch (input.saveStatus) {
    case "SAVED": return { tone: "success", label: "chipGenerated", number: null, edited };
    case "SAVE_FAILED": return { tone: "warning", label: "chipUnsaved", number: null, edited };
    case "PROJECT_REQUIRED": return { tone: "neutral", label: "chipLocal", number: null, edited };
    case "NOT_PERSISTABLE": return { tone: "error", label: "chipNotSaveable", number: null, edited };
    // IDLE is the instant between completing a generation and issuing its save.
    case "SAVING":
    case "IDLE": return { tone: "progress", label: "chipSaving", number: null, edited };
  }
}
