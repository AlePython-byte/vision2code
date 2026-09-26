import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configureApplication } from "./configure-application.js";
import { readConfiguration } from "./configuration.js";

async function bootstrap(): Promise<void> {
  const configuration = readConfiguration();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApplication(app);
  app.enableShutdownHooks();
  await app.listen(configuration.port, "127.0.0.1");
  Logger.log(`API listening at http://localhost:${configuration.port}/api/v1`, "Bootstrap");
}

bootstrap().catch(() => {
  Logger.error("Failed to start the server. Check the port and environment configuration.", undefined, "Bootstrap");
  process.exitCode = 1;
});
