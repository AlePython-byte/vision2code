import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import { AVATAR_EYE_VARIANTS, AVATAR_MOUTH_VARIANTS, avatarSpec } from "../src/features/account/avatarSpec.ts";
import { i18n } from "../src/features/preferences/i18n.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { handleVaultDialogKey } from "../src/features/projects/vaultKeyboard.ts";
import { PLACEHOLDER_THUMBNAIL } from "../src/features/projects/thumbnailBlocks.ts";
import { requireLocalSource } from "./source-loader.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const theme = read("../src/styles/theme.css");
const vault = read("../src/features/projects/vault.css");

function load(file: string, overrides: Record<string, unknown> = {}) {
  const code = ts.transpileModule(read("../src/features/" + file), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, { exports, require: (name: string) => {
    if (name in overrides) return overrides[name];
    if (name === "lucide-react") return lucide;
    if (name.endsWith("/useLabels")) return { useLabels: () => ({ t: i18n.t.bind(i18n) }) };
    if (name.endsWith("/i18n")) return { i18n };
    return requireLocalSource(file, name, require) ?? require(name);
  } });
  return exports;
}

const IDS = ["3f6c1d52-8a4e-4b7f-9d10-5e2a7c9b0a11", "b81e0a97-2c35-4f6d-8e44-1a9d3f7c5b02", ...Array.from({ length: 120 }, (_, i) => `seed-${i}`)];

// ---- avatar ----------------------------------------------------------------------------------------------------

test("every avatar has exactly two eyes and one mouth, for every eye and mouth variant", () => {
  const { GeneratedAvatar } = load("account/GeneratedAvatar.tsx");
  const seenEyes = new Set<string>();
  const seenMouths = new Set<string>();
  for (const id of IDS) {
    const spec = avatarSpec(id);
    seenEyes.add(spec.eyes);
    seenMouths.add(spec.mouth);
    const svg = renderToStaticMarkup(React.createElement(GeneratedAvatar, { seed: id }));
    // After the background and the blob come the eyes, then the mouth (the last shape).
    const shapes = svg.match(/<(circle|path|ellipse)[^>]*>/g)!.slice(2);
    const mouth = shapes.pop()!;
    assert.match(mouth, /avatar-eyes-(line|fill)/);
    // "wide" draws a ring and a pupil per eye (4 shapes); every other variant draws one shape per eye.
    const expected = spec.eyes === "wide" ? 4 : 2;
    assert.equal(shapes.length, expected, `${id} (${spec.eyes}) draws ${shapes.length} eye shapes`);
    assert.match(svg, new RegExp(`data-avatar-mouth="${spec.mouth}"`));
  }
  assert.deepEqual([...seenEyes].sort(), [...AVATAR_EYE_VARIANTS].sort());
  assert.deepEqual([...seenMouths].sort(), [...AVATAR_MOUTH_VARIANTS].sort());
  assert.ok(!(AVATAR_EYE_VARIANTS as readonly string[]).includes("wink"), "no one-eyed variant");
});

test("the avatar stays deterministic and keeps the palette, eyes and blob of before; the mouth is new", () => {
  const a = avatarSpec(IDS[0]!);
  assert.deepEqual(avatarSpec(IDS[0]!), a);
  // Reference values: palette, eyes and blob are those of the previous version; only the mouth is new.
  assert.deepEqual([a.palette, a.eyes, a.mouth, a.blobPath.slice(0, 20)], [1, "sleepy", "smile", "M51.59 33.59C51.31 3"]);
  const b = avatarSpec(IDS[1]!);
  assert.deepEqual([b.palette, b.eyes, b.blobPath.slice(0, 20)], [1, "sleepy", "M52.96 29.64C53.45 3"]);
  assert.ok(Object.isFrozen(a));
  assert.doesNotMatch(read("../src/features/account/avatarSpec.ts"), /^import |email/im, "pure, and seeded by the user id, never the address");
});

test("the Settings account avatar is the large size", () => {
  assert.match(theme, /\.generated-avatar-lg \{ width: 88px; height: 88px; \}/);
  // foundation.css is not layered and sizes icons in Settings to 18px: the avatar must be excluded from that rule.
  assert.match(read("../src/styles/foundation.css"), /\.settings-workspace svg:not\(\.generated-avatar\)/);
  assert.match(read("../src/features/settings/SettingsScreen.tsx"), /<GeneratedAvatar seed=\{user\.id\} size="lg" \/>/);
});

// ---- image viewer ----------------------------------------------------------------------------------------------

test("the reference preview is a labelled button that opens the viewer; the image is decorative inside it", async () => {
  await i18n.changeLanguage("es");
  const { ScreenshotPreview } = load("screenshot/ScreenshotPreview.tsx", { "./ImageViewer": { ImageViewer: () => null } });
  const html = renderToStaticMarkup(React.createElement(ScreenshotPreview, { screenshot: { url: "blob:x", name: "panel.png", width: 640, height: 400, size: 1000, format: "PNG" } }));
  assert.match(html, /<button[^>]*class="screenshot-zoom"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"[^>]*aria-label="Ampliar la imagen de referencia panel\.png"/);
  assert.match(html, /<img src="blob:x" alt=""/);
  assert.doesNotMatch(html, /role="dialog"/, "closed by default");
});

test("the viewer is a modal dialog with trapped focus, Esc to close and focus returned to the opener", () => {
  const source = read("../src/features/screenshot/ImageViewer.tsx");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby="image-viewer-title"/);
  assert.match(source, /closeButton\.current\?\.focus\(\)/, "focus moves in");
  assert.match(source, /trigger\?\.isConnected\) trigger\.focus\(\)/, "focus returns to the opener");
  assert.match(source, /createPortal\(/);
  // The trap: with a single focusable element Tab never leaves it, and Esc closes.
  const calls: string[] = [];
  const only = { focus: () => calls.push("focus") };
  const tab = { key: "Tab", shiftKey: false, preventDefault: () => calls.push("prevent") };
  handleVaultDialogKey(tab, false, [only], only, () => calls.push("close"));
  handleVaultDialogKey({ ...tab, shiftKey: true }, false, [only], only, () => calls.push("close"));
  handleVaultDialogKey({ key: "Escape", shiftKey: false, preventDefault: () => calls.push("prevent") }, false, [only], only, () => calls.push("close"));
  assert.deepEqual(calls, ["prevent", "focus", "prevent", "focus", "prevent", "close"]);
});

test("the viewer respects prefers-reduced-motion and paints with tokens only", () => {
  assert.match(theme, /@media \(prefers-reduced-motion: reduce\) \{\s+\.image-viewer-scrim \{ animation: none; \}/);
  const rules = theme.split("\n").filter((line) => /\.(image-viewer|screenshot-zoom)/.test(line)).join("\n");
  assert.ok(rules.length > 0);
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "no fixed colours in the new rules");
});

// ---- Capture: gap and semantics --------------------------------------------------------------------------------

test("the profile panel hugs its content on wide windows (no gap above the actions) and both parts keep a role", () => {
  const wide = theme.slice(theme.indexOf("@media (min-width: 851px) {\n  .capture-view"));
  assert.match(wide, /\.profile-body \{ flex: 0 1 auto;/);
  assert.match(wide, /\.capture-grid > \.profile-panel \{ align-self: start; max-height: 100%; \}/);
  const capture = read("../src/features/analysis/CaptureConsole.tsx");
  assert.match(capture, /className="profile-body" role="group" aria-labelledby="profile-title"/);
  assert.match(capture, /className="profile-footer" role="group" aria-label=\{t\("profileActionsLabel"\)\}/);
  assert.ok(capture.indexOf('className="profile-body"') < capture.indexOf('className="profile-footer"'), "focus order: options, then actions");
});

test("the fidelity segments are at least 32px tall", () => {
  assert.match(theme, /\.fidelity-segment \{[^}]*min-height: 32px;/);
});

// ---- thumbnails ------------------------------------------------------------------------------------------------

test("the thumbnail backdrop takes the page's own surface, so a short page leaves no grey strip", () => {
  assert.match(vault, /\.thumb-backdrop\.thumb-tone-light \{ fill: var\(--thumb-paper\); \}/);
  assert.match(vault, /\.thumb-backdrop\.thumb-tone-deep \{ fill: var\(--thumb-slate\); \}/);
  const { SchemaThumbnail } = load("projects/SchemaThumbnail.tsx", { "./thumbnailModel.ts": {} });
  const dark = { ...PLACEHOLDER_THUMBNAIL, empty: false, blocks: [{ kind: "page", tone: "deep", x: 0, y: 0, w: 160, h: 30, r: 0, dark: true }] };
  assert.match(renderToStaticMarkup(React.createElement(SchemaThumbnail, { model: dark })), /class="thumb-backdrop thumb-tone-deep"/);
  assert.match(renderToStaticMarkup(React.createElement(SchemaThumbnail, { model: null, state: "loading" })), /class="thumb-backdrop thumb-tone-light"/, "the placeholder page is light");
});

// ---- Settings copy ---------------------------------------------------------------------------------------------

test("Settings speaks plainly in both languages and has no jargon left", () => {
  const keys = Object.keys(es).filter((key) => /^(settings|appearance|language|spanishLanguage|englishLanguage|lightTheme|darkTheme|telemetry|account|activeThemeLabel|activeLanguageLabel|persistence|runtime)/.test(key));
  assert.ok(keys.length > 25);
  const jargon = /telemetr|calibra|diagn[oó]stic|instrumentaci|laborator|lumin|localStorage|i18next|Desktop Shell|Tauri|\/\/|console|consola|workstation|estaci[oó]n|standardized|operational|operativo/i;
  for (const key of keys) {
    for (const [lang, value] of [["es", (es as Record<string, string>)[key]!], ["en", (en as Record<string, string>)[key]!]] as const) {
      assert.ok(value && value.length > 0, `${lang}.${key}`);
      assert.doesNotMatch(value, jargon, `${lang}.${key}: ${value}`);
      assert.doesNotMatch(value, /#[0-9a-fA-F]{6}/, `${lang}.${key} shows no colour codes`);
    }
  }
  for (const key of ["enlargeScreenshot", "enlargeHint", "imageViewerTitle", "imageViewerClose", "profileActionsLabel"] as const) {
    assert.ok(es[key] && en[key] && es[key] !== en[key], key);
  }
  assert.doesNotMatch(read("../src/features/settings/SettingsScreen.tsx"), /ONLINE|i18next|#[0-9A-Fa-f]{6}/);
});

test("the Settings column is capped and centred so it does not stretch on large screens", () => {
  assert.match(theme, /\.settings-workspace \{ width: 100%; max-width: 920px; margin-inline: auto; \}/);
});

// ---- Code preview ----------------------------------------------------------------------------------------------

test("the preview document paints the area below a short page with the page's own background", () => {
  const runtime = read("../src/features/preview/runtime/previewRuntime.ts");
  assert.match(runtime, /function initPageBackground\(rootEl\)/);
  assert.match(runtime, /canvas\.style\.backgroundColor = bg/);
  assert.match(runtime, /initPageBackground\(rootEl\);\s+initFitToViewport\(\);/);
});
