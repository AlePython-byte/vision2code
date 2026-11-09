import type { NestExpressApplication } from "@nestjs/platform-express";
import { NotFoundException } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { ApiExceptionFilter } from "./http/api-exception.filter.js";
import { DEFAULT_CORS_ORIGINS } from "./configuration.js";
import { requestIdMiddleware } from "./http/request-id.middleware.js";

const API_PREFIX = "api/v1";

export function configureApplication(app: NestExpressApplication, corsOrigins: readonly string[] = DEFAULT_CORS_ORIGINS): void {
  // Register before CORS and Nest's body parser so early responses also have an ID.
  app.use(requestIdMiddleware);
  app.disable("x-powered-by");
  app.setGlobalPrefix(API_PREFIX);
  // Keep namespace misses inside Nest's error boundary instead of Express's HTML fallback.
  app.use((request: Request, _response: Response, next: NextFunction) => {
    const apiRoot = `/${API_PREFIX}/`;
    if (!request.path.startsWith(apiRoot) || request.path === apiRoot) next(new NotFoundException());
    else next();
  });
  app.enableCors({
    origin: [...corsOrigins],
    credentials: false,
    // PATCH and DELETE are used by project rename/delete; they are not CORS-safelisted, so they need preflight approval.
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "X-Request-Id", "Authorization"],
    exposedHeaders: ["X-Request-Id"],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
