import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { RequestIdSchema } from "@vision2code/contracts";

export interface RequestContext extends Request {
  requestId?: string;
}

export function requestIdMiddleware(request: RequestContext, response: Response, next: NextFunction): void {
  const incoming = RequestIdSchema.safeParse(request.headers["x-request-id"]);
  request.requestId = incoming.success ? incoming.data : randomUUID();
  response.setHeader("X-Request-Id", request.requestId);
  next();
}
