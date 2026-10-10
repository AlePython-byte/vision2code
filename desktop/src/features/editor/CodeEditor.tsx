import { useSyncExternalStore } from "react";
import { preferences } from "../preferences/preferences";
import { useLabels } from "../preferences/useLabels";
import "monaco-editor/nls/lang/es.js";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";

// ESM workers and editor assets are bundled by Vite; never use the loader's CDN.
self.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    switch (label) {
      case "typescript": case "javascript": return new TypeScriptWorker();
      case "css": case "scss": case "less": return new CssWorker();
      case "html": case "handlebars": case "razor": return new HtmlWorker();
      case "json": return new JsonWorker();
      default: return new EditorWorker();
    }
  },
};
loader.config({ monaco });
// This source viewer has no installed project typings or compiler environment.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true });
  defaults.setCompilerOptions({ jsx: monaco.typescript.JsxEmit.ReactJSX, allowNonTsExtensions: true });
}
monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: false, enableSchemaRequest: false });
monaco.css.cssDefaults.setDiagnosticsOptions({ validate: false });

export default function CodeEditor({ path, content, language, onChange }: {
  path: string; content: string; language: string; onChange: (content: string) => void;
}) {
  const { t } = useLabels();
  const { theme } = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot);
  return <div className="monaco-container">
    <Editor defaultPath={"inmemory://vision2code/" + path.split("/").map(encodeURIComponent).join("/")} height="60vh" theme={theme === "dark" ? "vs-dark" : "light"} language={language} value={content}
      loading={<p role="status">{t("editorLoading")}</p>}
      keepCurrentModel={false} saveViewState={false}
      onChange={(value) => { if (value !== undefined) onChange(value); }}
      options={{ minimap: { enabled: false }, lineNumbers: "on", wordWrap: "on",
        automaticLayout: true, fontSize: 13, fontFamily: '"IBM Plex Mono", monospace',
        scrollBeyondLastLine: false, padding: { top: 14, bottom: 14 },
        ariaLabel: t("editorAria"), tabSize: 2,
        links: false, accessibilitySupport: "auto", unicodeHighlight: { ambiguousCharacters: false } }} />
  </div>;
}
