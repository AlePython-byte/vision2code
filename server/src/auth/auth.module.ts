import { Module, type Provider } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { SupabaseAuthGuard, SUPABASE_JWT_VERIFIER } from "./supabase-auth.guard.js";
import { JoseSupabaseJwtVerifier } from "./supabase-jwt-verifier.js";
import { readConfiguration } from "../configuration.js";

const supabaseVerifierProvider: Provider = {
  provide: SUPABASE_JWT_VERIFIER,
  useFactory: () => {
    const config = readConfiguration();
    return new JoseSupabaseJwtVerifier({
      supabaseUrl: config.supabaseUrl,
    });
  },
};

@Module({
  controllers: [AuthController],
  providers: [supabaseVerifierProvider, SupabaseAuthGuard],
  exports: [SUPABASE_JWT_VERIFIER, SupabaseAuthGuard],
})
export class AuthModule {}

