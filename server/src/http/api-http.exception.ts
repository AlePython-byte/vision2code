import { HttpException } from "@nestjs/common";
import type { ApiErrorCode } from "@vision2code/contracts";

export class ApiHttpException extends HttpException {
  /** `retryAfterSeconds` is sent as the Retry-After header and in the error body. */
  constructor(readonly code: ApiErrorCode, status: number, readonly retryAfterSeconds?: number | undefined) {
    super(code, status);
  }
}
