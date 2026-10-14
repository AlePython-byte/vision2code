import assert from "node:assert/strict";
import test from "node:test";
import { createToastModel, MAX_VISIBLE_TOASTS, type ToastInput } from "../src/features/feedback/toastModel.ts";
import { fakeScheduler } from "./fake-scheduler.ts";

const transient = (key: string, durationMs = 1000): ToastInput => ({ key, tone: "success", eyebrow: "e", message: "m", persistent: false, durationMs });
const persistent = (key: string): ToastInput => ({ key, tone: "error", eyebrow: "e", message: "m", persistent: true });
const keys = (model: ReturnType<typeof createToastModel>) => model.getSnapshot().toasts.map((toast) => toast.key);

test("show adds a dismissible toast and notifies subscribers", () => {
  const model = createToastModel(fakeScheduler());
  let notified = 0;
  model.subscribe(() => { notified++; });
  const id = model.show(transient("a"));
  const [toast] = model.getSnapshot().toasts;
  assert.equal(toast!.id, id);
  assert.equal(toast!.dismissible, true);
  assert.equal(notified, 1);
});

test("showing an existing key replaces it in the same slot, without stacking", () => {
  const model = createToastModel(fakeScheduler());
  model.show(transient("a"));
  const id = model.show(persistent("save"));
  model.show(transient("b"));
  const replacedId = model.show({ ...transient("save"), tone: "success", message: "saved" });
  assert.equal(replacedId, id);
  assert.deepEqual(keys(model), ["a", "save", "b"]);
  assert.equal(model.getSnapshot().toasts[1]!.message, "saved");
  assert.equal(model.getSnapshot().toasts[1]!.persistent, false);
});

test("at most three visible: the oldest transient toast is evicted first", () => {
  const model = createToastModel(fakeScheduler());
  model.show(persistent("p1"));
  model.show(transient("t1"));
  model.show(transient("t2"));
  model.show(transient("t3"));
  assert.equal(model.getSnapshot().toasts.length, MAX_VISIBLE_TOASTS);
  assert.deepEqual(keys(model), ["p1", "t2", "t3"]);
});

test("a persistent error is never evicted to make room for a transient toast", () => {
  const model = createToastModel(fakeScheduler());
  model.show(persistent("p1"));
  model.show(persistent("p2"));
  model.show(persistent("p3"));
  assert.equal(model.show(transient("t1")), null);
  assert.deepEqual(keys(model), ["p1", "p2", "p3"]);
  model.show(persistent("p4"));
  assert.deepEqual(keys(model), ["p2", "p3", "p4"], "a persistent toast may replace the oldest persistent one");
});

test("transient toasts auto-dismiss exactly at their duration; persistent ones never do", () => {
  const clock = fakeScheduler();
  const model = createToastModel(clock);
  model.show(transient("a", 2500));
  model.show(persistent("p"));
  clock.advance(2499);
  assert.deepEqual(keys(model), ["a", "p"]);
  clock.advance(1);
  assert.deepEqual(keys(model), ["p"]);
  clock.advance(60_000);
  assert.deepEqual(keys(model), ["p"]);
  assert.equal(clock.pending(), 0);
});

test("replacing a toast restarts its timer with the new duration", () => {
  const clock = fakeScheduler();
  const model = createToastModel(clock);
  model.show(transient("a", 1000));
  clock.advance(900);
  model.show(transient("a", 1000));
  clock.advance(900);
  assert.deepEqual(keys(model), ["a"]);
  clock.advance(100);
  assert.deepEqual(keys(model), []);
  model.show(transient("b", 1000));
  model.show(persistent("b"));
  clock.advance(5000);
  assert.deepEqual(keys(model), ["b"], "transient → persistent cancels the auto-dismiss");
});

test("pause freezes the remaining time and resume restarts it", () => {
  const clock = fakeScheduler();
  const model = createToastModel(clock);
  const id = model.show(transient("a", 1000))!;
  clock.advance(400);
  model.pause(id);
  clock.advance(10_000);
  assert.deepEqual(keys(model), ["a"]);
  model.resume(id);
  clock.advance(599);
  assert.deepEqual(keys(model), ["a"]);
  clock.advance(1);
  assert.deepEqual(keys(model), []);
});

test("a paused toast stays paused when replaced in place", () => {
  const clock = fakeScheduler();
  const model = createToastModel(clock);
  const id = model.show(transient("a", 1000))!;
  model.pause(id);
  model.show(transient("a", 500));
  clock.advance(5000);
  assert.deepEqual(keys(model), ["a"]);
  model.resume(id);
  clock.advance(500);
  assert.deepEqual(keys(model), []);
});

test("dismiss and dismissByKey remove toasts and their timers", () => {
  const clock = fakeScheduler();
  const model = createToastModel(clock);
  const id = model.show(transient("a"))!;
  model.show(transient("b"));
  model.dismiss(id);
  model.dismissByKey("b");
  model.dismissByKey("missing");
  assert.deepEqual(keys(model), []);
  assert.equal(clock.pending(), 0);
});

test("clear and dispose leave no pending timers", () => {
  const clock = fakeScheduler();
  const model = createToastModel(clock);
  model.show(transient("a"));
  model.show(transient("b"));
  model.show(persistent("c"));
  assert.equal(clock.pending(), 2);
  model.clear();
  assert.deepEqual(keys(model), []);
  assert.equal(clock.pending(), 0);
  model.show(transient("d"));
  model.dispose();
  assert.equal(clock.pending(), 0);
});
