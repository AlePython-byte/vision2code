import { useSyncExternalStore } from "react";
import { FolderDown } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import type { EditorModel } from "../editor/editorModel";
import type { ExportModel } from "./exportModel";

/**
 * Secondary "Export" action next to "Copy code". It exports the working copy (edits included),
 * whether or not the result was saved; the destination is chosen in the native folder dialog.
 */
export function ExportButton({ exporter, editor }: { exporter: ExportModel; editor: EditorModel }) {
  const { t } = useLabels();
  const state = useSyncExternalStore(exporter.subscribe, exporter.getSnapshot, exporter.getSnapshot);
  const editorState = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const hasResult = editorState.project !== null && editorState.files.length > 0;
  const exporting = state.status === "EXPORTING";
  const hint = hasResult ? t("exportHint") : t("exportNoResult");
  return (
    <span className="export-control">
      <button type="button" className="action-button" disabled={!hasResult || exporting} aria-busy={exporting || undefined}
        title={hint} aria-describedby="export-hint" onClick={() => { void exporter.exportWorkingCopy(); }}>
        <FolderDown aria-hidden="true" />{exporting ? t("exporting") : t("export")}
      </button>
      <small id="export-hint" className="export-hint">{hasResult ? t("exportHintShort") : hint}</small>
    </span>
  );
}
