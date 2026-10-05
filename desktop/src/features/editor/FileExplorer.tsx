import type { GeneratedFile } from "../generation/generatedProject";

export function FileExplorer({ files, activePath, onSelect }: {
  files: readonly GeneratedFile[]; activePath: string | null; onSelect: (path: string) => void;
}) {
  return <aside className="file-explorer raised-panel" aria-label="Archivos generados">
    <p className="eyebrow">Proyecto / Archivos</p>
    <h2>Explorador</h2>
    <ul>{files.map((file) => <li key={file.path}>
      <button type="button" aria-current={file.path === activePath ? "true" : undefined}
        onClick={() => onSelect(file.path)} title={file.path}>
        <span aria-hidden="true">◇</span><span>{file.path}</span>
      </button>
    </li>)}</ul>
    {!files.length && <p className="input-help">No hay archivos disponibles.</p>}
  </aside>;
}
