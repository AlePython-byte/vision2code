import { Body, Controller, HttpCode, Inject, Post, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";
import { AnalysisResponseSchema } from "@vision2code/contracts";
import type { AnalysisResponse } from "@vision2code/contracts";
import type { RequestContext } from "../../http/request-id.middleware.js";
import { AnalyzeInterfaceUseCase } from "../analyze-interface.use-case.js";
import { ANALYSIS_TIMEOUT_MS } from "../analysis.constants.js";
import { ProviderFailureError } from "../provider-failure.error.js";
import { AnalysisUploadInterceptor, validateAnalysisUpload } from "./analysis-upload.js";

@Controller("analyses")
export class AnalysesController {
  constructor(@Inject(AnalyzeInterfaceUseCase) private readonly analyzeInterface: AnalyzeInterfaceUseCase) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(AnalysisUploadInterceptor)
  async create(@UploadedFile() file: Express.Multer.File | undefined, @Body() metadata: unknown,
    @Req() request: RequestContext, @Res({ passthrough: true }) response: Response): Promise<AnalysisResponse> {
    const input = validateAnalysisUpload(file, metadata);
    const disconnected = new AbortController();
    const onClose = () => { if (!response.writableEnded) disconnected.abort(); };
    response.once("close", onClose);
    const signal = AbortSignal.any([disconnected.signal, AbortSignal.timeout(ANALYSIS_TIMEOUT_MS)]);
    try {
      const uiSchema = await this.analyzeInterface.execute(input, signal);
      return AnalysisResponseSchema.parse({ requestId: request.requestId, uiSchema });
    } catch (error) {
      if (signal.aborted) throw new ProviderFailureError("UNAVAILABLE");
      throw error;
    } finally { response.off("close", onClose); }
  }
}
