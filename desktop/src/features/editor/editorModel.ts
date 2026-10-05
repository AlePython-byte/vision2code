import type { GeneratedProject, GeneratedFile } from "../generation/generatedProject.ts";

export function editorLanguage(language: string): string {
  switch (language.toLowerCase()) {
    case "typescript": case "typescriptreact": case "tsx": return "typescript";
    case "javascript": case "javascriptreact": case "jsx": return "javascript";
    case "css": case "html": case "json": return language.toLowerCase();
    default: return "plaintext";
  }
}
export interface EditorState {
  project: GeneratedProject | null;
  files: GeneratedFile[];
  activePath: string | null;
  drafts: ReadonlyMap<string, string>;
  feedback: string;
}
export function activeFile(state: EditorState) {
  const file = state.files.find((item) => item.path === state.activePath);
  return file ? { ...file, content: state.drafts.get(file.path) ?? file.content, language: editorLanguage(file.language) } : null;
}
export function editorEmptyMessage(state: EditorState): string | null {
  if (!state.project) return "Todavía no hay código generado. Analiza una captura para empezar.";
  if (!state.files.length) return "Este proyecto no contiene archivos.";
  if (!activeFile(state)) return "Selecciona un archivo para ver su código.";
  return null;
}
export function createEditorModel() {
  let state: EditorState = { project: null, files: [], activePath: null, drafts: new Map(), feedback: "" };
  let revision = 0;
  const listeners = new Set<() => void>();
  function update(next: EditorState) { state = next; listeners.forEach((listener) => listener()); }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setProject(project: GeneratedProject | null) {
      revision++;
      const original = project ? { ...project, files: project.files.map((file) => ({ ...file })) } : null;
      const files = [...original?.files ?? []].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const preferred = files.find((file) => file.path === "src/generated/GeneratedInterface.tsx");
      update({ project: original, files, activePath: preferred?.path ?? original?.files[0]?.path ?? null, drafts: new Map(), feedback: "" });
    },
    select(path: string) {
      revision++;
      update({ ...state, activePath: path, feedback: "" });
    },
    edit(content: string) {
      if (!activeFile(state)) return;
      revision++;
      const drafts = new Map(state.drafts);
      drafts.set(state.activePath!, content);
      update({ ...state, drafts, feedback: "" });
    },
    reset() {
      revision++;
      update({ ...state, drafts: new Map(), feedback: "Se restauró el código original del proyecto." });
    },
    async copy(writeText: (text: string) => Promise<void>) {
      const file = activeFile(state);
      if (!file) return;
      const started = ++revision;
      try {
        await writeText(file.content);
        if (started === revision) update({ ...state, feedback: "Código copiado." });
      } catch {
        if (started === revision) update({ ...state, feedback: "No se pudo copiar el código. Inténtalo de nuevo." });
      }
    },
  };
}
export type EditorModel = ReturnType<typeof createEditorModel>;
