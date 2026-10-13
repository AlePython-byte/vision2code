import { Controller, Get, UseGuards } from "@nestjs/common";
import { SupabaseAuthGuard } from "./supabase-auth.guard.js";
import { CurrentUser } from "./current-user.decorator.js";
import type { AuthenticatedUser } from "./authenticated-user.js";

@Controller("auth")
export class AuthController {
  @Get("me")
  @UseGuards(SupabaseAuthGuard)
  getMe(@CurrentUser() user: AuthenticatedUser): { id: string; email?: string | undefined } {
    return {
      id: user.id,
      email: user.email,
    };
  }
}
