import { Injectable, type CanActivate, type ExecutionContext, UnauthorizedException, Inject } from "@nestjs/common";
import type { Request } from "express";
import type { SupabaseJwtVerifier } from "./supabase-jwt-verifier.js";
import type { AuthenticatedUser } from "./authenticated-user.js";

export const SUPABASE_JWT_VERIFIER = Symbol("SUPABASE_JWT_VERIFIER");

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_JWT_VERIFIER)
    private readonly verifier: SupabaseJwtVerifier
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;

    if (!authHeader || typeof authHeader !== "string") {
      throw new UnauthorizedException();
    }

    const parts = authHeader.trim().split(" ");
    if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
      throw new UnauthorizedException();
    }

    const token = parts[1];
    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const user = await this.verifier.verifyToken(token);
      request.user = user;
      return true;
    } catch {
      // Do not log the bearer token or internal crypto details; reject safely with 401
      throw new UnauthorizedException();
    }
  }
}
