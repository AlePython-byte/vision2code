import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectSummary } from "@vision2code/contracts";
import {
  normalizeSearch, projectAccent, projectState, relativeProjectDate, vaultTotals, visibleProjects,
} from "../src/features/projects/vaultSelectors.ts";

const date = "2026-10-13T12:00:00.000Z";
const project = (id: string, name: string, updatedAt = date, generationCount?: number): ProjectSummary => ({
  id, name, createdAt: updatedAt, updatedAt, ...(generationCount === undefined ? {} : { generationCount }),
});
const list = [
  project("a", "Árbol", "2026-10-12T12:00:00.000Z", 2),
  project("b", "Beta", date, 0),
  project("c", "Álbum", date, 3),
  project("d", "Aster", date),
];

test("search trims, folds case and diacritics, and empty query includes all", () => {
  assert.equal(normalizeSearch("  ÁRbol "), "arbol");
  assert.deepEqual(visibleProjects(list, " arBOL ", "ALL", "RECENT", "es").map((p) => p.id), ["a"]);
  assert.equal(visibleProjects(list, "  ", "ALL", "RECENT", "es").length, 4);
});

test("state derives from generation count and state filters use real data", () => {
  assert.equal(projectState(list[0]!), "ACTIVE");
  assert.equal(projectState(list[1]!), "DRAFT");
  assert.equal(projectState(list[3]!), "DRAFT");
  assert.deepEqual(visibleProjects(list, "", "ACTIVE", "RECENT", "en").map((p) => p.id), ["c", "a"]);
  assert.deepEqual(visibleProjects(list, "", "DRAFT", "RECENT", "en").map((p) => p.id), ["d", "b"]);
});

test("recent uses timestamp then localized name; name and generations sort are deterministic", () => {
  assert.deepEqual(visibleProjects(list, "", "ALL", "RECENT", "en").map((p) => p.id), ["c", "d", "b", "a"]);
  assert.deepEqual(visibleProjects(list, "", "ALL", "GENERATIONS", "en").map((p) => p.id), ["c", "a", "d", "b"]);
  const names = [project("x", "Ñandú"), project("y", "Nube")];
  for (const language of ["es", "en"] as const) {
    const expected = [...names].sort((a, b) => a.name.localeCompare(b.name, language)).map((p) => p.id);
    assert.deepEqual(visibleProjects(names, "", "ALL", "NAME", language).map((p) => p.id), expected);
  }
});

test("combined query, state, and sort gives no results cleanly", () => {
  assert.deepEqual(visibleProjects(list, "al", "ACTIVE", "NAME", "es").map((p) => p.id), ["c"]);
  assert.deepEqual(visibleProjects(list, "arbol", "DRAFT", "RECENT", "es"), []);
});

test("accent is stable and limited to palette; aggregates use visible projects", () => {
  const accents = new Set(["purple", "cyan", "green"]);
  for (const item of list) {
    assert.ok(accents.has(projectAccent(item.id)));
    assert.equal(projectAccent(item.id), projectAccent(item.id));
  }
  assert.deepEqual(vaultTotals(visibleProjects(list, "", "ACTIVE", "RECENT", "en")), { projects: 2, generations: 5 });
  assert.deepEqual(vaultTotals([]), { projects: 0, generations: 0 });
});

test("relative labels are localized with injected now and switch to dates after 30 days", () => {
  const now = new Date("2026-10-13T18:00:00.000Z");
  assert.equal(relativeProjectDate(date, "en", now), "today");
  assert.equal(relativeProjectDate(date, "es", now), "hoy");
  assert.equal(relativeProjectDate("2026-10-12T12:00:00.000Z", "en", now), "yesterday");
  assert.equal(relativeProjectDate("2026-10-12T12:00:00.000Z", "es", now), "ayer");
  assert.equal(relativeProjectDate("2026-10-10T12:00:00.000Z", "en", now), "3 days ago");
  assert.equal(relativeProjectDate("2026-10-10T12:00:00.000Z", "es", now), "hace 3 días");
  assert.match(relativeProjectDate("2026-08-01T12:00:00.000Z", "en", now), /Aug/);
  assert.match(relativeProjectDate("2026-08-01T12:00:00.000Z", "es", now), /ago/);
});
