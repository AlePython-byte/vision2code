import { useState } from "react";
import { useLabels } from "../preferences/useLabels";
import type { CompletedGenerationArtifact } from "../generation/generationArtifact";
import type { GenerationSessionModel } from "../generation/generationSessionModel";
import type { ProjectsModel } from "../projects/projectsModel";
import { CaptureConsole, type CaptureProjectTarget } from "../analysis/CaptureConsole";
import { ProjectTargetPanel } from "../projects/ProjectTargetPanel";

export function Workspace({
  onGenerated,
  projects,
}: {
  onGenerated: (artifact: CompletedGenerationArtifact) => void;
  projects?: {
    projectsModel: ProjectsModel;
    generationSession: GenerationSessionModel;
    onOpenGeneration: (projectId: string, generationId: string) => void;
  } | undefined;
}) {
  const { t } = useLabels();
  const [projectTarget] = useState<CaptureProjectTarget | undefined>(() => projects && {
    getSelectedProjectId: () => projects.projectsModel.getSnapshot().selectedProjectId,
    onAnalysisReplaced: () => projects.generationSession.clear(),
    render: (analysisTargetProjectId) => (
      <ProjectTargetPanel projects={projects.projectsModel} session={projects.generationSession}
        analysisTargetProjectId={analysisTargetProjectId} onOpenGeneration={projects.onOpenGeneration} />
    ),
  });
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
      <CaptureConsole onGenerated={onGenerated} projectTarget={projectTarget} />
    </main>
  );
}
