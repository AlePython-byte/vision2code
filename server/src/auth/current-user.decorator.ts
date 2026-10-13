import { createParamDecorator, type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { RequestWithUser } from "./supabase-auth.guard.js";
import type { AuthenticatedUser } from "./authenticated-user.js";

/**
 * Parameter decorator that extracts the verified AuthenticatedUser from the request object.
 * Only populated after SupabaseAuthGuard successfully cryptographically validates the token.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user || !request.user.id) {
      throw new UnauthorizedException();
    }
    return request.user;
  }
);

