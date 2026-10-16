import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureApplication } from "./configure-application.js";
import { readConfiguration } from "./configuration.js";
import { ConfigurationError } from "./configuration-error.js";
import { readAnalysisProfiles } from "./analysis/analysis-profiles.js";
import { readAnalysisQuotaConfiguration } from "./analysis/analysis-quota.js";

/**
 * Reads the analysis environment before Nest starts, so a malformed value stops startup with a
 * message that names the variable. Both readers only ever put the variable name in their messages.
 */
function validateAnalysisConfiguration(): void {
  try {
    readAnalysisProfiles();
    readAnalysisQuotaConfiguration();
  } catch (error) {
    throw error instanceof ConfigurationError ? error : new ConfigurationError(error instanceof Error ? error.message : "Invalid analysis configuration.");
  }
}

async function bootstrap(): Promise<void> {
  const configuration = readConfiguration();
  if (!configuration.supabaseUrl) {
    throw new Error("SUPABASE_URL is required for auth verification.");
  }
  validateAnalysisConfiguration();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApplication(app);
  app.enableShutdownHooks();
  await app.listen(configuration.port, "127.0.0.1");
  Logger.log(`API listening at http://localhost:${configuration.port}/api/v1`, "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  // Only configuration errors are printed: their messages name a variable, never its value.
  const detail = error instanceof ConfigurationError ? ` ${error.message}` : "";
  Logger.error(`Failed to start the server. Check the port and environment configuration.${detail}`, undefined, "Bootstrap");
  process.exitCode = 1;
});
