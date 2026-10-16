import { Body, Controller, HttpCode, Inject, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";
import { AnalysisResponseSchema } from "@vision2code/contracts";
import type { AnalysisResponse } from "@vision2code/contracts";
import { SupabaseAuthGuard } from "../../auth/supabase-auth.guard.js";
import { ApiHttpException } from "../../http/api-http.exception.js";
import type { RequestContext } from "../../http/request-id.middleware.js";
import { AnalyzeInterfaceUseCase } from "../analyze-interface.use-case.js";
import { DEFAULT_ANALYSIS_FIDELITY } from "@vision2code/contracts";
import { ANALYSIS_DEADLINES } from "../analysis.constants.js";
import type { AnalysisDeadlines } from "../analysis-deadlines.js";
import { logAnalysisSummary } from "../analysis-summary-log.js";
import type { AnalysisOutcome, AnalysisUsage } from "../analysis-summary-log.js";
import { InvalidAnalysisOutputError } from "../invalid-analysis-output.error.js";
import { ProviderFailureError } from "../provider-failure.error.js";
import { AnalysisQuotaGuard } from "./analysis-quota.guard.js";
import type { RequestWithAnalysisLease } from "./analysis-quota.guard.js";
import { AnalysisUploadInterceptor, validateAnalysisUpload } from "./analysis-upload.js";

// Analysis spends provider quota, so it requires a verified Supabase session. Nest runs guards before
// interceptors, so an unauthenticated request is rejected before the upload is parsed or the AI is called.
// The per-user quota guard runs second: no session means no quota is read or taken.
@Controller("analyses")
@UseGuards(SupabaseAuthGuard, AnalysisQuotaGuard)
export class AnalysesController {
  constructor(
    @Inject(AnalyzeInterfaceUseCase) private readonly analyzeInterface: AnalyzeInterfaceUseCase,
    @Inject(ANALYSIS_DEADLINES) private readonly deadlines: AnalysisDeadlines,
  ) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(AnalysisUploadInterceptor)
  async create(@UploadedFile() file: Express.Multer.File | undefined, @Body() metadata: unknown,
    @Req() request: RequestContext & RequestWithAnalysisLease, @Res({ passthrough: true }) response: Response): Promise<AnalysisResponse> {
    const lease = request.analysisLease;
    // AnalysisQuotaGuard always sets it; without one the request must not reach the paid provider.
    if (lease === undefined) throw new Error("Analysis quota lease missing.");
    const disconnected = new AbortController();
    const onClose = () => { if (!response.writableEnded) disconnected.abort(); };
    try {
      const input = validateAnalysisUpload(file, metadata);
      response.once("close", onClose);
      const fidelity = input.fidelity ?? DEFAULT_ANALYSIS_FIDELITY;
      // Each mode has its own deadline: precise reasons longer over a higher-detail image. The two sources
      // of abort are told apart by the reason: the timer aborts with a TimeoutError, a closed connection with an AbortError.
      const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(this.deadlines[fidelity])]);
      let startedAt: number | null = null;
      let usage: AnalysisUsage | null = null;
      let logged = false;
      const summarize = (outcome: AnalysisOutcome) => {
        // Once per analysis, and only if it reached the provider: that is what has a duration and a cost.
        if (logged || startedAt === null) return;
        logged = true;
        logAnalysisSummary({ requestId: request.requestId ?? "unknown", fidelity, durationMs: performance.now() - startedAt, outcome, usage });
      };
      try {
        // Units are charged only now that the request is valid and the provider is about to be called.
        const uiSchema = await this.analyzeInterface.execute(input, signal, {
          beforeProvider: (validated) => {
            const rejection = lease.charge(validated.fidelity ?? DEFAULT_ANALYSIS_FIDELITY);
            if (rejection !== null) throw new ApiHttpException("ANALYSIS_QUOTA_EXCEEDED", 429, rejection.retryAfterSeconds);
            startedAt = performance.now();
          },
          onUsage: (reported) => { usage = reported; },
        });
        const result = AnalysisResponseSchema.safeParse({ requestId: request.requestId, uiSchema });
        if (!result.success) { summarize("invalid"); throw result.error; }
        summarize("ok");
        return result.data;
      } catch (error) {
        if (error instanceof ApiHttpException) throw error;
        if (signal.aborted) {
          // The server's deadline is an error to show; a client that left has nobody to show it to.
          const timedOut = signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
          summarize(timedOut ? "timeout" : "client_abort");
          throw new ProviderFailureError(timedOut ? "TIMEOUT" : "UNAVAILABLE");
        }
        summarize(error instanceof ProviderFailureError
          ? error.kind === "TIMEOUT" ? "timeout" : error.kind === "TRUNCATED" ? "truncated" : "provider_error"
          : error instanceof InvalidAnalysisOutputError ? "invalid" : "provider_error");
        throw error;
      }
    } finally {
      response.off("close", onClose);
      lease.release();
    }
  }
}
