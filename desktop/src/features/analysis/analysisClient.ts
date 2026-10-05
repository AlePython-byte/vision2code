import { AnalysisResponseSchema, ApiErrorResponseSchema } from "@vision2code/contracts";
import type { AnalysisResponse, ApiErrorCode } from "@vision2code/contracts";
import type { Screenshot } from "../screenshot/loadScreenshot.ts";

export const DEFAULT_API_BASE_URL = "http://localhost:3000/api/v1";
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
};

export class AnalysisClientError extends Error {
  readonly requestId: string | null;
  constructor(message: string, requestId: string | null = null) {
    super(message);
    this.name = "AnalysisClientError";
    this.requestId = requestId;
  }
}

export type AnalyzeScreenshot = (screenshot: Screenshot, signal: AbortSignal) => Promise<AnalysisResponse>;

export function resolveApiBaseUrl(value?: string): string {
  const url = new URL(value?.trim() || DEFAULT_API_BASE_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid analysis API base URL.");
  }
  return url.href.replace(/\/$/, "");
}

export function createAnalysisClient(baseUrl?: string, transport: typeof fetch = globalThis.fetch): AnalyzeScreenshot {
  return async (screenshot, signal) => {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, ANALYSIS_REQUEST_TIMEOUT_MS);
    try {
      if (signal.aborted) controller.abort();
      controller.signal.throwIfAborted();
      let endpoint: string;
      try { endpoint = resolveApiBaseUrl(baseUrl); }
      catch { throw new AnalysisClientError("La dirección del servicio de análisis no es válida."); }
      const body = new FormData();
      const mime = { PNG: "image/png", JPEG: "image/jpeg", WEBP: "image/webp" }[screenshot.format];
      // Use the validated format even when the operating system provided no MIME type.
      body.set("image", screenshot.file.slice(0, screenshot.file.size, mime), screenshot.file.name);
      body.set("viewportWidth", String(screenshot.width));
      body.set("viewportHeight", String(screenshot.height));
      const response = await transport(`${endpoint}/analyses`, {
        method: "POST", body, signal: controller.signal, credentials: "omit", redirect: "error",
      });
      controller.signal.throwIfAborted();
      const payload: unknown = await response.json().catch(() => null);
      controller.signal.throwIfAborted();
      if (!response.ok) {
        const parsed = ApiErrorResponseSchema.safeParse(payload);
        if (parsed.success) throw new AnalysisClientError(errorMessages[parsed.data.error.code], parsed.data.error.requestId);
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
