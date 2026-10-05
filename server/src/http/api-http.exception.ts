import { HttpException } from "@nestjs/common";
import type { ApiErrorCode } from "@vision2code/contracts";

export class ApiHttpException extends HttpException {
  constructor(readonly code: ApiErrorCode, status: number) {
    super(code, status);
  }
}
