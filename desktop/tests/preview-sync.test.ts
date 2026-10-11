import assert from "node:assert/strict";
import test from "node:test";
import { createEditorModel } from "../src/features/editor/editorModel.ts";
import { createPreviewModel } from "../src/features/preview/previewModel.ts";
import {
  syncEditorToPreview,
  DEFAULT_PREVIEW_SYNC_DEBOUNCE_MS,
  type DebounceScheduler,
} from "../src/features/preview/previewSync.ts";
import { createLocalIsolatedPreviewEngine } from "../src/features/preview/previewEngine.ts";
import type { GeneratedProject } from "../src/features/generation/generatedProject.ts";

function createMockScheduler() {
  let nextId = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const scheduler: DebounceScheduler = {
    setTimeout(callback: () => void, delay: number) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id: unknown) {
      timers.delete(id as number);
    },
  };
  return {
    scheduler,
    get pendingCount() {
      return timers.size;
    },
    runAll() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, timer] of pending) {
        timer.callback();
      }
    },
  };
}

function sampleProject(): GeneratedProject {
  return {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      {
        path: "src/App.tsx",
        language: "typescript",
        content: `import GeneratedInterface from "./generated/GeneratedInterface";
export default function App() {
  return <GeneratedInterface />;
}`,
      },
      {
        path: "src/generated/GeneratedInterface.tsx",
        language: "typescript",
        content: `export default function GeneratedInterface() {
  return <div data-node-id="root" className="box-border min-w-0 [max-width:1440px] [min-height:1024px] [background-color:#ffffff]"><span>Original Content</span></div>;
}`,
      },
    ],
  };
}

test("sync: debounce duration defaults to restrained ~400ms", () => {
  assert.equal(DEFAULT_PREVIEW_SYNC_DEBOUNCE_MS, 400);
});

test("sync: editor modification schedules preview update", () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const { scheduler, pendingCount } = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler, immediateInitial: false });

  assert.equal(pendingCount, 0);
  assert.equal(sync.isPending(), false);

  editor.select("src/App.tsx");
  editor.edit("export default function App() { return <h1>Modified</h1>; }");

  assert.equal(sync.isPending(), true);
  sync.dispose();
});

test("sync: multiple edits inside debounce window result in only one scheduled compilation", async () => {
  const editor = createEditorModel();
  let renderCallCount = 0;
  const customEngine = {
    kind: "local-isolated" as const,
    async render(proj: any, sig: any) {
      renderCallCount++;
      return createLocalIsolatedPreviewEngine().render(proj, sig);
    },
  };
  const preview = createPreviewModel(customEngine);
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  editor.select("src/App.tsx");
  editor.edit("export default function App() { return <div>a</div>; }");
  editor.edit("export default function App() { return <div>ab</div>; }");
  editor.edit("export default function App() { return <div>abc</div>; }");
  editor.edit("export default function App() { return <div>abcd</div>; }");

  assert.equal(mock.pendingCount, 1);
  assert.equal(renderCallCount, 0);

  // Trigger debounce expiration
  mock.runAll();

  // Wait for render to settle
  assert.equal(renderCallCount, 1);
  assert.match(preview.getSnapshot().project!.files[0]!.content, /abcd/);
  sync.dispose();
});

test("sync: editing src/App.tsx updates preview project", async () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  editor.select("src/App.tsx");
  editor.edit("export default function App() { return <p>Updated App</p>; }");
  mock.runAll();

  await preview.render();
  const previewProj = preview.getSnapshot().project!;
  const appFile = previewProj.files.find((f) => f.path === "src/App.tsx");
  assert.ok(appFile);
  assert.match(appFile.content, /Updated App/);
  sync.dispose();
});

test("sync: editing GeneratedInterface.tsx updates preview project", async () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  editor.select("src/generated/GeneratedInterface.tsx");
  editor.edit("export default function GeneratedInterface() { return <span>Nuevo diseño</span>; }");
  mock.runAll();

  await preview.render();
  const previewProj = preview.getSnapshot().project!;
  const interfaceFile = previewProj.files.find((f) => f.path === "src/generated/GeneratedInterface.tsx");
  assert.ok(interfaceFile);
  assert.match(interfaceFile.content, /Nuevo dise[nñ]o/);
  sync.dispose();
});

test("sync: switching active file without editing does NOT compile", () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  assert.equal(sync.isPending(), false);
  editor.select("src/App.tsx");
  assert.equal(sync.isPending(), false);
  editor.select("src/generated/GeneratedInterface.tsx");
  assert.equal(sync.isPending(), false);
  assert.equal(mock.pendingCount, 0);

  sync.dispose();
});

test("sync: project replacement cancels pending debounce and renders new project immediately", () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  const project1 = sampleProject();
  editor.setProject(project1);

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  // User was typing in project 1
  editor.select("src/App.tsx");
  editor.edit("unfinished draft...");
  assert.equal(sync.isPending(), true);

  // New project replaces current
  const project2: GeneratedProject = {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      {
        path: "src/App.tsx",
        language: "typescript",
        content: "export default function App() { return <div>Brand New Project</div>; }",
      },
    ],
  };
  editor.setProject(project2);

  // Pending debounce must be cancelled immediately
  assert.equal(sync.isPending(), false);
  assert.equal(mock.pendingCount, 0);

  // Preview must reflect project 2
  assert.match(preview.getSnapshot().project!.files[0]!.content, /Brand New Project/);
  sync.dispose();
});

test("sync: reset restores original source and immediately updates preview", () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  editor.select("src/App.tsx");
  editor.edit("export default function App() { return <h1>Modified Text</h1>; }");
  mock.runAll();

  assert.match(preview.getSnapshot().project!.files[0]!.content, /Modified Text/);

  // User clicks "Restore project"
  editor.reset();

  // Reset triggers immediately without debounce delay
  assert.equal(sync.isPending(), false);
  assert.match(preview.getSnapshot().project!.files[0]!.content, /GeneratedInterface/);
  assert.doesNotMatch(preview.getSnapshot().project!.files[0]!.content, /Modified Text/);
  sync.dispose();
});

test("sync: invalid TSX leads to Preview ERROR without crashing host", async () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  // Type broken TSX syntax (unclosed tag)
  editor.select("src/App.tsx");
  editor.edit("export default function App() { return <div>Broken; }");
  mock.runAll();

  // Wait for render attempt to settle
  await preview.render();

  const state = preview.getSnapshot();
  assert.equal(state.status, "ERROR");
  assert.equal(state.error, "ENGINE_FAILURE");

  // Editor draft must survive compile failure
  assert.equal(editor.getSnapshot().drafts.get("src/App.tsx"), "export default function App() { return <div>Broken; }");

  sync.dispose();
});

test("sync: correcting invalid TSX recovers preview to SUCCESS", async () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  // 1. Broken syntax
  editor.select("src/App.tsx");
  editor.edit("export default function App() { return <div>Broken; }");
  mock.runAll();
  await preview.render();
  assert.equal(preview.getSnapshot().status, "ERROR");

  // 2. Fix syntax
  editor.edit("export default function App() { return <div>Fixed!</div>; }");
  mock.runAll();
  await preview.render();

  assert.equal(preview.getSnapshot().status, "SUCCESS");
  assert.equal(preview.getSnapshot().error, null);
  assert.ok(preview.getSnapshot().documentHtml);

  sync.dispose();
});

test("sync: stale preview render cannot overwrite newer edit", async () => {
  let resolveFirst: (() => void) | null = null;
  const customEngine = {
    kind: "local-isolated" as const,
    async render(proj: any, signal: AbortSignal) {
      if (proj.files[0].content.includes("First")) {
        await new Promise<void>((r) => { resolveFirst = r; });
      }
      signal.throwIfAborted();
      return createLocalIsolatedPreviewEngine().render(proj, signal);
    },
  };

  const editor = createEditorModel();
  const preview = createPreviewModel(customEngine);
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  // Edit 1
  editor.select("src/App.tsx");
  editor.edit("export default function App() { return <div>First</div>; }");
  mock.runAll();

  // Edit 2 happens while Edit 1 is in-flight
  editor.edit("export default function App() { return <div>Second</div>; }");
  mock.runAll();

  // Now resolve Edit 1 late
  if (resolveFirst) (resolveFirst as () => void)();

  // Wait for preview to settle
  await preview.render();

  // The latest state must be Second, not First
  assert.match(preview.getSnapshot().project!.files[0]!.content, /Second/);
  sync.dispose();
});

test("sync: disposing sync layer cancels timers and unregisters subscriptions", () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  editor.select("src/App.tsx");
  editor.edit("in-flight edit");
  assert.equal(sync.isPending(), true);

  // Dispose
  sync.dispose();
  assert.equal(sync.isPending(), false);
  assert.equal(mock.pendingCount, 0);

  // Subsequent edit after disposal should not register timers
  editor.edit("post disposal edit");
  assert.equal(sync.isPending(), false);
  assert.equal(mock.pendingCount, 0);
});

test("sync: flush immediately executes pending compilation without waiting", async () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  editor.select("src/App.tsx");
  editor.edit("export default function App() { return <div>Flushed</div>; }");
  assert.equal(sync.isPending(), true);

  await sync.flush();
  assert.equal(sync.isPending(), false);
  assert.match(preview.getSnapshot().project!.files[0]!.content, /Flushed/);
  sync.dispose();
});

test("sync: GeneratedProject originals remain immutable after edits", () => {
  const original = sampleProject();
  const originalContent = original.files[0]!.content;

  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(original);

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  editor.select("src/App.tsx");
  editor.edit("radical new code");
  mock.runAll();

  // Original project file object was never mutated
  assert.equal(original.files[0]!.content, originalContent);
  sync.dispose();
});

test("sync: Monaco copy behavior remains unchanged and does not trigger recompilation", async () => {
  const editor = createEditorModel();
  const preview = createPreviewModel();
  editor.setProject(sampleProject());

  const mock = createMockScheduler();
  const sync = syncEditorToPreview(editor, preview, { scheduler: mock.scheduler, immediateInitial: false });

  let copiedText = "";
  await editor.copy(async (text) => { copiedText = text; });

  assert.ok(copiedText.length > 0);
  assert.equal(editor.getSnapshot().feedback, "Código copiado.");
  assert.equal(sync.isPending(), false);
  assert.equal(mock.pendingCount, 0);

  sync.dispose();
});

