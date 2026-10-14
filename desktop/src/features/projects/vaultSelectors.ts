import type { ProjectSummary } from "@vision2code/contracts";

export type VaultStateFilter = "ALL" | "ACTIVE" | "DRAFT";
export type VaultSort = "RECENT" | "NAME" | "GENERATIONS";
export type VaultLanguage = "es" | "en";

export function projectState(project: ProjectSummary): "ACTIVE" | "DRAFT" {
  return (project.generationCount ?? 0) > 0 ? "ACTIVE" : "DRAFT";
}

export function normalizeSearch(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

export function projectAccent(id: string): "purple" | "cyan" | "green" {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return (["purple", "cyan", "green"] as const)[hash % 3]!;
}

export function visibleProjects(
  projects: readonly ProjectSummary[], query: string, state: VaultStateFilter,
  sort: VaultSort, language: VaultLanguage,
): ProjectSummary[] {
  const normalized = normalizeSearch(query);
  const locale = language === "es" ? "es" : "en";
  const nameOrder = (a: ProjectSummary, b: ProjectSummary) => a.name.localeCompare(b.name, locale);
  const recentOrder = (a: ProjectSummary, b: ProjectSummary) =>
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || nameOrder(a, b);
  return projects.filter((project) =>
    (state === "ALL" || projectState(project) === state)
    && (!normalized || normalizeSearch(project.name).includes(normalized))
  ).sort((a, b) => sort === "NAME" ? nameOrder(a, b) || recentOrder(a, b)
    : sort === "GENERATIONS" ? (b.generationCount ?? 0) - (a.generationCount ?? 0) || recentOrder(a, b)
      : recentOrder(a, b));
}

export function vaultTotals(projects: readonly ProjectSummary[]): { projects: number; generations: number } {
  return { projects: projects.length, generations: projects.reduce((sum, project) => sum + (project.generationCount ?? 0), 0) };
}

export function relativeProjectDate(value: string, language: VaultLanguage, now: Date = new Date()): string {
  const date = new Date(value);
  const locale = language === "es" ? "es" : "en";
  const day = (item: Date) => Date.UTC(item.getFullYear(), item.getMonth(), item.getDate());
  const days = Math.max(0, Math.round((day(now) - day(date)) / 86_400_000));
  if (!Number.isFinite(days)) return "";
  if (days > 30) return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
}
