import assert from "node:assert/strict";
import test from "node:test";
import { OutputStackSchema } from "../src/index.ts";

test("only the supported output stacks are accepted", () => {
  assert.deepEqual(OutputStackSchema.options, ["REACT_TAILWIND", "HTML_CSS"]);
  assert.equal(OutputStackSchema.parse("REACT_TAILWIND"), "REACT_TAILWIND");
  assert.equal(OutputStackSchema.parse("HTML_CSS"), "HTML_CSS");
  for (const value of ["VUE", "", null, 1, { stack: "HTML_CSS" }]) {
    assert.equal(OutputStackSchema.safeParse(value).success, false);
  }
});
