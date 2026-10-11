import { PREVIEW_ENTRY_PATH, type PreviewEngine } from "./previewTypes.ts";
import { compilePreviewProject } from "./previewCompiler.ts";
import { generatePreviewCss } from "./previewStyles.ts";
import { buildPreviewDocument, PREVIEW_PLACEHOLDER_DOCUMENT } from "./previewDocument.ts";
import { normalizeModulePath } from "./previewResolver.ts";

/**
 * Placeholder engine: validates nothing, executes nothing, performs no I/O.
 * Retained for backwards-compatibility, testing, and isolated validation.
 */
export function createPlaceholderPreviewEngine(): PreviewEngine {
  return {
    kind: "placeholder",
    async render(_project, signal) {
      signal.throwIfAborted();
      return { documentHtml: PREVIEW_PLACEHOLDER_DOCUMENT };
    },
  };
}

/**
 * Real local isolated preview engine (Task 007B):
 * 1. Validates entry point (src/App.tsx).
 * 2. Compiles TSX components to modular JavaScript outside the iframe.
 * 3. Extracts and generates deterministic Tailwind utility CSS.
 * 4. Assembles a self-contained, offline HTML document with strict CSP and micro React DOM runtime.
 * 5. Yields the document for execution strictly inside the sandboxed iframe.
 */
export function createLocalIsolatedPreviewEngine(): PreviewEngine {
  return {
    kind: "local-isolated",
    async render(project, signal) {
      signal.throwIfAborted();

      const canonicalEntry = normalizeModulePath(PREVIEW_ENTRY_PATH);
      const hasEntry = project.files.some((file) => {
        try {
          return normalizeModulePath(file.path) === canonicalEntry;
        } catch {
          return false;
        }
      });
      if (!hasEntry) {
        throw new Error("Missing entry file " + PREVIEW_ENTRY_PATH);
      }

      // Compiles project source files into modular JS (throws PreviewCompileError on syntax error)
      const compiled = compilePreviewProject(project);
      signal.throwIfAborted();

      // Generates local deterministic CSS rules for the exact classes used
      const css = generatePreviewCss(project.files.map((file) => file.content));
      signal.throwIfAborted();

      // Builds the fully offline preview document
      const documentHtml = buildPreviewDocument({
        css,
        script: compiled.script,
      });

      return { documentHtml };
    },
  };
}
