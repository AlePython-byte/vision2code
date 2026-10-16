import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Response } from "express";
import type { RequestWithUser } from "../../auth/supabase-auth.guard.js";
import { ApiHttpException } from "../../http/api-http.exception.js";
import { ANALYSIS_QUOTA } from "../analysis.constants.js";
import type { AnalysisLease, AnalysisQuota } from "../analysis-quota.js";

export interface RequestWithAnalysisLease extends RequestWithUser {
  analysisLease?: AnalysisLease;
}

/**
 * Runs after SupabaseAuthGuard and before the upload interceptor, so an unauthenticated request never
 * touches the quota and a limited one is rejected before its body is read. It takes a concurrency
 * slot (the mode is not known yet: the multipart body is not parsed) and releases it when the
 * response closes, whatever happened; the controller also releases it in `finally`.
 */
@Injectable()
export class AnalysisQuotaGuard implements CanActivate {
  constructor(@Inject(ANALYSIS_QUOTA) private readonly quota: AnalysisQuota) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAnalysisLease>();
    const response = context.switchToHttp().getResponse<Response>();
    // Only the verified `sub` keys the limit; SupabaseAuthGuard has already rejected anything else.
    const userId = request.user?.id;
    if (!userId) throw new UnauthorizedException();
    const lease = this.quota.acquire(userId);
    if (!("release" in lease)) throw new ApiHttpException("ANALYSIS_QUOTA_EXCEEDED", 429, lease.retryAfterSeconds);
    request.analysisLease = lease;
    response.once("close", lease.release);
    // A client that left while its token was being verified will not emit "close" again.
    if (response.closed || request.destroyed) lease.release();
    return true;
  }
}
