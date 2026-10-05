import { randomUUID } from "node:crypto";
import { Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import type { ApiErrorCode, ApiErrorResponse } from "@vision2code/contracts";
import type { RequestContext } from "./request-id.middleware.js";
import { ApiHttpException } from "./api-http.exception.js";
import { InvalidAnalysisOutputError } from "../analysis/invalid-analysis-output.error.js";
import { ProviderFailureError } from "../analysis/provider-failure.error.js";

const errorMessages: Record<ApiErrorCode, string> = {
  INVALID_REQUEST: "La solicitud no es válida.",
  NOT_FOUND: "No se encontró el recurso solicitado.",
  INTERNAL_ERROR: "Ha ocurrido un error inesperado.",
  UNSUPPORTED_IMAGE: "El formato de la imagen no es compatible.",
  IMAGE_TOO_LARGE: "La imagen supera el tamaño máximo permitido.",
  AI_RATE_LIMITED: "El servicio de análisis está temporalmente limitado. Inténtalo nuevamente.",
  AI_UNAVAILABLE: "El servicio de análisis no está disponible temporalmente.",
  AI_OUTPUT_INVALID: "No se pudo interpretar correctamente la interfaz.",
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter<unknown> {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestContext>();
    const response = context.getResponse<Response>();
    const requestId = request.requestId ?? randomUUID();
    let status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = status >= 500 ? "INTERNAL_ERROR" : status === 404 ? "NOT_FOUND" : "INVALID_REQUEST";
    if (exception instanceof ApiHttpException) code = exception.code;
    else if (exception instanceof InvalidAnalysisOutputError) { status = 502; code = "AI_OUTPUT_INVALID"; }
    else if (exception instanceof ProviderFailureError) {
      status = exception.kind === "RATE_LIMITED" ? 429 : 503;
      code = exception.kind === "RATE_LIMITED" ? "AI_RATE_LIMITED" : "AI_UNAVAILABLE";
    }
    const body: ApiErrorResponse = { error: { code, message: errorMessages[code], requestId } };

    // Log correlation metadata only; request bodies and exception messages may contain sensitive data.
    if (status >= 500) this.logger.error(`Request ${requestId} failed with HTTP ${status}.`);
    if (response.headersSent) return;
    response.setHeader("X-Request-Id", requestId);
    response.status(status).json(body);
  }
}
