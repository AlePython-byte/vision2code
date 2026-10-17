import { useState } from "react";
import { useLabels } from "../preferences/useLabels";
import type { CompletedGenerationArtifact } from "../generation/generationArtifact";
import type { GenerationSessionModel } from "../generation/generationSessionModel";
import type { ProjectsModel } from "../projects/projectsModel";
import type { AnalyzeScreenshot } from "../analysis/analysisClient";
import { CaptureConsole, type CaptureProjectTarget } from "../analysis/CaptureConsole";
import { ProjectChip } from "../projects/ProjectChip";

export function Workspace({
  onGenerated,
  projects,
  analyzeScreenshot,
}: {
  onGenerated: (artifact: CompletedGenerationArtifact) => void;
  projects?: {
    projectsModel: ProjectsModel;
    generationSession: GenerationSessionModel;
    onChangeProject: () => void;
  } | undefined;
  /** Authenticated analysis client from the workspace services. */
  analyzeScreenshot?: AnalyzeScreenshot | undefined;
}) {
  const { t } = useLabels();
  const [projectTarget] = useState<CaptureProjectTarget | undefined>(() => projects && {
    getSelectedProjectId: () => projects.projectsModel.getSnapshot().selectedProjectId,
    onAnalysisReplaced: () => projects.generationSession.clear(),
    render: (analysisTargetProjectId) => (
      <ProjectChip projects={projects.projectsModel} session={projects.generationSession}
        analysisTargetProjectId={analysisTargetProjectId} onChange={projects.onChangeProject} />
    ),
  });
  return (
    <main id="workspace" className="workspace capture-workspace" tabIndex={-1}>
      <div className="workspace-heading">
        <div>
          <h1>{t("captureTitle")}</h1>
          <p className="workspace-intro">{t("captureIntro")}</p>
        </div>
        <span className="workspace-badge"><span className="status-dot cyan" />{t("analysisBadge")}</span>
      </div>
      <CaptureConsole onGenerated={onGenerated} projectTarget={projectTarget} analyzeScreenshot={analyzeScreenshot} />
    </main>
  );
}
