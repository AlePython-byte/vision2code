import { AnalysisResponseSchema, ApiErrorResponseSchema } from "@vision2code/contracts";
import type { AnalysisResponse, ApiErrorCode } from "@vision2code/contracts";
import type { Screenshot } from "../screenshot/loadScreenshot.ts";
import { resolveApiBaseUrl } from "../api/apiBaseUrl.ts";
import { screenshotMimeType } from "../screenshot/validation.ts";
export { DEFAULT_API_BASE_URL, resolveApiBaseUrl } from "../api/apiBaseUrl.ts";

export const ANALYSIS_REQUEST_TIMEOUT_MS = 150_000;

const errorMessages: Record<ApiErrorCode, string> = {
  AI_UNAVAILABLE: "El servicio de análisis no está disponible temporalmente. Inténtalo de nuevo.",
  AI_RATE_LIMITED: "El servicio de análisis está temporalmente limitado. Inténtalo más tarde.",
  AI_OUTPUT_INVALID: "No se pudo interpretar correctamente la interfaz. Puedes volver a intentarlo.",
  UNSUPPORTED_IMAGE: "El formato de la imagen no es compatible.",
  IMAGE_TOO_LARGE: "La imagen supera el tamaño máximo permitido.",
  INVALID_REQUEST: "No se pudo enviar la captura. Revisa la imagen y vuelve a intentarlo.",
  NOT_FOUND: "El servicio de análisis no está disponible en esta dirección.",
  INTERNAL_ERROR: "No se pudo completar el análisis. Inténtalo de nuevo.",
  UNAUTHORIZED: "Tu sesión no es válida o ha expirado. Inicia sesión de nuevo.",
};

export class AnalysisClientError extends Error {
  readonly requestId: string | null;
  /** Safe API error code when the server sent one (or UNAUTHORIZED for a missing token). */
  readonly code: ApiErrorCode | null;
  constructor(message: string, requestId: string | null = null, code: ApiErrorCode | null = null) {
    super(message);
    this.name = "AnalysisClientError";
    this.requestId = requestId;
    this.code = code;
  }
}

export type AnalyzeScreenshot = (screenshot: Screenshot, signal: AbortSignal) => Promise<AnalysisResponse>;

/** Session access supplied by the composition root; the analysis feature never imports auth. */
export interface AnalysisAuth {
  /** Token source owned by the auth feature; the client never stores the token. */
  readonly getAccessToken: () => Promise<string | null>;
  /** Called once per request rejected as unauthenticated (missing token or HTTP 401), never for 5xx or network errors. */
  readonly onUnauthorized?: (() => void) | undefined;
}

export function createAnalysisClient(
  baseUrl?: string,
  transport: typeof fetch = globalThis.fetch,
  auth?: AnalysisAuth
): AnalyzeScreenshot {
  return async (screenshot, signal) => {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, ANALYSIS_REQUEST_TIMEOUT_MS);
    const unauthorized = (requestId: string | null) => {
      auth?.onUnauthorized?.();
      return new AnalysisClientError(errorMessages.UNAUTHORIZED, requestId, "UNAUTHORIZED");
    };
    try {
      if (signal.aborted) controller.abort();
      controller.signal.throwIfAborted();
      let endpoint: string;
      try { endpoint = resolveApiBaseUrl(baseUrl); }
      catch { throw new AnalysisClientError("La dirección del servicio de análisis no es válida."); }
      const body = new FormData();
      const mime = screenshotMimeType(screenshot.format);
      // Use the validated format even when the operating system provided no MIME type.
      body.set("image", screenshot.file.slice(0, screenshot.file.size, mime), screenshot.file.name);
      body.set("viewportWidth", String(screenshot.width));
      body.set("viewportHeight", String(screenshot.height));
      const init: RequestInit = {
        method: "POST",
        body,
        signal: controller.signal,
        credentials: "omit",
        redirect: "error",
      };
      if (auth) {
        let token: string | null;
        try { token = await auth.getAccessToken(); }
        catch { token = null; }
        controller.signal.throwIfAborted();
        // Without a session there is nothing to send: the request would only be rejected.
        if (!token?.trim()) throw unauthorized(null);
        init.headers = { Authorization: `Bearer ${token}` };
      }
      const response = await transport(`${endpoint}/analyses`, init);
      controller.signal.throwIfAborted();
      const payload: unknown = await response.json().catch(() => null);
      controller.signal.throwIfAborted();
      if (!response.ok) {
        const parsed = ApiErrorResponseSchema.safeParse(payload);
        if (response.status === 401) throw unauthorized(parsed.success ? parsed.data.error.requestId : null);
        if (parsed.success) throw new AnalysisClientError(errorMessages[parsed.data.error.code], parsed.data.error.requestId, parsed.data.error.code);
        throw new AnalysisClientError(response.status >= 500
          ? "El servicio de análisis no está disponible temporalmente. Inténtalo de nuevo."
          : "El servicio devolvió una respuesta no válida. Inténtalo de nuevo.");
      }
      const parsed = AnalysisResponseSchema.safeParse(payload);
      if (!parsed.success) throw new AnalysisClientError("El servicio devolvió un análisis no válido. Inténtalo de nuevo.");
      return parsed.data;
    } catch (error) {
      if (signal.aborted) throw new AnalysisClientError("Análisis cancelado. Puedes volver a intentarlo.");
      if (timedOut) throw new AnalysisClientError("El análisis tardó demasiado. Puedes volver a intentarlo.");
      if (error instanceof AnalysisClientError) throw error;
      throw new AnalysisClientError("No se pudo conectar con el servicio de análisis. Comprueba la conexión e inténtalo de nuevo.");
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  };
}
