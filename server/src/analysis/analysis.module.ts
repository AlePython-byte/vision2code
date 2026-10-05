import { Module } from "@nestjs/common";
import type { AIProvider } from "../ai/ai-provider.js";
import { AI_PROVIDER } from "./analysis.constants.js";
import { AnalyzeInterfaceUseCase } from "./analyze-interface.use-case.js";
import { AnalysesController } from "./http/analyses.controller.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import { readOpenAIConfiguration } from "./providers/openai.configuration.js";

@Module({
  controllers: [AnalysesController],
  providers: [
    { provide: AI_PROVIDER, useFactory: () => new OpenAIProvider(readOpenAIConfiguration()) },
    { provide: AnalyzeInterfaceUseCase, inject: [AI_PROVIDER], useFactory: (provider: AIProvider) => new AnalyzeInterfaceUseCase(provider) },
  ],
})
export class AnalysisModule {}
