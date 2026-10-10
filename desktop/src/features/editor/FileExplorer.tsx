import { FileCode2 } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import type { GeneratedFile } from "../generation/generatedProject";

export function FileExplorer({ files, activePath, onSelect }: {
  files: readonly GeneratedFile[]; activePath: string | null; onSelect: (path: string) => void;
}) {
  const { t } = useLabels();
  return <aside className="file-explorer raised-panel" aria-label={t("generatedFiles")}>
    <p className="eyebrow">{t("filesEyebrow")}</p>
    <h2>{t("explorer")}</h2>
    <ul>{files.map((file) => <li key={file.path}>
      <button type="button" aria-current={file.path === activePath ? "true" : undefined}
        onClick={() => onSelect(file.path)} title={file.path}>
        <FileCode2 aria-hidden="true" /><span>{file.path}</span>
      </button>
    </li>)}</ul>
    {!files.length && <p className="input-help">{t("noFiles")}</p>}
  </aside>;
}
