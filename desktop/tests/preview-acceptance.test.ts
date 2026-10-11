import assert from "node:assert/strict";
import test from "node:test";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import { createLocalIsolatedPreviewEngine } from "../src/features/preview/previewEngine.ts";
import { projectFromEditorState } from "../src/features/preview/previewInput.ts";
import { createPreviewPresentation } from "../src/features/preview/previewPresentation.ts";
import { syncEditorToPreview, DEFAULT_PREVIEW_SYNC_DEBOUNCE_MS, type DebounceScheduler } from "../src/features/preview/previewSync.ts";
import { PREVIEW_IFRAME_CSP, PREVIEW_SANDBOX } from "../src/features/preview/previewDocument.ts";
import { preferences } from "../src/features/preferences/preferences.ts";
import type { GeneratedProject } from "../src/features/generation/generatedProject.ts";
import type { PreviewEngine } from "../src/features/preview/previewTypes.ts";

const INTERFACE_PATH = "src/generated/GeneratedInterface.tsx";

function generatedProject(): GeneratedProject {
  return {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      {
        path: "src/App.tsx",
        language: "typescript",
        content: `import GeneratedInterface from "./generated/GeneratedInterface";\nexport default function App() { return <GeneratedInterface />; }`,
      },
      {
        path: INTERFACE_PATH,
        language: "typescript",
        content: `export default function GeneratedInterface() { return <div data-node-id="root" className="box-border min-w-0 [max-width:1440px] [min-height:1024px] [background-color:#ffffff]"><span>Original Content</span></div>; }`,
      },
    ],
  };
}

/** Deterministic debounce clock: timers only fire when the test advances them. */
function manualClock() {
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const scheduler: DebounceScheduler = {
    setTimeout(callback, delay) { const id = nextId++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id as number); },
  };
  return {
    scheduler,
    get pending() { return timers.size; },
    get delays() { return [...timers.values()].map((timer) => timer.delay); },
    advance() { const due = [...timers.values()]; timers.clear(); due.forEach((timer) => timer.callback()); },
  };
}

async function until(condition: () => boolean, label: string) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

test("TASK 007 acceptance: generated project -> live edits -> error -> recovery -> presentation -> refresh", async () => {
  // The real engine is wrapped only to count compilations; behavior is untouched.
  const realEngine = createLocalIsolatedPreviewEngine();
  let compilations = 0;
  const engine: PreviewEngine = {
    kind: realEngine.kind,
    render(project, signal) { compilations++; return realEngine.render(project, signal); },
  };

  const original = generatedProject();
  const originalJson = JSON.stringify(original);

  const editorModel = createEditorModel();
  const previewModel = createPreviewModel(engine);
  const clock = manualClock();
  const sync = syncEditorToPreview(editorModel, previewModel, { scheduler: clock.scheduler });
  const presentation = createPreviewPresentation();

  try {
    // 1. GeneratedProject -> Preview SUCCESS (immediate, no debounce for project replacement)
    editorModel.setProject(original);
    await until(() => previewModel.getSnapshot().status === "SUCCESS", "initial SUCCESS");
    assert.equal(compilations, 1);
    assert.match(previewModel.getSnapshot().documentHtml ?? "", /Original Content/);
    assert.equal(clock.pending, 0);

    // 2. Selecting a file without editing never compiles.
    editorModel.select(INTERFACE_PATH);
    assert.equal(clock.pending, 0);
    assert.equal(compilations, 1);

    // 3. Burst of edits -> one restrained debounce timer -> a single compilation
    editorModel.edit(original.files[1]!.content.replace("Original Content", "Edit 1"));
    editorModel.edit(original.files[1]!.content.replace("Original Content", "Edit 2"));
    editorModel.edit(original.files[1]!.content.replace("Original Content", "Edited Content"));
    assert.equal(clock.pending, 1);
    assert.deepEqual(clock.delays, [DEFAULT_PREVIEW_SYNC_DEBOUNCE_MS]);
    assert.equal(compilations, 1, "typing alone must not compile");
    assert.match(previewModel.getSnapshot().documentHtml ?? "", /Original Content/, "previous preview stays until debounce fires");
    clock.advance();
    await until(() => /Edited Content/.test(previewModel.getSnapshot().documentHtml ?? ""), "debounced update");
    assert.equal(previewModel.getSnapshot().status, "SUCCESS");
    assert.equal(compilations, 2);

    // 4. Invalid TSX -> Preview ERROR, draft preserved, host still alive
    const broken = `export default function GeneratedInterface() { return <div><span>unclosed; }`;
    editorModel.edit(broken);
    clock.advance();
    await until(() => previewModel.getSnapshot().status === "ERROR", "ERROR on invalid TSX");
    assert.equal(previewModel.getSnapshot().error, "ENGINE_FAILURE");
    assert.equal(editorModel.getSnapshot().drafts.get(INTERFACE_PATH), broken, "Monaco draft is preserved");
    assert.doesNotMatch(JSON.stringify(previewModel.getSnapshot()), /Unexpected token|Sucrase|[A-Za-z]:\\\\/);

    // 5. Syntax corrected -> automatic recovery to SUCCESS
    editorModel.edit(original.files[1]!.content.replace("Original Content", "Fixed Content"));
    clock.advance();
    await until(() => previewModel.getSnapshot().status === "SUCCESS", "recovery to SUCCESS");
    assert.match(previewModel.getSnapshot().documentHtml ?? "", /Fixed Content/);

    // 6. Presentation changes are free: no compile, no timers, no model transitions, no preview revision
    const compilationsBefore = compilations;
    const revisionBefore = previewModel.getSnapshot().revision;
    presentation.setPreset("tablet");
    presentation.setPreset("mobile");
    presentation.setZoomMode("50");
    presentation.setZoomMode("100");
    presentation.setZoomMode("fit");
    presentation.setPreset("desktop");
    preferences.set({ theme: "dark", language: "en" });
    preferences.set({ theme: "light", language: "es" });
    assert.equal(compilations, compilationsBefore);
    assert.equal(previewModel.getSnapshot().revision, revisionBefore);
    assert.equal(clock.pending, 0);

    // 7. Manual refresh compiles immediately from the editor snapshot (same path as the Refresh button)
    editorModel.edit(original.files[1]!.content.replace("Original Content", "Refreshed Content"));
    assert.equal(clock.pending, 1);
    const draftProject = projectFromEditorState(editorModel.getSnapshot());
    assert.ok(draftProject);
    previewModel.setProject(draftProject);
    await previewModel.render();
    assert.equal(previewModel.getSnapshot().status, "SUCCESS");
    assert.match(previewModel.getSnapshot().documentHtml ?? "", /Refreshed Content/);
    assert.equal(compilations, compilationsBefore + 1);
    clock.advance(); // the pending debounce still resolves harmlessly to the same content
    await sync.flush();
    await until(() => previewModel.getSnapshot().status === "SUCCESS", "settled after pending debounce");

    // 8. Security invariants hold in the final document
    const finalDocument = previewModel.getSnapshot().documentHtml ?? "";
    assert.equal(PREVIEW_SANDBOX, "allow-scripts");
    assert.match(finalDocument, new RegExp(`content="${PREVIEW_IFRAME_CSP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    assert.doesNotMatch(finalDocument, /https?:\/\/|__TAURI__|allow-same-origin/i);

    // 9. The original GeneratedProject was never mutated
    assert.equal(JSON.stringify(original), originalJson);
    assert.equal(editorModel.getSnapshot().project?.files[1]?.content, original.files[1]?.content);
    editorModel.reset();
    assert.equal(editorModel.getSnapshot().drafts.size, 0);
    await until(() => /Original Content/.test(previewModel.getSnapshot().documentHtml ?? ""), "reset restores original preview");
    assert.equal(JSON.stringify(original), originalJson);
  } finally {
    sync.dispose();
    previewModel.dispose();
    preferences.set({ theme: "light", language: "es" });
  }
});

test("TASK 007 acceptance: a newer manual refresh cancels a stale in-flight render", async () => {
  const signals: AbortSignal[] = [];
  const releases: Array<() => void> = [];
  const engine: PreviewEngine = {
    kind: "local-isolated",
    render(_project, signal) {
      signals.push(signal);
      return new Promise((resolve) => releases.push(() => resolve({ documentHtml: `<html>${signals.length}</html>` })));
    },
  };
  const model = createPreviewModel(engine);
  model.setProject(generatedProject());
  const stale = model.render();
  const fresh = model.render();
  assert.equal(signals[0]?.aborted, true, "the stale render is aborted");
  assert.equal(signals[1]?.aborted, false);
  releases[0]?.();
  await stale;
  assert.equal(model.getSnapshot().status, "RENDERING", "a late stale result cannot win");
  releases[1]?.();
  await fresh;
  assert.equal(model.getSnapshot().status, "SUCCESS");
  assert.equal(model.getSnapshot().documentHtml, "<html>2</html>");
});

