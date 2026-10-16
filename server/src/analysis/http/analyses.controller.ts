import { Body, Controller, HttpCode, Inject, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";
import { AnalysisResponseSchema } from "@vision2code/contracts";
import type { AnalysisResponse } from "@vision2code/contracts";
import { SupabaseAuthGuard } from "../../auth/supabase-auth.guard.js";
import { ApiHttpException } from "../../http/api-http.exception.js";
import type { RequestContext } from "../../http/request-id.middleware.js";
import { AnalyzeInterfaceUseCase } from "../analyze-interface.use-case.js";
import { ANALYSIS_SERVER_TIMEOUT_MS, DEFAULT_ANALYSIS_FIDELITY } from "@vision2code/contracts";
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
  constructor(@Inject(AnalyzeInterfaceUseCase) private readonly analyzeInterface: AnalyzeInterfaceUseCase) {}

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
      // Each mode has its own deadline: precise reasons longer over a higher-detail image.
      const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(ANALYSIS_SERVER_TIMEOUT_MS[input.fidelity ?? DEFAULT_ANALYSIS_FIDELITY])]);
      try {
        // Units are charged only now that the request is valid and the provider is about to be called.
        const uiSchema = await this.analyzeInterface.execute(input, signal, (validated) => {
          const rejection = lease.charge(validated.fidelity ?? DEFAULT_ANALYSIS_FIDELITY);
          if (rejection !== null) throw new ApiHttpException("ANALYSIS_QUOTA_EXCEEDED", 429, rejection.retryAfterSeconds);
        });
        return AnalysisResponseSchema.parse({ requestId: request.requestId, uiSchema });
      } catch (error) {
        if (error instanceof ApiHttpException) throw error;
        if (signal.aborted) throw new ProviderFailureError("UNAVAILABLE");
        throw error;
      }
    } finally {
      response.off("close", onClose);
      lease.release();
    }
  }
}
