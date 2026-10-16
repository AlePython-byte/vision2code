import { Module } from "@nestjs/common";
import type { AIProvider } from "../ai/ai-provider.js";
import { AuthModule } from "../auth/auth.module.js";
import { AI_PROVIDER, ANALYSIS_QUOTA } from "./analysis.constants.js";
import { AnalysisQuota, readAnalysisQuotaConfiguration } from "./analysis-quota.js";
import { AnalyzeInterfaceUseCase } from "./analyze-interface.use-case.js";
import { AnalysesController } from "./http/analyses.controller.js";
import { AnalysisQuotaGuard } from "./http/analysis-quota.guard.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import { readOpenAIConfiguration } from "./providers/openai.configuration.js";
import { readAnalysisProfiles } from "./analysis-profiles.js";

@Module({
  imports: [AuthModule],
  controllers: [AnalysesController],
  providers: [
    { provide: AI_PROVIDER, useFactory: () => new OpenAIProvider({ ...readOpenAIConfiguration(), profiles: readAnalysisProfiles() }) },
    // Weights come from the same profiles the provider uses, so env overrides of a mode's output cap follow.
    { provide: ANALYSIS_QUOTA, useFactory: () => new AnalysisQuota(readAnalysisQuotaConfiguration(), readAnalysisProfiles()) },
    AnalysisQuotaGuard,
    { provide: AnalyzeInterfaceUseCase, inject: [AI_PROVIDER], useFactory: (provider: AIProvider) => new AnalyzeInterfaceUseCase(provider) },
  ],
})
export class AnalysisModule {}
