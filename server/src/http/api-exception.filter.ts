import { randomUUID } from "node:crypto";
import { Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import type { ApiErrorCode, ApiErrorResponse } from "@vision2code/contracts";
import type { RequestContext } from "./request-id.middleware.js";

const errorMessages: Record<ApiErrorCode, string> = {
  INVALID_REQUEST: "La solicitud no es válida.",
  NOT_FOUND: "No se encontró el recurso solicitado.",
  INTERNAL_ERROR: "Ha ocurrido un error inesperado.",
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter<unknown> {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestContext>();
    const response = context.getResponse<Response>();
    const requestId = request.requestId ?? randomUUID();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code: ApiErrorCode = status >= 500 ? "INTERNAL_ERROR" : status === 404 ? "NOT_FOUND" : "INVALID_REQUEST";
    const body: ApiErrorResponse = { error: { code, message: errorMessages[code], requestId } };

    // Log correlation metadata only; request bodies and exception messages may contain sensitive data.
    if (status >= 500) this.logger.error(`Request ${requestId} failed with HTTP ${status}.`);
    if (response.headersSent) return;
    response.setHeader("X-Request-Id", requestId);
    response.status(status).json(body);
  }
}
