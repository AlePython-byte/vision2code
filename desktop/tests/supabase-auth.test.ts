import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient, User, Session, AuthError } from "@supabase/supabase-js";
import {
  createSupabaseAuthProvider,
  mapSupabaseUser,
  mapSupabaseSession,
  mapSupabaseError,
  readSupabaseConfig,
  getSupabaseClient,
  createAuthModel,
  AuthDomainError,
} from "../src/features/auth/index.ts";

function createMockSupabaseUser(overrides: Partial<User> = {}): User {
  return {
    id: "usr-test-123",
    app_metadata: { provider: "email" },
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    email: "designer@example.com",
    email_confirmed_at: "2026-01-01T00:05:00.000Z",
    ...overrides,
  } as User;
}

function createMockSupabaseSession(user: User, accessToken = "eyJhbGciOi..."): Session {
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 1800000000,
    refresh_token: "mock-refresh-token",
    user,
  };
}

function createMockSupabaseClient(handlers: {
  signInWithPassword?: (params: any) => Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>;
  signUp?: (params: any) => Promise<{ data: { user: User | null; session: Session | null }; error: AuthError | null }>;
  getSession?: () => Promise<{ data: { session: Session | null }; error: AuthError | null }>;
  signOut?: () => Promise<{ error: AuthError | null }>;
}): SupabaseClient {
  return {
    auth: {
      signInWithPassword: handlers.signInWithPassword ?? (async () => ({ data: { user: null, session: null }, error: null })),
      signUp: handlers.signUp ?? (async () => ({ data: { user: null, session: null }, error: null })),
      getSession: handlers.getSession ?? (async () => ({ data: { session: null }, error: null })),
      signOut: handlers.signOut ?? (async () => ({ error: null })),
    },
  } as unknown as SupabaseClient;
}

test("1. sign-in with valid response maps to AuthSession + AuthUser (without tokens)", async () => {
  const mockUser = createMockSupabaseUser();
  const mockSession = createMockSupabaseSession(mockUser, "sensitive-raw-jwt-token");

  assert.equal(mapSupabaseSession(null), null);
  const directlyMapped = mapSupabaseSession(mockSession);
  assert.ok(directlyMapped);
  assert.equal(directlyMapped.user.id, "usr-test-123");

  const mockClient = createMockSupabaseClient({
    signInWithPassword: async ({ email, password }) => {
      assert.equal(email, "designer@example.com");
      assert.equal(password, "validPassword123");
      return { data: { user: mockUser, session: mockSession }, error: null };
    },
  });

  const provider = createSupabaseAuthProvider(mockClient);
  const session = await provider.signIn({ email: "designer@example.com", password: "validPassword123" });

  assert.ok(session);
  assert.equal(session.user.id, "usr-test-123");
  assert.equal(session.user.email, "designer@example.com");
  assert.equal(session.user.emailVerified, true);

  // Security: Ensure raw tokens are NEVER present in domain AuthSession or AuthUser
  assert.equal((session as any).access_token, undefined);
  assert.equal((session as any).refresh_token, undefined);
  assert.equal((session.user as any).access_token, undefined);
  assert.equal((session.user as any).app_metadata, undefined);
});

test("2. invalid credentials map to safe INVALID_CREDENTIALS domain error", async () => {
  const mockClient = createMockSupabaseClient({
    signInWithPassword: async () => ({
      data: { user: null, session: null },
      error: {
        name: "AuthApiError",
        message: "Invalid login credentials",
        status: 400,
      } as AuthError,
    }),
  });

  const provider = createSupabaseAuthProvider(mockClient);

  await assert.rejects(
    async () => {
      await provider.signIn({ email: "user@example.com", password: "wrong-password" });
    },
    (err: any) => {
      assert.ok(err instanceof AuthDomainError);
      assert.equal(err.code, "INVALID_CREDENTIALS");
      return true;
    }
  );
});

test("3. raw Supabase error message is NOT leaked to domain error", async () => {
  const sensitiveDatabaseErrorMessage = "Internal Postgres SQLSTATE[42P01] table 'auth.users' lock contention at server 10.0.0.1";
  const mapped = mapSupabaseError({
    name: "AuthApiError",
    message: sensitiveDatabaseErrorMessage,
    status: 500,
  });

  assert.ok(mapped instanceof AuthDomainError);
  // Domain message must be sanitized and not contain raw database/internal strings
  assert.doesNotMatch(mapped.message, /Postgres/i);
  assert.doesNotMatch(mapped.message, /SQLSTATE/i);
  assert.doesNotMatch(mapped.message, /10\.0\.0\.1/);
});

test("4. sign-up with immediate session maps to AUTHENTICATED", async () => {
  const mockUser = createMockSupabaseUser({ id: "usr-immediate-1" });
  const mockSession = createMockSupabaseSession(mockUser);

  const mockClient = createMockSupabaseClient({
    signUp: async () => ({
      data: { user: mockUser, session: mockSession },
      error: null,
    }),
  });

  const provider = createSupabaseAuthProvider(mockClient);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.signUp({ email: "newuser@example.com", password: "password123" });

  const snapshot = model.getSnapshot();
  assert.equal(snapshot.status, "AUTHENTICATED");
  assert.equal(snapshot.user?.id, "usr-immediate-1");
  assert.equal(snapshot.error, null);
});

test("5. sign-up requiring email confirmation maps to AWAITING_EMAIL_CONFIRMATION", async () => {
  const mockUser = createMockSupabaseUser({
    id: "usr-pending-1",
    email_confirmed_at: undefined,
    confirmed_at: undefined,
  } as any);

  // When email confirmation is enabled, Supabase returns user but null session
  const mockClient = createMockSupabaseClient({
    signUp: async () => ({
      data: { user: mockUser, session: null },
      error: null,
    }),
  });

  const provider = createSupabaseAuthProvider(mockClient);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.signUp({ email: "pending@example.com", password: "password123" });

  const snapshot = model.getSnapshot();
  assert.equal(snapshot.status, "AWAITING_EMAIL_CONFIRMATION");
  assert.equal(snapshot.user?.id, "usr-pending-1");
  assert.equal(snapshot.user?.emailVerified, false);
  assert.equal(snapshot.error, null);
});

test("6. restoreSession reads existing session correctly", async () => {
  const mockUser = createMockSupabaseUser({ id: "usr-restored-1" });
  const mockSession = createMockSupabaseSession(mockUser);

  const mockClient = createMockSupabaseClient({
    getSession: async () => ({
      data: { session: mockSession },
      error: null,
    }),
  });

  const provider = createSupabaseAuthProvider(mockClient);
  const restored = await provider.restoreSession();

  assert.ok(restored);
  assert.equal(restored.user.id, "usr-restored-1");
  assert.equal(restored.user.email, "designer@example.com");
});

test("7. restoreSession with no session returns null", async () => {
  const mockClient = createMockSupabaseClient({
    getSession: async () => ({
      data: { session: null },
      error: null,
    }),
  });

  const provider = createSupabaseAuthProvider(mockClient);
  const restored = await provider.restoreSession();

  assert.equal(restored, null);
});

test("8. signOut delegates to Supabase client", async () => {
  let signOutCalled = false;
  const mockClient = createMockSupabaseClient({
    signOut: async () => {
      signOutCalled = true;
      return { error: null };
    },
  });

  const provider = createSupabaseAuthProvider(mockClient);
  await provider.signOut();

  assert.equal(signOutCalled, true);
});

test("9. getAccessToken retrieves token from provider without storing in AuthState", async () => {
  const mockUser = createMockSupabaseUser();
  const secretJwt = "super-secret-access-token-xyz-987";
  const mockSession = createMockSupabaseSession(mockUser, secretJwt);

  const mockClient = createMockSupabaseClient({
    getSession: async () => ({
      data: { session: mockSession },
      error: null,
    }),
    signInWithPassword: async () => ({
      data: { user: mockUser, session: mockSession },
      error: null,
    }),
  });

  const provider = createSupabaseAuthProvider(mockClient);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.signIn({ email: "designer@example.com", password: "password123" });

  // Token retrieval is out-of-band via getAccessToken()
  const token = await model.getAccessToken();
  assert.equal(token, secretJwt);

  // Verify AuthState and snapshot do NOT contain the token
  const snapshot = model.getSnapshot();
  const snapshotJson = JSON.stringify(snapshot);
  assert.equal(snapshotJson.includes("super-secret-access-token"), false);
  assert.equal((snapshot as any).access_token, undefined);
  assert.equal((snapshot.user as any).access_token, undefined);
});

test("10. malformed Supabase response fails safely without throwing unhandled exceptions", async () => {
  // Malformed user without id
  assert.throws(
    () => mapSupabaseUser({} as any),
    (err: any) => err instanceof AuthDomainError && err.code === "UNKNOWN"
  );

  // Missing session in signIn response
  const mockClient = createMockSupabaseClient({
    signInWithPassword: async () => ({
      data: { user: null, session: null },
      error: null,
    }),
  });

  const provider = createSupabaseAuthProvider(mockClient);
  await assert.rejects(
    async () => {
      await provider.signIn({ email: "malformed@example.com", password: "password" });
    },
    (err: any) => err instanceof AuthDomainError && err.code === "UNKNOWN"
  );
});

test("11. emailVerified correctly maps from confirmed_at / email_confirmed_at", () => {
  const verifiedViaEmailConfirmedAt = mapSupabaseUser({
    id: "usr-1",
    email: "test1@example.com",
    email_confirmed_at: "2026-02-01T00:00:00Z",
  } as any);
  assert.equal(verifiedViaEmailConfirmedAt.emailVerified, true);

  const verifiedViaConfirmedAt = mapSupabaseUser({
    id: "usr-2",
    email: "test2@example.com",
    confirmed_at: "2026-02-01T00:00:00Z",
  } as any);
  assert.equal(verifiedViaConfirmedAt.emailVerified, true);

  const unverified = mapSupabaseUser({
    id: "usr-3",
    email: "test3@example.com",
  } as any);
  assert.equal(unverified.emailVerified, false);
});

test("12. missing Supabase configuration fails safely", async () => {
  assert.equal(getSupabaseClient({ url: "", publishableKey: "" }), null);
  const provider = createSupabaseAuthProvider(null);

  // restoreSession safely returns null if client is null
  const session = await provider.restoreSession();
  assert.equal(session, null);

  // signIn fails with clean domain error
  await assert.rejects(
    async () => {
      await provider.signIn({ email: "user@example.com", password: "pwd" });
    },
    (err: any) => err instanceof AuthDomainError && err.code === "NETWORK_ERROR"
  );

  // getAccessToken safely returns null
  const token = await provider.getAccessToken?.();
  assert.equal(token, null);
});

test("13. no Supabase service-role secret is ever expected or accepted by desktop", () => {
  // Ensure that passing service role env vars does NOT populate any service role property
  const originalEnv = process.env;
  try {
    process.env = {
      ...originalEnv,
      VITE_SUPABASE_URL: "https://test-project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb-publishable-key-123",
      SUPABASE_SERVICE_ROLE_KEY: "secret-service-role-key-do-not-leak",
    };

    const config = readSupabaseConfig();
    assert.ok(config);
    assert.equal(config.url, "https://test-project.supabase.co");
    assert.equal(config.publishableKey, "sb-publishable-key-123");
    // Ensure config object does not have serviceRoleKey or leak service role secrets
    assert.equal((config as any).serviceRoleKey, undefined);
    assert.equal((config as any).service_role, undefined);
  } finally {
    process.env = originalEnv;
  }
});

