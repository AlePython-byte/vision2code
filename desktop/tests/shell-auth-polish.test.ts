import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as lucide from "lucide-react";
import { i18n } from "../src/features/preferences/i18n.ts";
import { preferences } from "../src/features/preferences/preferences.ts";
import { en, es } from "../src/features/preferences/resources.ts";
import { FIELD_FILL_STEP, FIELD_PAIRS, ratioFor, readThemeTokens } from "../../scripts/contrast.mts";

function load(file: string, overrides: Record<string, unknown> = {}) {
  const source = readFileSync(new URL("../src/features/" + file, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  const require = createRequire(import.meta.url);
  runInNewContext(code, { exports, require: (name: string) => {
    if (name in overrides) return overrides[name];
    if (name === "lucide-react") return lucide;
    if (name === "./preferences") return { preferences };
    if (name.includes("authProbe")) return { probeBackendAuth: async () => ({ ok: true, status: 200, isUnauthorized: false }) };
    if (name.endsWith("/useLabels") || name === "./useLabels") return { useLabels: () => ({ t: i18n.t.bind(i18n) }) };
    if (name.endsWith("/previewModel")) return { createPreviewModel: () => ({ setProject() {}, render: () => Promise.resolve(), subscribe: () => () => {}, getSnapshot: () => ({ status: "EMPTY" }) }) };
    if (name.endsWith("/previewSync")) return { syncEditorToPreview: () => ({ dispose() {}, flush: async () => {}, isPending: () => false }) };
    if (name.endsWith("/PreviewPanel")) return { PreviewPanel: () => null };
    if (name.endsWith("/ProjectVault")) return { ProjectVault: () => React.createElement("main", { id: "project-vault" }) };
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

function libraryModel(open: boolean) {
  return { subscribe: () => () => {}, getSnapshot: () => ({ open }), openDialog() {} };
}
function renderShell(options: { open?: boolean; withServices?: boolean; email?: string } = {}) {
  const { ApplicationShell } = load("workspace/ApplicationShell.tsx", shellOverrides);
  const { LibraryNavButton } = load("workspace/LibraryNavButton.tsx");
  const library = libraryModel(options.open ?? false);
  const services = options.withServices === false ? undefined : { editorModel: {}, previewModel: {}, projectsModel: {}, generationSession: {}, toasts: {}, library };
  return renderToStaticMarkup(React.createElement(ApplicationShell, {
    onLogin() {}, services, libraryNav: React.createElement(LibraryNavButton, { library }),
    ...(options.email ? { user: { id: "u", email: options.email, emailVerified: true } } : {}),
  }));
}
const navigation = (html: string) => html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
const currentItems = (html: string) => [...navigation(html).matchAll(/<button[^>]*aria-current="[^"]*"[^>]*>/g)].map((match) => match[0]);

test("the rail never highlights two items: with the library open only Library is current, and the page returns when it closes", async () => {
  await i18n.changeLanguage("es");
  const closed = currentItems(renderShell({ open: false }));
  assert.equal(closed.length, 1);
  assert.match(closed[0]!, /aria-current="page"[^>]*aria-label="Proyectos"/);

  const open = currentItems(renderShell({ open: true }));
  assert.equal(open.length, 1, "the page behind the modal is not highlighted");
  assert.match(open[0]!, /aria-haspopup="dialog"[^>]*aria-expanded="true"[^>]*aria-current="true"[^>]*aria-label="Biblioteca"/);

  assert.equal(currentItems(renderShell({ open: false, withServices: false })).length, 1, "capture view without services");
  assert.match(currentItems(renderShell({ open: false }))[0]!, /aria-current="page"/, "closing brings the current page back");
});

test("accountInitials derives up to two initials locally from the address", () => {
  const { accountInitials } = load("workspace/ApplicationShell.tsx", shellOverrides);
  assert.equal(accountInitials("jorgealejandroparrab@outlook.com"), "JO");
  assert.equal(accountInitials("long.designer@example.com"), "LD");
  assert.equal(accountInitials("ana_maria-lopez@x.co"), "AM");
  assert.equal(accountInitials("x@y.z"), "X");
  assert.equal(accountInitials("álvaro@x.es"), "ÁL");
  assert.equal(accountInitials("@nothing"), "?");
});

test("the account is a round avatar plus the address on one line with the full value in the title", async () => {
  await i18n.changeLanguage("es");
  const email = "jorgealejandroparrab@outlook.com";
  const html = renderShell({ email });
  assert.match(html, /<span class="account-avatar" aria-hidden="true">JO<\/span>/);
  assert.match(html, new RegExp(`<span class="account-email" title="${email.replace(/[.]/g, "\\.")}">${email.replace(/[.]/g, "\\.")}</span>`));
  assert.match(html, new RegExp(`class="navigation-note account" title="${email.replace(/[.]/g, "\\.")}"`));
  assert.doesNotMatch(html, /<br\/?>[^<]*<span class="account/, "no manual line breaks inside the account block");

  const css = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  assert.match(css, /\.account-email \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
  assert.doesNotMatch(css, /line-clamp/, "no multi-line clamp is left for the address");
  assert.match(css, /\.account-avatar \{[^}]*border-radius: 50%;/);
  const compactStart = css.indexOf("@media (max-width: 760px) and (min-width: 561px)");
  const compact = css.slice(compactStart, css.indexOf("@media (max-width: 560px)", compactStart));
  assert.match(compact, /\.account-email, \.account-version \{\s*display: none;/, "icon-only rails keep just the avatar");
  assert.doesNotMatch(compact, /\.account-avatar\s*\{[^}]*display:\s*none/);
});

test("theme and language are accessible radio groups with a single tab stop each", async () => {
  await i18n.changeLanguage("es");
  preferences.set({ theme: "light", language: "es" });
  const { PreferenceControls } = load("preferences/PreferenceControls.tsx");
  const html = renderToStaticMarkup(React.createElement(PreferenceControls));
  assert.doesNotMatch(html, /<select|<option/);
  const groups = [...html.matchAll(/<div class="fidelity-segmented preference-segmented" role="radiogroup" aria-labelledby="([^"]+)"[^>]*>(.*?)<\/div>/g)];
  assert.equal(groups.length, 2);
  for (const [, labelId, body] of groups) {
    assert.match(html, new RegExp(`<span id="${labelId}" class="preference-label">`), "the group is named by its visible label");
    assert.equal((body!.match(/role="radio"/g) ?? []).length, 2);
    assert.equal((body!.match(/aria-checked="true"/g) ?? []).length, 1, "exactly one option is checked");
    assert.equal((body!.match(/tabindex="0"/g) ?? []).length, 1, "roving tabindex: one tab stop");
    assert.equal((body!.match(/tabindex="-1"/g) ?? []).length, 1);
  }
  assert.match(html, /aria-label="Español"[^>]*>ES/);
  assert.match(html, /aria-label="English"[^>]*>EN/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/, "icons are decorative");
  assert.match(html, /class="fidelity-segment preference-segment active"[^>]*><svg[^>]*>.*?<\/svg>Claro/);
});

test("arrows, Home and End move the selection and the focus inside a radio group, wrapping around", () => {
  const { SegmentedRadioGroup } = load("preferences/PreferenceControls.tsx");
  const options = [{ value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }, { value: "auto", label: "Auto" }];
  function flatten(element: any): any[] {
    if (!element || typeof element !== "object") return [];
    return [element, ...React.Children.toArray(element.props?.children).flatMap(flatten)];
  }
  function press(value: string, key: string) {
    const changes: string[] = [];
    const focused: number[] = [];
    const radios = options.map((_, index) => ({ focus: () => focused.push(index) }));
    const group = flatten(SegmentedRadioGroup({ id: "g", label: "Tema", icon: null, value, options, onChange: (next: string) => changes.push(next) }))
      .find((node) => node.props?.role === "radiogroup");
    let prevented = false;
    group.props.onKeyDown({ key, preventDefault: () => { prevented = true; }, currentTarget: { querySelectorAll: () => radios } });
    return { changes, focused, prevented };
  }
  assert.deepEqual(press("light", "ArrowRight"), { changes: ["dark"], focused: [1], prevented: true });
  assert.deepEqual(press("auto", "ArrowRight").changes, ["light"], "wraps forward");
  assert.deepEqual(press("light", "ArrowLeft").changes, ["auto"], "wraps backward");
  assert.deepEqual(press("dark", "ArrowDown").changes, ["auto"]);
  assert.deepEqual(press("dark", "ArrowUp").changes, ["light"]);
  assert.deepEqual(press("dark", "Home"), { changes: ["light"], focused: [0], prevented: true });
  assert.deepEqual(press("light", "End"), { changes: ["auto"], focused: [2], prevented: true });
  assert.deepEqual(press("dark", "a"), { changes: [], focused: [], prevented: false }, "other keys do nothing");
  // Clicking an option selects it; the selected radio is the one in the tab order.
  const group = flatten(SegmentedRadioGroup({ id: "g", label: "Tema", icon: null, value: "dark", options, onChange() {} }));
  const radios = group.filter((node) => node.props?.role === "radio");
  assert.deepEqual(radios.map((node) => [node.props["aria-checked"], node.props.tabIndex]), [[false, -1], [true, 0], [false, -1]]);
});

test("choosing a theme or a language still persists through the same preferences model", () => {
  const { SegmentedRadioGroup } = load("preferences/PreferenceControls.tsx");
  preferences.set({ theme: "light", language: "es" });
  const source = readFileSync(new URL("../src/features/preferences/PreferenceControls.tsx", import.meta.url), "utf8");
  assert.match(source, /onChange=\{\(theme\) => preferences\.set\(\{ theme \}\)\}/);
  assert.match(source, /onChange=\{\(language\) => preferences\.set\(\{ language \}\)\}/);
  assert.equal(typeof SegmentedRadioGroup, "function");
});

test("the duplicate Create account / Sign in link under the button is gone; the tabs do that job", async () => {
  const source = readFileSync(new URL("../src/features/login/Login.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /secondary-switch|createAccount/);
  assert.equal("createAccount" in es || "createAccount" in en, false, "the unused key was removed");
  const css = readFileSync(new URL("../src/styles/foundation.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /secondary-switch/);

  await i18n.changeLanguage("es");
  preferences.set({ theme: "light", language: "es" });
  const controls = load("preferences/PreferenceControls.tsx");
  const { Login } = load("login/Login.tsx", { "../preferences/PreferenceControls": controls });
  const html = renderToStaticMarkup(React.createElement(Login, { onDemo() {} }));
  assert.doesNotMatch(html, /secondary-switch/);
  assert.equal((html.match(/Crear cuenta/g) ?? []).length, 1, "Create account appears once: as the tab");
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
});

test("the story column is top-aligned, so switching tabs cannot move it, and the login fits a 1280x720 window", () => {
  const css = readFileSync(new URL("../src/styles/foundation.css", import.meta.url), "utf8");
  assert.match(css, /\.login-grid \{[^}]*align-items: start;/);
  assert.doesNotMatch(css, /\.login-grid \{[^}]*align-items: center;/);
  assert.match(css, /\.login-story \{ padding-top: clamp\(/);
  const shell = /\.login-shell \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(shell, /min-height: 100dvh;/);
  assert.match(shell, /box-sizing: border-box;/);
  assert.doesNotMatch(css, /\.login-grid \{[^}]*padding: 64px 0 24px;/);
});

test("form fields keep 3:1 between their border and the card and the fill, in both themes (WCAG 1.4.11)", () => {
  const css = readFileSync(new URL("../src/styles/foundation.css", import.meta.url), "utf8");
  const themes = readThemeTokens(css);
  for (const theme of ["light", "dark"] as const) {
    for (const pair of FIELD_PAIRS) {
      const ratio = ratioFor(themes[theme], pair.foreground, pair.background);
      assert.ok(ratio >= pair.minimum, `${theme}: ${pair.label} is ${ratio.toFixed(2)}:1, needs ${pair.minimum}:1`);
    }
    assert.ok(ratioFor(themes[theme], FIELD_FILL_STEP.foreground, FIELD_FILL_STEP.background) >= 1.2, `${theme}: the fill is a visible step from the card`);
  }
  assert.match(css, /\.login-panel input \{[^}]*background: var\(--color-field\);[^}]*border: 1px solid var\(--color-field-border\);/);
  const vault = readFileSync(new URL("../src/features/projects/vault.css", import.meta.url), "utf8");
  assert.match(vault, /\.vault-dialog input \{[^}]*border: 1px solid var\(--color-field-border\);[^}]*background: var\(--color-field\);/);
});
