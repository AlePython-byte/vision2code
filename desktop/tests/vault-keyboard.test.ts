import assert from "node:assert/strict";
import test from "node:test";
import { handleVaultDialogKey, isVaultSearchShortcut } from "../src/features/projects/vaultKeyboard.ts";

test("Ctrl+K and Cmd+K are search shortcuts; unrelated keys are not", () => {
  const event = (key: string, ctrlKey = false, metaKey = false, altKey = false) => ({ key, ctrlKey, metaKey, altKey });
  assert.equal(isVaultSearchShortcut(event("k", true)), true);
  assert.equal(isVaultSearchShortcut(event("K", false, true)), true);
  assert.equal(isVaultSearchShortcut(event("k", false, false)), false);
  assert.equal(isVaultSearchShortcut(event("k", true, false, true)), false);
  assert.equal(isVaultSearchShortcut(event("x", true)), false);
});

test("dialog Escape closes except while saving; Tab and Shift+Tab remain inside", () => {
  let closed = 0;
  let prevented = 0;
  let focused = "";
  const first = { focus: () => { focused = "first"; } };
  const last = { focus: () => { focused = "last"; } };
  const key = (value: string, shiftKey = false) => ({ key: value, shiftKey, preventDefault: () => { prevented++; } });
  handleVaultDialogKey(key("Escape"), true, [first, last], first, () => { closed++; });
  assert.equal(closed, 0);
  handleVaultDialogKey(key("Escape"), false, [first, last], first, () => { closed++; });
  assert.equal(closed, 1);
  handleVaultDialogKey(key("Tab"), false, [first, last], last, () => { closed++; });
  assert.equal(focused, "first");
  handleVaultDialogKey(key("Tab", true), false, [first, last], first, () => { closed++; });
  assert.equal(focused, "last");
  assert.equal(prevented, 3);
});
