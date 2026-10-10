import { useLabels } from "../preferences/useLabels";
import type { GeneratedProject } from "../generation/generatedProject";
import { CaptureConsole } from "../analysis/CaptureConsole";

export function Workspace({ onGenerated }: { onGenerated: (project: GeneratedProject) => void }) {
  const { t } = useLabels();
  return (
    <main id="workspace" className="workspace" tabIndex={-1}>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">{t("captureEyebrow")}</p>
          <h1>{t("captureTitle")}</h1>
          <p className="workspace-intro">{t("captureIntro")}</p>
        </div>
        <span className="workspace-badge"><span className="status-dot cyan" />{t("analysisBadge")}</span>
      </div>
      <CaptureConsole onGenerated={onGenerated} />
    </main>
  );
}
