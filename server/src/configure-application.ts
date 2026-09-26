import type { NestExpressApplication } from "@nestjs/platform-express";
import { NotFoundException } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { ApiExceptionFilter } from "./http/api-exception.filter.js";
import { requestIdMiddleware } from "./http/request-id.middleware.js";

const API_PREFIX = "api/v1";

export function configureApplication(app: NestExpressApplication): void {
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
    origin: ["http://localhost:1420", "http://127.0.0.1:1420"],
    credentials: false,
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
