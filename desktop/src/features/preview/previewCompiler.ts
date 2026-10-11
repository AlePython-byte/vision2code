import { transform } from "sucrase";
import type { PreviewProject } from "./previewTypes.ts";
import { normalizeModulePath } from "./previewResolver.ts";
import { PREVIEW_ENTRY_PATH } from "./previewTypes.ts";

export class PreviewCompileError extends Error {
  readonly filePath: string;
  constructor(message: string, filePath: string) {
    super(message);
    this.name = "PreviewCompileError";
    this.filePath = filePath;
  }
}

export interface CompiledProjectArtifact {
  readonly script: string;
  readonly fileCount: number;
}

/**
 * Compiles a PreviewProject's TypeScript/TSX files into modular executable JavaScript.
 *
 * Compilation happens outside the preview iframe.
 * The resulting script is wrapped in sandboxed module definitions,
 * ready to be executed exclusively inside the sandboxed iframe.
 */
export function compilePreviewProject(project: PreviewProject): CompiledProjectArtifact {
  const moduleBlocks: string[] = [];

  for (const file of project.files) {
    const canonicalPath = normalizeModulePath(file.path);
    try {
      const transformed = transform(file.content, {
        transforms: ["typescript", "jsx", "imports"],
        jsxRuntime: "classic",
        filePath: canonicalPath,
        production: true,
      });

      // Wrap in isolated module definition
      moduleBlocks.push(
        `window.__defineModule__(${JSON.stringify(canonicalPath)}, function(exports, require) {\n${transformed.code}\n});`
      );
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : String(err);
      // Sanitize any system paths from compiler error messages
      const sanitized = rawMessage.replace(/[A-Za-z]:\\[^:\n]+/g, canonicalPath).replace(/\/[^:\n]+/g, canonicalPath);
      throw new PreviewCompileError(`Error de sintaxis en ${canonicalPath}: ${sanitized}`, canonicalPath);
    }
  }

  // Final trigger to mount the App component
  moduleBlocks.push(`window.__mountApp__(${JSON.stringify(normalizeModulePath(PREVIEW_ENTRY_PATH))});`);

  return {
    script: moduleBlocks.join("\n\n"),
    fileCount: project.files.length,
  };
}

