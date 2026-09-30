import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { UINodeSchema, UISchemaSchema } from "../dist/index.js";

const validFixture: unknown = JSON.parse(readFileSync(new URL("./fixtures/simple-interface.json", import.meta.url), "utf8"));
const invalidFixture: unknown = JSON.parse(readFileSync(new URL("./fixtures/invalid-analysis-output.json", import.meta.url), "utf8"));
const valid = UISchemaSchema.parse(validFixture);

test("a deterministic UISchema v1 fixture parses without losing visible text", () => {
  assert.deepEqual(UISchemaSchema.parse(validFixture), validFixture);
  assert.equal(valid.root.children[0]?.text?.content, "Mi espacio");
});

test("the invalid provider fixture is rejected", () => {
  assert.equal(UISchemaSchema.safeParse(invalidFixture).success, false);
});

test("only schema version 1.0 is supported", () => {
  for (const schemaVersion of ["0.9", "2.0", 1, null, undefined]) {
    assert.equal(UISchemaSchema.safeParse({ ...valid, schemaVersion }).success, false);
  }
});

for (const confidence of [-0.01, 1.01]) {
  test(`confidence ${confidence} is rejected`, () => {
    assert.equal(UISchemaSchema.safeParse({ ...valid, confidence }).success, false);
  });
}

test("confidence accepts both endpoints", () => {
  for (const confidence of [0, 1]) assert.equal(UISchemaSchema.safeParse({ ...valid, confidence }).success, true);
});

test("source dimensions must be positive integers", () => {
  for (const dimension of [0, -1, 1.5, "640", null]) {
    for (const key of ["width", "height"]) {
      assert.equal(UISchemaSchema.safeParse({ ...valid, source: { ...valid.source, [key]: dimension } }).success, false);
    }
  }
});

test("exactly the seven visual node primitives are supported", () => {
  for (const type of ["FRAME", "TEXT", "IMAGE", "ICON", "BUTTON", "INPUT", "DIVIDER"]) {
    assert.equal(UINodeSchema.safeParse({ ...valid.root, type }).success, true);
  }
  for (const type of ["NAVBAR", "HERO", "CARD", "FOOTER", "LOGIN_FORM", "frame", ""]) {
    assert.equal(UINodeSchema.safeParse({ ...valid.root, type }).success, false);
  }
});

test("negative bounds dimensions fail but negative coordinates and zero dimensions are valid", () => {
  for (const key of ["width", "height"]) {
    assert.equal(UINodeSchema.safeParse({ ...valid.root, bounds: { ...valid.root.bounds, [key]: -1 } }).success, false);
  }
  assert.equal(UINodeSchema.safeParse({ ...valid.root, bounds: { x: -10, y: -5, width: 0, height: 0 } }).success, true);
});

test("opacity is constrained to zero through one", () => {
  for (const opacity of [-0.1, 1.1, null, "1"]) {
    assert.equal(UINodeSchema.safeParse({ ...valid.root, style: { ...valid.root.style, opacity } }).success, false);
  }
  for (const opacity of [0, 1]) {
    assert.equal(UINodeSchema.safeParse({ ...valid.root, style: { ...valid.root.style, opacity } }).success, true);
  }
});

test("recursive descendants parse and invalid grandchildren cannot bypass validation", () => {
  const parsed = UISchemaSchema.parse(validFixture);
  assert.equal(parsed.root.children[1]?.children[0]?.type, "IMAGE");
  assert.deepEqual(parsed.root.children[1]?.children[0]?.children, []);
  const nested = parsed.root.children[1]?.children[0];
  assert.ok(nested);
  nested.bounds.width = -1;
  assert.equal(UISchemaSchema.safeParse(parsed).success, false);
});

test("every node field is required and leaves still need a children array", () => {
  for (const key of Object.keys(valid.root)) {
    const missing: Record<string, unknown> = { ...valid.root };
    delete missing[key];
    assert.equal(UINodeSchema.safeParse(missing).success, false, key);
  }
  assert.equal(UINodeSchema.safeParse({ ...valid.root, children: null }).success, false);
  for (const id of ["", "   "]) assert.equal(UINodeSchema.safeParse({ ...valid.root, id }).success, false);
});

test("layout rejects arbitrary CSS and invalid structural values", () => {
  for (const patch of [
    { mode: "display:flex" }, { direction: "row" }, { justify: "AROUND" }, { align: "BASELINE" },
    { gap: -1 }, { columns: 0 }, { columns: 1.5 },
    { padding: { top: -1, right: 0, bottom: 0, left: 0 } },
  ]) assert.equal(UINodeSchema.safeParse({ ...valid.root, layout: { ...valid.root.layout, ...patch } }).success, false);
  assert.equal(UINodeSchema.safeParse({ ...valid.root, layout: "display: flex" }).success, false);
});

test("design tokens use arrays and non-negative spacing and radii", () => {
  for (const patch of [
    { colors: { background: "#ffffff" } }, { spacing: [-1] }, { radii: [-1] }, { shadows: [] },
    { typography: [{ ...valid.designTokens.typography[0], fontSize: 0 }] },
  ]) assert.equal(UISchemaSchema.safeParse({ ...valid, designTokens: { ...valid.designTokens, ...patch } }).success, false);
});

test("uncertain typography can be null and letter spacing may be negative", () => {
  const text = { content: "", fontFamily: null, fontSize: null, fontWeight: null, lineHeight: null, letterSpacing: -0.5, textAlign: "START" };
  assert.equal(UINodeSchema.safeParse({ ...valid.root, text }).success, true);
  for (const patch of [{ fontSize: 0 }, { fontWeight: 0 }, { fontWeight: 1001 }, { lineHeight: -1 }, { textAlign: "LEFT" }]) {
    assert.equal(UINodeSchema.safeParse({ ...valid.root, text: { ...text, ...patch } }).success, false);
  }
});

test("structured borders and shadows reject invalid dimensions and CSS strings", () => {
  for (const patch of [
    { radius: -1 }, { border: { width: -1, color: "#000" } }, { shadow: "0 2px 4px black" },
    { shadow: { x: 0, y: 1, blur: -1, spread: 0, color: "#000" } },
    { background: "url(https://example.com/image.png)" }, { css: "position: absolute" },
  ]) assert.equal(UINodeSchema.safeParse({ ...valid.root, style: { ...valid.root.style, ...patch } }).success, false);
  assert.equal(UINodeSchema.safeParse({ ...valid.root, style: { ...valid.root.style,
    shadow: { x: -1, y: -2, blur: 4, spread: -1, color: "#0008" },
  } }).success, true);
});

test("image data has only a description and a known fit, never asset fields", () => {
  for (const patch of [{ fit: "SCALE" }, { url: "https://example.com/a.png" }, { path: "/tmp/a.png" }, { base64: "abc" }]) {
    assert.equal(UINodeSchema.safeParse({ ...valid.root, image: { description: "A square.", fit: "CONTAIN", ...patch } }).success, false);
  }
});

test("non-finite numeric values and unexpected root fields are rejected", () => {
  for (const confidence of [NaN, Infinity, -Infinity]) {
    assert.equal(UISchemaSchema.safeParse({ ...valid, confidence }).success, false);
  }
  assert.equal(UISchemaSchema.safeParse({ ...valid, sourceCode: "<div />" }).success, false);
  assert.equal(UISchemaSchema.safeParse({ ...valid, warnings: [123] }).success, false);
});
