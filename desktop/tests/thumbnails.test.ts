import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GenerationDetail } from "@vision2code/contracts";
import {
  PLACEHOLDER_THUMBNAIL, THUMB_HEIGHT, THUMB_MAX_BLOCKS, THUMB_MAX_DEPTH, THUMB_MAX_NODES, THUMB_WIDTH, schemaThumbnail,
} from "../src/features/projects/thumbnailBlocks.ts";
import { createThumbnailModel } from "../src/features/projects/thumbnailModel.ts";
import { ProjectsClientError } from "../src/features/projects/projectsClient.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { AVATAR_PAIRS, THUMBNAIL_PAIRS, ratioFor, readThemeTokens } from "../../scripts/contrast.mts";
import { html, loadModule, settle, type Lang } from "./ui-harness.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const fixtureNames = readdirSync(new URL("./fixtures/ui-schemas/", import.meta.url)).filter((name) => name.endsWith(".json"));
const fixture = (name: string) => JSON.parse(read(`./fixtures/ui-schemas/${name}`));

/** A schema by hand: only the fields the thumbnail reads. */
function node(type: string, x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) {
  return { id: `${type}-${x}-${y}`, type, name: type, bounds: { x, y, width, height }, style: {}, children: [], ...extra };
}
const page = (children: unknown[], width = 1000, height = 500, root: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0", source: { width, height }, root: { ...node("FRAME", 0, 0, width, height, root), children },
});
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") { Object.values(value as object).forEach(deepFreeze); Object.freeze(value); }
  return value;
};

// ---- thumbnailBlocks: determinism and purity ----------------------------------------------------------------------

test("schemaThumbnail is deterministic, pure and never mutates its input", () => {
  const input = deepFreeze(fixture("linear-landing.v1.json"));
  const first = schemaThumbnail(input);
  assert.deepEqual(schemaThumbnail(input), first);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.blocks) && Object.isFrozen(first.blocks[0]));
  const source = read("../src/features/projects/thumbnailBlocks.ts");
  assert.doesNotMatch(source, /^import /m, "no dependencies");
  assert.doesNotMatch(source, /Math\.random|Date\.|performance\.|fetch\(|localStorage|document\.|window\./);
});

test("every real fixture draws something recognisable inside the fixed 160 x 100 box", () => {
  assert.ok(fixtureNames.length >= 12);
  for (const name of fixtureNames) {
    const model = schemaThumbnail(fixture(name));
    assert.equal(model.empty, false, name);
    assert.equal(model.truncated, false, `${name} is small enough for the limits`);
    assert.equal(model.width, THUMB_WIDTH);
    assert.equal(model.height, THUMB_HEIGHT);
    assert.ok(model.blocks.length >= 5, name);
    assert.ok(model.blocks.some((block) => block.kind === "text"), `${name} has text lines`);
    for (const block of model.blocks) {
      for (const value of [block.x, block.y, block.w, block.h, block.r]) assert.ok(Number.isFinite(value), `${name}: ${JSON.stringify(block)}`);
      assert.ok(block.x >= 0 && block.y >= 0 && block.x + block.w <= THUMB_WIDTH + 0.01 && block.y + block.h <= THUMB_HEIGHT + 0.01, `${name} stays in the box: ${JSON.stringify(block)}`);
      assert.ok(block.w > 0 && block.h > 0);
    }
  }
});

test("proportions and hierarchy: scaled to the width, parents before children, text lines inside their frame", () => {
  const model = schemaThumbnail(page([
    node("FRAME", 100, 50, 400, 200, { style: { background: "#fafafa", radius: 20 }, children: [
      node("TEXT", 120, 70, 300, 40, { text: { content: "Heading of the card", fontSize: 32, fontWeight: 700, lineHeight: 40, textAlign: "START" } }),
      node("BUTTON", 120, 180, 120, 40, { style: { background: "#7762f5", radius: 20 }, text: { content: "Go", fontSize: 14 } }),
    ] }),
    node("IMAGE", 600, 50, 300, 200, { image: { description: "x", fit: "COVER" } }),
    node("INPUT", 100, 300, 500, 50, { text: { content: "Email", fontSize: 14 } }),
    node("DIVIDER", 100, 400, 800, 1),
    node("ICON", 900, 450, 40, 40),
  ]));
  const scale = THUMB_WIDTH / 1000;
  const [pageBlock, frame, heading] = model.blocks;
  assert.equal(pageBlock!.kind, "page");
  assert.deepEqual([pageBlock!.x, pageBlock!.y, pageBlock!.w, pageBlock!.h], [0, 0, 160, 80], "a 1000 x 500 page fills the width and 80 units of height");
  assert.equal(frame!.kind, "frame");
  assert.deepEqual([frame!.x, frame!.y, frame!.w, frame!.h], [100 * scale, 50 * scale, 400 * scale, 200 * scale]);
  assert.equal(heading!.kind, "text");
  assert.equal(heading!.tone, "strong", "large bold text reads as a heading");
  assert.ok(heading!.x >= frame!.x && heading!.x + heading!.w <= frame!.x + frame!.w + 0.01 && heading!.y >= frame!.y, "the line sits inside its frame");
  assert.ok(model.blocks.indexOf(heading!) > model.blocks.indexOf(frame!), "paint order: parent first");
  const kinds = new Set(model.blocks.map((block) => block.kind));
  for (const kind of ["page", "frame", "text", "button", "image", "input", "divider", "icon"]) assert.ok(kinds.has(kind as never), kind);
  assert.equal(model.blocks.find((block) => block.kind === "button")!.tone, "accent");
  assert.equal(model.blocks.find((block) => block.kind === "icon")!.w, model.blocks.find((block) => block.kind === "icon")!.h, "an icon is a square");
});

test("a dark surface is told from a light one, and the text on it follows", () => {
  const model = schemaThumbnail(page([
    node("FRAME", 0, 0, 500, 250, { style: { background: "#0b0b12" }, children: [node("TEXT", 20, 20, 200, 20, { text: { content: "on dark", fontSize: 16 } })] }),
    node("FRAME", 500, 0, 500, 250, { style: { background: "#f4f4f8" }, children: [node("TEXT", 520, 20, 200, 20, { text: { content: "on light", fontSize: 16 } })] }),
  ], 1000, 500, { style: { background: "#ffffff" } }));
  const frames = model.blocks.filter((block) => block.kind === "frame");
  assert.deepEqual(frames.map((block) => block.tone), ["deep", "light"]);
  const texts = model.blocks.filter((block) => block.kind === "text");
  assert.deepEqual(texts.map((block) => block.dark), [true, false]);
  assert.equal(model.blocks[0]!.tone, "light");
  assert.equal(schemaThumbnail(page([], 1000, 500, { style: { background: "#101018" } })).blocks[0]?.tone, undefined, "an empty page is not drawable");
  assert.equal(schemaThumbnail(page([node("TEXT", 10, 10, 100, 20)], 1000, 500, { style: { background: "#101018" } })).blocks[0]!.tone, "deep");
});

test("a page taller than the box shows its top; what lies below is dropped", () => {
  const model = schemaThumbnail(page([node("TEXT", 50, 100, 400, 30), node("TEXT", 50, 4000, 400, 30)], 1000, 5000));
  assert.ok(model.blocks.every((block) => block.y + block.h <= THUMB_HEIGHT + 0.01));
  assert.ok(model.blocks.filter((block) => block.kind === "text").every((block) => block.y < 30), "only lines near the top are drawn (the one at y=4000 is gone)");
  assert.ok(model.blocks.filter((block) => block.kind === "text").length <= 2);
  assert.equal(model.blocks[0]!.h, THUMB_HEIGHT, "the page fills the box");
});

test("the model carries tones, never colours: the schema's own colours are not painted", () => {
  for (const name of fixtureNames) {
    const json = JSON.stringify(schemaThumbnail(fixture(name)));
    assert.doesNotMatch(json, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, name);
  }
});

// ---- thumbnailBlocks: empty, invalid and huge inputs ----------------------------------------------------------------

test("empty and invalid schemas give an empty model and never throw", () => {
  const cyclic: Record<string, unknown> = node("FRAME", 0, 0, 100, 100, { style: { background: "#ffffff" } });
  cyclic.children = [cyclic];
  const inputs: unknown[] = [
    undefined, null, 0, 42, NaN, "text", true, [], {}, { root: null }, { root: [] }, { root: {} }, { root: { bounds: null } },
    { source: { width: 0, height: 0 }, root: node("FRAME", 0, 0, 10, 10) },
    { source: { width: -5, height: 10 }, root: node("FRAME", 0, 0, 10, 10) },
    { source: { width: "wide" }, root: node("FRAME", 0, 0, 10, 10) },
    page([node("TEXT", NaN, 0, 10, 10), node("TEXT", 0, Infinity, 10, 10), node("TEXT", 0, 0, -10, 10), null, 7, "x", [], { type: 5 }]),
    page([node("FRAME", 0, 0, 100, 100, { children: "nope" }), node("NOPE", 0, 0, 100, 100), node("TEXT", 0, 0, 100, 10, { text: { content: 5, fontSize: "big" } })]),
    { source: { width: 100, height: 100 }, root: cyclic },
    Object.create(null), new Date(), () => 1, Symbol("x") as unknown,
  ];
  for (const input of inputs) {
    let model: ReturnType<typeof schemaThumbnail> | undefined;
    assert.doesNotThrow(() => { model = schemaThumbnail(input); }, `input of type ${typeof input}`);
    assert.ok(model && typeof model.empty === "boolean" && Array.isArray(model.blocks));
    for (const block of model!.blocks) for (const value of [block.x, block.y, block.w, block.h]) assert.ok(Number.isFinite(value));
  }
  assert.equal(schemaThumbnail(null).empty, true);
  assert.equal(schemaThumbnail({}).blocks.length, 0);
  assert.equal(schemaThumbnail(page([])).empty, true, "a page with nothing in it is a placeholder, not a blank thumbnail");
  assert.equal(schemaThumbnail({ source: { width: 100, height: 100 }, root: cyclic }).truncated, true, "a cycle ends at the node limit");
});

test("huge schemas stop at the node, depth and block limits (no recursion, no stack overflow)", () => {
  const wide = schemaThumbnail(page(Array.from({ length: 5_000 }, (_, index) => node("TEXT", (index * 7) % 900, (index * 3) % 400, 80, 10, { text: { content: "line", fontSize: 12 } }))));
  assert.ok(wide.nodeCount <= THUMB_MAX_NODES, `${wide.nodeCount} nodes read`);
  assert.equal(wide.truncated, true);
  assert.ok(wide.blocks.length <= THUMB_MAX_BLOCKS);

  let chain: Record<string, unknown> = node("TEXT", 10, 10, 100, 20, { text: { content: "leaf", fontSize: 12 } });
  for (let depth = 0; depth < 100_000; depth += 1) chain = node("FRAME", 0, 0, 1000, 500, { style: { background: "#ffffff" }, children: [chain] });
  const deep = schemaThumbnail({ source: { width: 1000, height: 500 }, root: chain });
  assert.equal(deep.truncated, true);
  assert.ok(deep.blocks.length <= THUMB_MAX_DEPTH + 1, `${deep.blocks.length} frames drawn for a chain of 100,000`);
  assert.ok(deep.nodeCount <= THUMB_MAX_DEPTH + 1);

  const textHeavy = schemaThumbnail(page([node("TEXT", 0, 0, 1000, 5_000, { text: { content: "x".repeat(10_000), fontSize: 2 } })], 1000, 5_000));
  assert.ok(textHeavy.blocks.filter((block) => block.kind === "text").length <= 4, "a text node never draws more than four lines");
  assert.ok(THUMB_MAX_NODES >= 100 && THUMB_MAX_DEPTH >= 4, "limits stay generous enough for the real fixtures");
});

test("the placeholder is drawn by the same code and is not empty", () => {
  assert.equal(PLACEHOLDER_THUMBNAIL.empty, false);
  assert.ok(PLACEHOLDER_THUMBNAIL.blocks.length >= 5);
  assert.deepEqual(schemaThumbnail(PLACEHOLDER_THUMBNAIL), schemaThumbnail(PLACEHOLDER_THUMBNAIL));
});

// ---- thumbnailModel ---------------------------------------------------------------------------------------------------

const projectId = "11111111-1111-4111-8111-111111111111";
const gen = (index: number) => `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
const detail = (id: string, fidelityMode: "FAST" | "BALANCED" | "PRECISE" = "BALANCED") =>
  ({ id, projectId, fidelityMode, uiSchema: fixture("linear-landing.v1.json") }) as unknown as GenerationDetail;
function fakeDetails() {
  const calls: string[] = [];
  const waiting = new Map<string, { resolve: (value: GenerationDetail) => void; reject: (error: unknown) => void }>();
  let inFlight = 0;
  let peak = 0;
  const client = {
    getGeneration(_project: string, id: string) {
      calls.push(id);
      inFlight += 1; peak = Math.max(peak, inFlight);
      return new Promise<GenerationDetail>((resolve, reject) => {
        waiting.set(id, { resolve: (value) => { inFlight -= 1; resolve(value); }, reject: (error) => { inFlight -= 1; reject(error); } });
      });
    },
  };
  return { client, calls, waiting, get peak() { return peak; } };
}

test("thumbnail model: one request per generation, small concurrency, only the block model and the fidelity are kept", async () => {
  const fake = fakeDetails();
  const model = createThumbnailModel({ client: fake.client });
  for (let index = 0; index < 8; index += 1) { model.request(projectId, gen(index)); model.request(projectId, gen(index)); }
  assert.equal(fake.calls.length, 3, "three at a time");
  assert.equal(model.getSnapshot().entries[gen(7)]?.status, "LOADING", "queued ones already show as loading");
  fake.waiting.get(gen(0))!.resolve(detail(gen(0), "PRECISE"));
  await settle();
  assert.equal(fake.calls.length, 4, "a finished request lets the next one start");
  const ready = model.getSnapshot().entries[gen(0)]!;
  assert.equal(ready.status, "READY");
  assert.equal(ready.fidelityMode, "PRECISE");
  assert.equal(ready.thumbnail?.empty, false);
  assert.doesNotMatch(JSON.stringify(ready), /generatedProject|uiSchema|designTokens/, "the schema itself is not kept");
  for (const id of [1, 2, 3]) fake.waiting.get(gen(id))!.resolve(detail(gen(id)));
  await settle();
  for (let index = 4; index < 8; index += 1) { fake.waiting.get(gen(index))?.resolve(detail(gen(index))); await settle(); }
  assert.equal(fake.calls.length, 8, "never requested twice");
  assert.ok(fake.peak <= 3);
  model.request(projectId, gen(0));
  assert.equal(fake.calls.length, 8, "a READY generation is immutable: no refetch");
});

test("thumbnail model: failures are safe codes, UNAUTHORIZED is reported, and the next request tries again", async () => {
  const fake = fakeDetails();
  let unauthorized = 0;
  const model = createThumbnailModel({ client: fake.client, onUnauthorized: () => { unauthorized += 1; } });
  model.request(projectId, gen(1));
  fake.waiting.get(gen(1))!.reject(new ProjectsClientError("SERVER_ERROR"));
  await settle();
  assert.deepEqual([model.getSnapshot().entries[gen(1)]!.status, model.getSnapshot().entries[gen(1)]!.error], ["ERROR", "SERVER_ERROR"]);
  assert.equal(unauthorized, 0, "5xx never expires the session");
  model.request(projectId, gen(1));
  assert.equal(model.getSnapshot().entries[gen(1)]!.status, "LOADING");
  fake.waiting.get(gen(1))!.resolve(detail(gen(1)));
  await settle();
  assert.equal(model.getSnapshot().entries[gen(1)]!.status, "READY");

  model.request(projectId, gen(2));
  fake.waiting.get(gen(2))!.reject(new ProjectsClientError("UNAUTHORIZED"));
  await settle();
  assert.equal(unauthorized, 1);
  model.request(projectId, gen(3));
  fake.waiting.get(gen(3))!.reject(new Error("raw provider message with a secret"));
  await settle();
  assert.equal(model.getSnapshot().entries[gen(3)]!.error, "UNKNOWN");
  assert.doesNotMatch(JSON.stringify(model.getSnapshot()), /secret/);
});

test("thumbnail model: reset drops everything and ignores answers from before it", async () => {
  const fake = fakeDetails();
  const model = createThumbnailModel({ client: fake.client });
  let notified = 0;
  model.subscribe(() => { notified += 1; });
  model.request(projectId, gen(1));
  model.reset();
  assert.deepEqual(model.getSnapshot().entries, {});
  fake.waiting.get(gen(1))!.resolve(detail(gen(1)));
  await settle();
  assert.deepEqual(model.getSnapshot().entries, {}, "a stale answer does not come back after sign-out");
  assert.ok(notified >= 2);
  model.request(projectId, gen(1));
  assert.equal(fake.calls.length, 2, "after the reset it is requested again");
  fake.waiting.get(gen(1))!.resolve(detail(gen(1)));
  await settle();
  assert.equal(model.getSnapshot().entries[gen(1)]!.status, "READY");
});

test("the workspace builds one thumbnail model and resets it with the session", () => {
  const services = read("../src/features/workspace/workspaceServices.ts");
  assert.match(services, /const thumbnails = createThumbnailModel\(\{ client, onUnauthorized: options\.onUnauthorized \}\);/);
  assert.match(services, /thumbnails\.reset\(\);/);
  assert.match(read("../src/features/workspace/ApplicationShell.tsx"), /thumbnails=\{services\.thumbnails\}/);
  assert.match(read("../src/App.tsx"), /thumbnails=\{services\.thumbnails\}/);
});

// ---- component ---------------------------------------------------------------------------------------------------------

const component = (language: Lang, name: string, props: Record<string, unknown>) => html("projects/SchemaThumbnail.tsx", name, language, props);

test("SchemaThumbnail is a decorative inline SVG with a stable 160 x 100 view box in two sizes", () => {
  const model = schemaThumbnail(fixture("tremor-dashboard.v1.json"));
  const md = component("es", "SchemaThumbnail", { model });
  const sm = component("es", "SchemaThumbnail", { model, size: "sm" });
  assert.match(md, /^<div class="schema-thumb-frame schema-thumb-md" data-state="ready" aria-hidden="true"><svg class="schema-thumb" viewBox="0 0 160 100" focusable="false">/);
  assert.match(sm, /schema-thumb-sm/);
  assert.equal((md.match(/<rect class="thumb-block /g) ?? []).length + (md.match(/<circle class="thumb-block /g) ?? []).length > 5, true);
  assert.doesNotMatch(md, /style=|fill="#|stroke="#|<text|<image|href=|<title|<script/, "no inline colour, text or resource");
  assert.doesNotMatch(md, /#[0-9a-f]{3,8}\b/i);
  assert.equal(md, component("es", "SchemaThumbnail", { model }), "same model, same markup");
});

test("loading, empty and unavailable draw the same placeholder page, with a caption only where it helps", () => {
  const loading = component("es", "SchemaThumbnail", { state: "loading", caption: "ignored" });
  assert.match(loading, /data-state="loading"/);
  assert.doesNotMatch(loading, /schema-thumb-caption/, "no caption while loading");
  const empty = component("es", "SchemaThumbnail", { state: "empty", caption: es.thumbNoGenerations });
  assert.match(empty, /data-state="empty"/);
  assert.match(empty, new RegExp(`<span class="schema-thumb-caption">${es.thumbNoGenerations}</span>`));
  const unavailable = component("en", "SchemaThumbnail", { state: "unavailable", caption: en.thumbUnavailable });
  assert.match(unavailable, /data-state="unavailable"/);
  assert.match(unavailable, /No preview/);
  const placeholderBlocks = (markup: string) => markup.match(/<svg[\s\S]*<\/svg>/)![0];
  assert.equal(placeholderBlocks(loading), placeholderBlocks(empty));
  assert.match(component("es", "SchemaThumbnail", { state: "ready", model: schemaThumbnail(null), caption: "x" }), /data-state="empty"/, "a ready but blank model degrades to the placeholder");
});

test("ThumbnailSlot reads the model: ready draws the schema, error says so, a draft or no model shows the placeholder", async () => {
  const fake = fakeDetails();
  const model = createThumbnailModel({ client: fake.client });
  model.request(projectId, gen(1));
  fake.waiting.get(gen(1))!.resolve(detail(gen(1)));
  model.request(projectId, gen(2));
  fake.waiting.get(gen(2))!.reject(new ProjectsClientError("SERVER_ERROR"));
  model.request(projectId, gen(3));
  await settle();
  const slot = (generationId: string | null, thumbnails: unknown = model) => component("es", "ThumbnailSlot", {
    thumbnails, projectId, generationId, emptyCaption: es.thumbNoGenerations, unavailableCaption: es.thumbUnavailable,
  });
  assert.match(slot(gen(1)), /data-state="ready"/);
  assert.match(slot(gen(2)), new RegExp(`data-state="unavailable"[\\s\\S]*${es.thumbUnavailable}`));
  assert.match(slot(gen(3)), /data-state="loading"/);
  assert.match(slot(null), new RegExp(`data-state="empty"[\\s\\S]*${es.thumbNoGenerations}`), "a project without generations");
  assert.match(slot(gen(1), null), /data-state="empty"/, "no model: placeholder");
});

test("FidelityChip names the mode in ES and EN; the full phrase is for screen readers", () => {
  for (const [language, labels] of [["es", es], ["en", en]] as const) {
    for (const [mode, key] of [["FAST", "fidelityFast"], ["BALANCED", "fidelityBalanced"], ["PRECISE", "fidelityPrecise"]] as const) {
      const out = component(language, "FidelityChip", { mode });
      assert.match(out, new RegExp(`class="fidelity-chip" data-mode="${mode.toLowerCase()}"`));
      assert.ok(out.includes(`<span aria-hidden="true">${labels[key]}</span>`));
      assert.ok(out.includes(`<span class="sr-only">${labels.historyFidelity.replace("{{value}}", labels[key])}</span>`));
    }
  }
});

// ---- Projects and Library ----------------------------------------------------------------------------------------------

const withLatest = { id: projectId, name: "Alpha", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-13T10:00:00.000Z", generationCount: 2, latestGenerationId: gen(1) };
const draft = { id: "33333333-3333-4333-8333-333333333333", name: "Draft", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-12T10:00:00.000Z", generationCount: 0, latestGenerationId: null };
const projectsModel = (projects: unknown[], status = "READY") => ({
  subscribe: () => () => {},
  getSnapshot: () => ({ status, projects, error: null, selectedProjectId: null, selectedProject: null, revision: 1 }),
});
async function readyModel() {
  const fake = fakeDetails();
  const model = createThumbnailModel({ client: fake.client });
  model.request(projectId, gen(1));
  fake.waiting.get(gen(1))!.resolve(detail(gen(1), "FAST"));
  await settle();
  return model;
}
const vaultMarkup = (language: Lang, projects: unknown, thumbnails?: unknown) => html("projects/ProjectVault.tsx", "ProjectVault", language, {
  projects, session: {}, toasts: {}, onCapture() {}, onEditor() {}, thumbnails, now: () => new Date("2026-10-13T18:00:00.000Z"),
});

test("Projects: the card shows the thumbnail first, the fidelity chip on it, and the existing actions only", async () => {
  const thumbnails = await readyModel();
  for (const language of ["es", "en"] as const) {
    const out = vaultMarkup(language, projectsModel([withLatest, draft]), thumbnails);
    assert.match(out, /<div class="vault-card-media"><div class="schema-thumb-slot"><div class="schema-thumb-frame schema-thumb-md" data-state="ready"/);
    assert.match(out, /<span class="fidelity-chip" data-mode="fast"/, "the chip comes from the latest generation");
    assert.ok(out.includes(language === "es" ? es.thumbNoGenerations : en.thumbNoGenerations), "a draft project says it has no generations");
    assert.equal((out.match(/class="vault-card raised-panel"/g) ?? []).length, 2);
    assert.match(out, /aria-label="[^"]*Alpha"/);
    assert.doesNotMatch(out, /vault-thumbnail/, "the three-box mock is gone");
    assert.equal((out.match(/vault-card-tool/g) ?? []).length, 0, "no rename/delete tools without onManageProject, and no invented buttons");
    assert.equal((out.match(/vault-card-open/g) ?? []).length, 2, "one open button per card");
  }
  const loading = vaultMarkup("es", projectsModel([withLatest]), createThumbnailModel({ client: fakeDetails().client }));
  assert.match(loading, /data-state="loading"/);
  assert.doesNotMatch(loading, /fidelity-chip/, "no chip until the detail is known");
  assert.match(vaultMarkup("es", projectsModel([withLatest])), /data-state="empty"/, "without a thumbnail model the card still renders");
});

test("Projects: skeletons and the empty state use the same thumbnail language", () => {
  const skeleton = vaultMarkup("en", projectsModel([], "LOADING"));
  assert.equal((skeleton.match(/class="vault-card raised-panel" aria-hidden="true"/g) ?? []).length, 6);
  assert.equal((skeleton.match(/data-state="loading"/g) ?? []).length, 6);
  assert.match(skeleton, /vault-skeleton-line/);
  const empty = vaultMarkup("es", projectsModel([]));
  assert.match(empty, /vault-empty/);
  assert.match(empty, /schema-thumb-frame schema-thumb-md" data-state="empty"/);
  assert.ok(empty.includes(es.vaultEmptyTitle));
});

test("Library: generations are cards with the thumbnail, one open button, date and chip; the picking logic is unchanged", async () => {
  const thumbnails = await readyModel();
  const library = {
    subscribe: () => () => {},
    getSnapshot: () => ({ open: true, focusProjectId: projectId, trigger: null, revision: 1, entries: { [projectId]: { status: "READY", error: null, items: [
      { id: gen(1), projectId, sourceImagePath: null, sourceImageName: "shot.png", sourceImageMimeType: "image/png", generationTarget: "REACT_TAILWIND", fidelityMode: "FAST", createdAt: "2026-10-13T17:55:00.000Z" },
    ] } } }),
  };
  const out = html("projects/LibraryDialog.tsx", "LibraryDialog", "en", {
    library, projects: projectsModel([withLatest]), session: { subscribe: () => () => {}, getSnapshot: () => ({ generationId: null }) },
    openCode() {}, hasLocalEdits: () => false, confirmDiscard: async () => true, now: () => new Date("2026-10-13T18:00:00.000Z"), thumbnails,
  });
  assert.match(out, /<li class="library-card" data-current="false"><div class="library-card-media"><div class="schema-thumb-slot">/);
  assert.match(out, /data-state="ready"/);
  assert.match(out, /<button type="button" class="library-card-open"/);
  assert.equal((out.match(/class="library-card-open"/g) ?? []).length, 1);
  assert.match(out, /5 minutes ago/);
  assert.match(out, /library-card-source" title="shot\.png"/);
  assert.match(out, /fidelity-chip" data-mode="fast"/);
});

// ---- styles ------------------------------------------------------------------------------------------------------------

const block = (css: string) => css.slice(css.indexOf("/* TASK 016D"), css.indexOf("/* END TASK 016D */"));

test("the thumbnail styles paint with tokens only: no colour literals, no fixed pixel colours", () => {
  const css = read("../src/features/projects/vault.css");
  const rules = block(css);
  assert.ok(rules.length > 1500, "the 016D block exists");
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black|red|green|blue|gray|grey)\b\s*[;}]/, "every colour is a var(--token) or a mix of tokens");
  for (const match of rules.matchAll(/(?:fill|stroke|background|color|border-color|border):\s*([^;}]+)/g)) {
    const value = match[1]!.trim();
    if (value === "none" || value === "transparent" || value === "currentColor") continue;
    if (/^\d/.test(value) || /^(?:solid|inherit)\b/.test(value)) continue;
    assert.match(value, /var\(--|color-mix\(in srgb, var\(--/, `colour value without a token: ${value}`);
  }
  for (const source of ["SchemaThumbnail.tsx", "thumbnailBlocks.ts", "thumbnailModel.ts"]) {
    assert.doesNotMatch(read(`../src/features/projects/${source}`), /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, source);
  }
  assert.doesNotMatch(read("../src/features/projects/SchemaThumbnail.tsx"), /style=\{|fill="|stroke="/);
});

test("the grid follows the width (works from the 720 x 540 minimum), the frame keeps 8:5 and motion respects reduced-motion", () => {
  const css = read("../src/features/projects/vault.css");
  assert.match(css, /\.vault-grid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(240px, 1fr\)\);/);
  assert.match(css, /\.schema-thumb-frame \{[^}]*aspect-ratio: 8 \/ 5;/);
  assert.match(css, /\.library-generations \{[^}]*repeat\(auto-fill, minmax\(190px, 1fr\)\);/);
  assert.match(css, /\.library-dialog \{[^}]*width: min\(880px, 100%\);[^}]*overflow-y: auto;/);
  assert.equal((css.match(/vault-grid \{ grid-template-columns: 1fr/g) ?? []).length, 0, "no fixed-column breakpoints are left");
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce) {\n    .vault-card-tool"));
  assert.match(reduced, /\.vault-card, \.library-card \{ transition: none; \}/);
  assert.match(reduced, /\.vault-card:hover:not\(\[aria-hidden='true'\]\) \{ transform: none; \}/);
  assert.match(reduced, /\.schema-thumb-frame\[data-state="loading"\] \.schema-thumb, \.vault-skeleton-line \{ animation: none; \}/);
  const tauri = JSON.parse(read("../src-tauri/tauri.conf.json"));
  assert.deepEqual([tauri.app.windows[0].minWidth, tauri.app.windows[0].minHeight], [720, 540], "the minimum window is untouched");
});

test("keyboard: the Library card's click target is its button, with a visible focus ring; Projects keep their focus styles", () => {
  const css = read("../src/features/projects/vault.css");
  assert.match(css, /\.library-card-open::after \{ content: ""; position: absolute; inset: 0;/);
  assert.match(css, /\.library-card-open:focus-visible::after \{ outline: 2px solid var\(--color-primary\);/);
  assert.match(css, /\.vault-card-open:focus-visible, \.vault-latest:focus-visible \{ outline: 2px solid var\(--color-primary\);/);
  assert.match(css, /\.library-card \{[^}]*position: relative;/);
});

test("thumbnail tokens exist in both themes and their ink keeps contrast on its surface", () => {
  const css = read("../src/styles/foundation.css");
  const themes = readThemeTokens(css);
  for (const theme of ["light", "dark"] as const) {
    for (const name of ["--thumb-paper", "--thumb-paper-raised", "--thumb-on-paper", "--thumb-slate", "--thumb-slate-raised", "--thumb-on-slate"]) {
      assert.ok(themes[theme][name], `${theme} ${name}`);
    }
    for (const pair of THUMBNAIL_PAIRS) {
      const ratio = ratioFor(themes[theme], pair.foreground, pair.background);
      assert.ok(ratio >= pair.minimum, `${theme} ${pair.label}: ${ratio.toFixed(2)}:1 < ${pair.minimum}:1`);
    }
  }
  assert.ok(THUMBNAIL_PAIRS.length >= 7 && AVATAR_PAIRS.length > 0);
});

test("texts exist in Spanish and English with the same keys", () => {
  for (const key of ["thumbNoGenerations", "thumbUnavailable"] as const) {
    assert.ok(es[key] && en[key] && es[key] !== en[key], key);
  }
  assert.equal(es.thumbNoGenerations, "Sin generaciones");
  assert.equal(en.thumbUnavailable, "No preview");
});

test("fixtures are real UISchemas (the thumbnails are drawn from the same files the generator is measured on)", () => {
  const exports = loadModule("projects/SchemaThumbnail.tsx", "es", React, {}, {});
  assert.equal(typeof exports.SchemaThumbnail, "function");
  assert.ok(renderToStaticMarkup(React.createElement(exports.SchemaThumbnail, { model: schemaThumbnail(fixture("codepen-login.v1.json")) })).length > 500);
});
