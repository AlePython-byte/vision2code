import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const theme = read("../src/styles/theme.css");

test("theme declares the three design-system families as tokens", () => {
  assert.match(theme, /--font-display:\s*"Sora",/);
  assert.match(theme, /--font-sans:\s*"Space Grotesk",/);
  assert.match(theme, /--font-mono:\s*"IBM Plex Mono",/);
});

test("fonts are bundled from @fontsource packages, with no remote font URL", () => {
  const imports = theme.split("\n").filter((line) => line.startsWith("@import"));
  for (const family of ["sora", "space-grotesk", "ibm-plex-mono"]) {
    assert.ok(imports.some((line) => line.includes(`@fontsource/${family}/latin-`)), family);
  }
  for (const line of imports) assert.doesNotMatch(line, /https?:\/\//, line);
  assert.doesNotMatch(imports.join("\n"), /ibm-plex-sans/, "old body font no longer imported");
  for (const file of ["../src/styles/theme.css", "../src/styles/foundation.css", "../src/features/editor/editor.css", "../src/features/preview/preview.css", "../index.html"]) {
    assert.doesNotMatch(read(file), /fonts\.googleapis|fonts\.gstatic|https?:\/\/[^"')\s]*font/i, file);
  }
});

test("headings, buttons and tabs use the display family; body keeps the sans token", () => {
  assert.match(theme, /h1, h2, h3, button, \[role="tab"\] \{ font-family: var\(--font-display\); \}/);
  assert.match(theme, /font-family: var\(--font-sans\);\s*color: var\(--color-ink\);/);
});

test("package declares the bundled fonts and drops IBM Plex Sans", () => {
  const dependencies = JSON.parse(read("../package.json")).dependencies as Record<string, string>;
  for (const name of ["@fontsource/sora", "@fontsource/space-grotesk", "@fontsource/ibm-plex-mono"]) assert.ok(dependencies[name], name);
  assert.equal(dependencies["@fontsource/ibm-plex-sans"], undefined);
});
