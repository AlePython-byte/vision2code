import type { GeneratedProject } from "../generation/generatedProject.ts";
import type { EditorState } from "../editor/editorModel.ts";

/**
 * Builds a preview input from an editor snapshot, overlaying unsaved drafts.
 * Pure: never mutates the editor state, its project or its drafts.
 * Not wired to live edits yet; reserved for the next checkpoint.
 */
export function projectFromEditorState(state: EditorState): GeneratedProject | null {
  if (!state.project) return null;
  return {
    target: state.project.target,
    generatorVersion: state.project.generatorVersion,
    files: state.files.map((file) => ({ ...file, content: state.drafts.get(file.path) ?? file.content })),
  };
}

