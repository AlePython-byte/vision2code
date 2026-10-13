import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module.js";
import { AnalysisModule } from "./analysis/analysis.module.js";
import { AuthModule } from "./auth/auth.module.js";

@Module({ imports: [HealthModule, AnalysisModule, AuthModule] })
export class AppModule {}
