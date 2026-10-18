import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { AVATAR_EYE_VARIANTS, AVATAR_PALETTE_COUNT, avatarSpec, fnv1a, mulberry32 } from "../src/features/account/avatarSpec.ts";
import { readDisplayName, mapSupabaseUser } from "../src/features/auth/supabaseAuthProvider.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { preferences } from "../src/features/preferences/preferences.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { AVATAR_PAIRS, ratioFor, readThemeTokens } from "../../scripts/contrast.mts";
import { requireLocalSource } from "./source-loader.ts";

function load(file: string, overrides: Record<string, unknown> = {}) {
  const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, { exports, require: (name: string) => {
    if (name in overrides) return overrides[name];
    if (name === "lucide-react") return lucide;
    if (name === "./preferences") return { preferences };
    if (name.endsWith("/useLabels") || name === "./useLabels") return { useLabels: () => ({ t: i18n.t.bind(i18n) }) };
    if (name.endsWith("/previewModel")) return { createPreviewModel: () => ({ setProject() {}, render: () => Promise.resolve(), subscribe: () => () => {}, getSnapshot: () => ({ status: "EMPTY" }) }) };
    if (name.endsWith("/previewSync")) return { syncEditorToPreview: () => ({ dispose() {}, flush: async () => {}, isPending: () => false }) };
    if (name.endsWith("/PreviewPanel")) return { PreviewPanel: () => null };
    if (name.endsWith("/ProjectVault")) return { ProjectVault: () => React.createElement("main", { id: "project-vault" }) };
    const local = requireLocalSource(file, name, require);
    if (local) return local;
    return require(name);
  } });
  return exports;
}

const shellOverrides = {
  "./Workspace": { Workspace: () => React.createElement("div", { id: "workspace" }) },
  "../editor/EditorWorkspace": { EditorWorkspace: () => React.createElement("div", { id: "code-workspace" }) },
  "../settings/SettingsScreen": { SettingsScreen: () => React.createElement("main", { id: "settings-workspace" }) },
  "../editor/editorModel": { createEditorModel: () => ({}) },
};

const ID_A = "3f6c1d52-8a4e-4b7f-9d10-5e2a7c9b0a11";
const ID_B = "b81e0a97-2c35-4f6d-8e44-1a9d3f7c5b02";

function renderRail(user: { id: string; email: string; displayName?: string }, language: "es" | "en" = "es") {
  const { ApplicationShell } = load("workspace/ApplicationShell.tsx", shellOverrides);
  return i18n.changeLanguage(language).then(() => renderToStaticMarkup(React.createElement(ApplicationShell, {
    onLogin() {}, user: { emailVerified: true, ...user },
  })));
}
const nav = (html: string) => html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
/** What a sighted user reads: the markup with every tag (and so every attribute, tooltips included) removed. */
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

// ---- avatarSpec ----------------------------------------------------------------------------------------------

test("avatarSpec is deterministic: the same seed gives the same palette, blob and eyes on every call", () => {
  const first = avatarSpec(ID_A);
  assert.deepEqual(avatarSpec(ID_A), first);
  assert.equal(avatarSpec(ID_A).blobPath, first.blobPath);
  assert.ok(Object.isFrozen(first));
  assert.notDeepEqual(avatarSpec(ID_B), first);
  // Known values of the two primitives, so a change to either (and so to everybody's avatar) is deliberate.
  assert.equal(fnv1a(""), 0x811c9dc5);
  assert.equal(fnv1a("a"), 0xe40c292c);
  const random = mulberry32(1);
  assert.deepEqual([random(), random()].map((value) => Math.round(value * 1e6) / 1e6), [0.627074, 0.002736]);
});

test("avatarSpec is pure: no imports, no clock, no Math.random", () => {
  const source = readFileSync(new URL("../src/features/account/avatarSpec.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import /m);
  assert.doesNotMatch(source, /Math\.random|Date\.|performance\.|fetch\(|localStorage/);
});

test("200 seeds give a wide spread: every palette and eye variant, nearly all palette x eyes pairs, all different blobs", () => {
  const specs = Array.from({ length: 200 }, (_, index) => avatarSpec(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`));
  const pairs = new Set(specs.map((spec) => `${spec.palette}/${spec.eyes}`));
  assert.ok(pairs.size >= 30, `only ${pairs.size} of ${AVATAR_PALETTE_COUNT * AVATAR_EYE_VARIANTS.length} palette/eyes pairs`);
  assert.equal(new Set(specs.map((spec) => spec.palette)).size, AVATAR_PALETTE_COUNT);
  assert.equal(new Set(specs.map((spec) => spec.eyes)).size, AVATAR_EYE_VARIANTS.length);
  assert.equal(new Set(specs.map((spec) => spec.blobPath)).size, 200, "every seed draws its own blob");
  assert.ok(new Set(specs.map((spec) => JSON.stringify(spec))).size >= 195);
});

test("the blob is a closed smooth path of eight Bézier segments that stays inside the 64 x 64 view box", () => {
  for (let index = 0; index < 200; index += 1) {
    const { blobPath } = avatarSpec(`seed-${index}`);
    assert.match(blobPath, /^M[-\d. ]+(C[-\d. ]+){8}Z$/);
    const numbers = (blobPath.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    assert.equal(numbers.length, 2 + 8 * 6);
    for (const value of numbers) assert.ok(value >= 0 && value <= 64, `${value} outside the view box for seed-${index}`);
  }
});

// ---- contrast ------------------------------------------------------------------------------------------------

test("eyes keep 3:1 against the blob in every palette, in both themes (scripts/contrast.mts)", () => {
  const css = readFileSync(new URL("../src/styles/foundation.css", import.meta.url), "utf8");
  const themes = readThemeTokens(css);
  assert.equal(AVATAR_PAIRS.length, AVATAR_PALETTE_COUNT * 2);
  for (const theme of ["light", "dark"] as const) {
    for (const pair of AVATAR_PAIRS) {
      const ratio = ratioFor(themes[theme], pair.foreground, pair.background);
      assert.ok(ratio >= pair.minimum, `${theme} ${pair.label}: ${ratio.toFixed(2)}:1 < ${pair.minimum}:1`);
    }
    for (let palette = 1; palette <= AVATAR_PALETTE_COUNT; palette += 1) {
      for (const part of ["bg", "blob", "eyes"]) assert.ok(themes[theme][`--avatar-${palette}-${part}`], `${theme} --avatar-${palette}-${part}`);
    }
  }
  const theme = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  for (let palette = 1; palette <= AVATAR_PALETTE_COUNT; palette += 1) {
    assert.match(theme, new RegExp(`\\.avatar-palette-${palette} \\{ --avatar-bg: var\\(--avatar-${palette}-bg\\);`));
  }
});

// ---- component -----------------------------------------------------------------------------------------------

test("GeneratedAvatar is an inline decorative SVG in two sizes and draws every eye variant", () => {
  const { GeneratedAvatar } = load("account/GeneratedAvatar.tsx");
  const md = renderToStaticMarkup(React.createElement(GeneratedAvatar, { seed: ID_A }));
  const sm = renderToStaticMarkup(React.createElement(GeneratedAvatar, { seed: ID_A, size: "sm" }));
  assert.match(md, /^<svg class="generated-avatar generated-avatar-md avatar-palette-\d" viewBox="0 0 64 64" aria-hidden="true" focusable="false"/);
  assert.match(sm, /generated-avatar-sm/);
  assert.doesNotMatch(md, /<text|<image|href=|style=|<title/, "no text, no resource, no inline style");
  const seen = new Set<string>();
  for (let index = 0; seen.size < AVATAR_EYE_VARIANTS.length && index < 500; index += 1) {
    const html = renderToStaticMarkup(React.createElement(GeneratedAvatar, { seed: `eyes-${index}` }));
    seen.add(html.match(/data-avatar-eyes="(\w+)"/)![1]!);
    assert.match(html, /avatar-eyes-(fill|line)/);
  }
  assert.deepEqual([...seen].sort(), [...AVATAR_EYE_VARIANTS].sort());
});

// ---- the rail --------------------------------------------------------------------------------------------------

test("the e-mail address is never visible text in the rail, only a tooltip; the label is the display name or 'Cuenta' / 'Account'", async () => {
  const email = "jorgealejandroparrab@outlook.com";
  for (const language of ["es", "en"] as const) {
    const html = nav(await renderRail({ id: ID_A, email }, language));
    assert.equal(visibleText(html).toLowerCase().includes("jorgealejandro"), false, `${language}: no part of the address is visible`);
    assert.equal(visibleText(html).includes("@"), false);
    assert.match(html, new RegExp(`class="navigation-note account" title="${email.replace(/[.]/g, "\\.")}"`), "the full address is the tooltip");
    assert.match(html, new RegExp(`<span class="account-name">${language === "es" ? "Cuenta" : "Account"}</span>`));
  }
  const named = nav(await renderRail({ id: ID_A, email, displayName: "Ana Ruiz" }));
  assert.match(named, /<span class="account-name">Ana Ruiz<\/span>/);
  assert.equal(visibleText(named).includes("outlook"), false);
});

test("the avatar seed is the user id: same id and another address give the same face, another id gives another", async () => {
  const face = (html: string) => html.match(/<svg class="generated-avatar[\s\S]*?<\/svg>/)![0];
  const a1 = face(await renderRail({ id: ID_A, email: "one@example.com" }));
  const a2 = face(await renderRail({ id: ID_A, email: "completely.different@other.org", displayName: "Someone Else" }));
  const b = face(await renderRail({ id: ID_B, email: "one@example.com" }));
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  const shell = readFileSync(new URL("../src/features/workspace/ApplicationShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<GeneratedAvatar seed=\{user\.id\} size="md" \/>/);
  const settings = readFileSync(new URL("../src/features/settings/SettingsScreen.tsx", import.meta.url), "utf8");
  assert.match(settings, /<GeneratedAvatar seed=\{user\.id\} size="sm" \/>/);
  for (const source of [shell, settings]) assert.doesNotMatch(source, /seed=\{[^}]*email/i);
});

test("Settings > Account shows the address in a row, with the small avatar; without a user there is no account section", async () => {
  await i18n.changeLanguage("es");
  const { SettingsScreen } = load("settings/SettingsScreen.tsx");
  const withUser = renderToStaticMarkup(React.createElement(SettingsScreen, { user: { id: ID_A, email: "designer@example.com", emailVerified: true } }));
  assert.match(withUser, /<h2 id="account-title">Cuenta<\/h2>/);
  assert.match(withUser, /<dt>Correo electrónico<\/dt><dd class="account-email-value">designer@example\.com<\/dd>/);
  assert.match(withUser, /generated-avatar-sm/);
  const without = renderToStaticMarkup(React.createElement(SettingsScreen));
  assert.doesNotMatch(without, /account-title|generated-avatar/);
  assert.equal(en.accountEmailLabel, "Email");
  assert.deepEqual(Object.keys(es).filter((key) => key.startsWith("account")).sort(), Object.keys(en).filter((key) => key.startsWith("account")).sort());
});

// ---- sign out label --------------------------------------------------------------------------------------------

test("the rail item is 'Cerrar sesión' / 'Sign out' in its text, aria-label and title; nothing still says 'Salir'", async () => {
  const user = { id: ID_A, email: "designer@example.com" };
  const spanish = await renderRail(user, "es");
  assert.match(spanish, /<small>Cerrar sesión<\/small>/);
  assert.match(spanish, /aria-label="Cerrar sesión"/);
  assert.match(spanish, /title="Cerrar sesión \(designer@example\.com\)"/);
  const english = await renderRail(user, "en");
  assert.match(english, /<small>Sign out<\/small>/);
  assert.match(english, /aria-label="Sign out"/);
  assert.match(english, /title="Sign out \(designer@example\.com\)"/);
  for (const [key, value] of Object.entries(es)) assert.doesNotMatch(String(value), /\bSalir\b/, `es.${key}`);
});

// ---- display name ----------------------------------------------------------------------------------------------

test("display name comes only from user_metadata.full_name / name, cleaned and capped, and is absent otherwise", () => {
  const user = (metadata: Record<string, unknown> | undefined) => ({ id: "u", email: "a@b.co", user_metadata: metadata }) as unknown as User;
  assert.equal(readDisplayName(user({ full_name: "  Ana   Ruiz " })), "Ana Ruiz");
  assert.equal(readDisplayName(user({ name: "Luis" })), "Luis");
  assert.equal(readDisplayName(user({ full_name: "Ana", name: "Other" })), "Ana");
  assert.equal(readDisplayName(user({ full_name: "   ", name: "Luis" })), "Luis", "a blank full_name falls through to name");
  assert.equal(readDisplayName(user({ full_name: "A\u0000‮B\nC" })), "A B C", "control and bidi characters are replaced");
  assert.equal(readDisplayName(user({ full_name: 42, name: null })), undefined);
  assert.equal(readDisplayName(user({ nickname: "x", email: "leak@example.com" })), undefined);
  assert.equal(readDisplayName(user(undefined)), undefined);
  assert.equal(Array.from(readDisplayName(user({ full_name: "😀".repeat(80) }))!).length, 40);
  const mapped = mapSupabaseUser({ id: "u", email: "a@b.co", user_metadata: {} } as unknown as User);
  assert.deepEqual(Object.keys(mapped).sort(), ["email", "emailVerified", "id"], "no displayName key when there is none");
  assert.equal(mapSupabaseUser({ id: "u", email: "a@b.co", user_metadata: { name: "Luis" } } as unknown as User).displayName, "Luis");
});
