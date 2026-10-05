import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { AnalysisModule } from "./analysis/analysis.module.js";

@Module({ imports: [HealthModule, AnalysisModule] })
export class AppModule {}
