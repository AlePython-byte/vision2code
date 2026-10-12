import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthModel,
  type AuthProvider,
  type AuthSession,
  type SignUpResult,
  type AuthUser,
  type SignInInput,
  type SignUpInput,
  createUnconfiguredAuthProvider,
  AuthDomainError,
} from "../src/features/auth/index.ts";

function createMockUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "usr_12345678",
    email: "developer@example.com",
    emailVerified: true,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
function dummySignUp(): Promise<SignUpResult> {
  throw new Error("not implemented");
}
test("1. initial RESTORING state with autoRestore false", () => {
  const provider = createUnconfiguredAuthProvider();
  const model = createAuthModel(provider, { autoRestore: false });
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "RESTORING");
  assert.equal(snapshot.user, null);
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.revision, 0);
});

test("2. restore success transitions to AUTHENTICATED", async () => {
  const user = createMockUser();
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return { user };
    },
    async signIn(): Promise<AuthSession> {
      throw new Error("not implemented");
    },
    signUp: dummySignUp,
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.restoreSession();
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "AUTHENTICATED");
  assert.deepEqual(snapshot.user, user);
  assert.equal(snapshot.error, null);
  assert.ok(snapshot.revision > 0);
});

test("3. restore without session transitions to UNAUTHENTICATED", async () => {
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      throw new Error("not implemented");
    },
    signUp: dummySignUp,
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.restoreSession();
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "UNAUTHENTICATED");
  assert.equal(snapshot.user, null);
  assert.equal(snapshot.error, null);
});

test("4. restore failure transitions to UNAUTHENTICATED with safe error", async () => {
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      throw new AuthDomainError("SESSION_EXPIRED", "Token expired");
    },
    async signIn(): Promise<AuthSession> {
      throw new Error("not implemented");
    },
    signUp: dummySignUp,
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.restoreSession();
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "UNAUTHENTICATED");
  assert.equal(snapshot.user, null);
  assert.equal(snapshot.error, "SESSION_EXPIRED");
});

test("5. sign-in success transitions UNAUTHENTICATED -> AUTHENTICATING -> AUTHENTICATED", async () => {
  const user = createMockUser({ email: "user@domain.com" });
  const states: string[] = [];

  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(input: SignInInput): Promise<AuthSession> {
      assert.equal(input.email, "user@domain.com");
      return { user };
    },
    signUp: dummySignUp,
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  model.subscribe(() => {
    states.push(model.getSnapshot().status);
  });

  await model.signIn({ email: " USER@DOMAIN.COM ", password: "ValidPassword123" });
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "AUTHENTICATED");
  assert.deepEqual(snapshot.user, user);
  assert.equal(snapshot.error, null);
  assert.ok(states.includes("AUTHENTICATING"));
  assert.ok(states.includes("AUTHENTICATED"));
});

test("6. sign-in failure transitions to ERROR with domain code", async () => {
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      throw new AuthDomainError("INVALID_CREDENTIALS", "Wrong credentials");
    },
    signUp: dummySignUp,
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signIn({ email: "test@example.com", password: "password123" });
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "ERROR");
  assert.equal(snapshot.user, null);
  assert.equal(snapshot.error, "INVALID_CREDENTIALS");
});

test("7. sign-up with immediate session transitions to AUTHENTICATED", async () => {
  const user = createMockUser({ email: "newuser@example.com" });
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      throw new Error("not implemented");
    },
    async signUp(input: SignUpInput): Promise<SignUpResult> {
      assert.equal(input.email, "newuser@example.com");
      return { user, session: { user }, requiresEmailConfirmation: false };
    },
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signUp({ email: "newuser@example.com", password: "ValidPassword123" });
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "AUTHENTICATED");
  assert.deepEqual(snapshot.user, user);
  assert.equal(snapshot.error, null);
});

test("8. sign-up requiring email confirmation transitions to AWAITING_EMAIL_CONFIRMATION", async () => {
  const user = createMockUser({ email: "unconfirmed@example.com", emailVerified: false });
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      throw new Error("not implemented");
    },
    async signUp(input: SignUpInput): Promise<SignUpResult> {
      assert.equal(input.email, "unconfirmed@example.com");
      return { user, session: null, requiresEmailConfirmation: true };
    },
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signUp({ email: "unconfirmed@example.com", password: "ValidPassword123" });
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "AWAITING_EMAIL_CONFIRMATION");
  assert.deepEqual(snapshot.user, user);
  assert.equal(snapshot.error, null);
});

test("8b. awaiting-confirmation snapshot contains no tokens or password and is not ERROR", async () => {
  const secretPassword = "SpecialSecretPassword123!";
  const user = createMockUser({ email: "awaiting@example.com", emailVerified: false });
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      throw new Error("not implemented");
    },
    async signUp(): Promise<SignUpResult> {
      return { user, session: null, requiresEmailConfirmation: true };
    },
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signUp({ email: "awaiting@example.com", password: secretPassword });
  const snapshot = model.getSnapshot();

  assert.notEqual(snapshot.status, "ERROR");
  assert.equal(snapshot.status, "AWAITING_EMAIL_CONFIRMATION");
  assert.equal(snapshot.error, null);

  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes(secretPassword));
  assert.ok(!serialized.includes("password"));
  assert.ok(!serialized.includes("token"));
});

test("8c. stale sign-up result remains ignored when superseded by newer action", async () => {
  const signUpDeferred = createDeferred<SignUpResult>();
  const userSlow = createMockUser({ id: "slow_user" });
  const userFast = createMockUser({ id: "fast_user" });

  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      return { user: userFast };
    },
    async signUp(): Promise<SignUpResult> {
      return signUpDeferred.promise;
    },
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  const slowSignUpPromise = model.signUp({ email: "slow@example.com", password: "Password123" });

  // Fast sign-in supersedes in-flight sign-up
  await model.signIn({ email: "fast@example.com", password: "Password123" });
  assert.equal(model.getSnapshot().user?.id, "fast_user");
  assert.equal(model.getSnapshot().status, "AUTHENTICATED");

  // Late sign-up completes requiring confirmation
  signUpDeferred.resolve({ user: userSlow, session: null, requiresEmailConfirmation: true });
  await slowSignUpPromise;

  // State remains the newer action
  assert.equal(model.getSnapshot().user?.id, "fast_user");
  assert.equal(model.getSnapshot().status, "AUTHENTICATED");
});

test("8d. sign-up error transitions to ERROR", async () => {
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      throw new Error("not implemented");
    },
    async signUp(): Promise<SignUpResult> {
      throw new AuthDomainError("EMAIL_ALREADY_REGISTERED");
    },
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signUp({ email: "existing@example.com", password: "ValidPassword123" });
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "ERROR");
  assert.equal(snapshot.error, "EMAIL_ALREADY_REGISTERED");
});

test("9. logout transitions AUTHENTICATED -> UNAUTHENTICATED and invokes provider.signOut", async () => {
  let signOutInvoked = false;
  const user = createMockUser();
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return { user };
    },
    async signIn(): Promise<AuthSession> {
      return { user };
    },
    async signUp(): Promise<SignUpResult> {
      return { user, session: { user }, requiresEmailConfirmation: false };
    },
    async signOut(): Promise<void> {
      signOutInvoked = true;
    },
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.restoreSession();
  assert.equal(model.getSnapshot().status, "AUTHENTICATED");

  await model.signOut();
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "UNAUTHENTICATED");
  assert.equal(snapshot.user, null);
  assert.equal(snapshot.error, null);
  assert.equal(signOutInvoked, true);
});

test("10. stale restore result is ignored when superseded by newer action", async () => {
  const restoreDeferred = createDeferred<AuthSession | null>();
  const userRestored = createMockUser({ id: "restored" });
  const userSignedIn = createMockUser({ id: "signed_in" });

  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return restoreDeferred.promise;
    },
    async signIn(): Promise<AuthSession> {
      return { user: userSignedIn };
    },
    signUp: dummySignUp,
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  const restorePromise = model.restoreSession();

  // In-flight restore is superseded by a fast sign-in
  await model.signIn({ email: "fast@example.com", password: "Password123" });
  assert.equal(model.getSnapshot().user?.id, "signed_in");

  // Late restore settles
  restoreDeferred.resolve({ user: userRestored });
  await restorePromise;

  // The state remains the newer action's result
  assert.equal(model.getSnapshot().user?.id, "signed_in");
});

test("11. stale sign-in result is ignored when superseded by newer action", async () => {
  const signInDeferred1 = createDeferred<AuthSession>();
  const user1 = createMockUser({ id: "user_1" });
  const user2 = createMockUser({ id: "user_2" });

  let callCount = 0;
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      callCount += 1;
      if (callCount === 1) {
        return signInDeferred1.promise;
      }
      return { user: user2 };
    },
    signUp: dummySignUp,
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  const signInPromise1 = model.signIn({ email: "user1@example.com", password: "Password123" });
  const signInPromise2 = model.signIn({ email: "user2@example.com", password: "Password123" });

  await signInPromise2;
  assert.equal(model.getSnapshot().user?.id, "user_2");

  signInDeferred1.resolve({ user: user1 });
  await signInPromise1;

  assert.equal(model.getSnapshot().user?.id, "user_2");
});

test("12. passwords never appear in snapshots or model state", async () => {
  const secretPassword = "SuperSecretPassword123!";
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      return { user: createMockUser() };
    },
    async signUp(): Promise<SignUpResult> {
      const user = createMockUser();
      return { user, session: { user }, requiresEmailConfirmation: false };
    },
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signIn({ email: "user@example.com", password: secretPassword });

  const snapshotString = JSON.stringify(model.getSnapshot());
  assert.ok(!snapshotString.includes(secretPassword));
  assert.ok(!snapshotString.includes("password"));
});

test("13. provider raw errors and secrets do not leak to UI snapshot", async () => {
  const rawSecretError = "POSTGRES_DB_SECRET_KEY: connection refused at 10.0.0.1:5432";
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      throw new Error(rawSecretError);
    },
    async signUp(): Promise<SignUpResult> {
      throw new Error(rawSecretError);
    },
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signIn({ email: "user@example.com", password: "Password123" });
  const snapshot = model.getSnapshot();

  assert.equal(snapshot.status, "ERROR");
  assert.equal(snapshot.error, "UNKNOWN");
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes(rawSecretError));
});

test("14. unconfigured provider makes zero external network calls and rejects safely", async () => {
  const unconfigured = createUnconfiguredAuthProvider();
  const restored = await unconfigured.restoreSession();
  assert.equal(restored, null);

  await assert.rejects(
    async () => {
      await unconfigured.signIn({ email: "user@example.com", password: "Password123" });
    },
    (err: any) => err instanceof AuthDomainError && err.code === "NETWORK_ERROR"
  );
});

test("15. authenticated user identity snapshot is immutable from UI consumers", async () => {
  const user = createMockUser({ email: "original@example.com" });
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return { user };
    },
    async signIn(): Promise<AuthSession> {
      return { user };
    },
    async signUp(): Promise<SignUpResult> {
      return { user, session: { user }, requiresEmailConfirmation: false };
    },
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.restoreSession();
  const snapshot = model.getSnapshot();

  assert.throws(() => {
    // Attempting to mutate frozen user property
    (snapshot.user as any).email = "hacked@example.com";
  }, /TypeError/);

  assert.throws(() => {
    // Attempting to mutate snapshot status directly
    (snapshot as any).status = "ERROR";
  }, /TypeError/);
});

test("16. validation errors reject malformed input before calling provider", async () => {
  let providerCalled = false;
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      return null;
    },
    async signIn(): Promise<AuthSession> {
      providerCalled = true;
      return { user: createMockUser() };
    },
    async signUp(): Promise<SignUpResult> {
      providerCalled = true;
      const user = createMockUser();
      return { user, session: { user }, requiresEmailConfirmation: false };
    },
    async signOut(): Promise<void> {},
  };

  const model = createAuthModel(provider, { autoRestore: false });
  // Invalid short password (<8 chars)
  await model.signIn({ email: "valid@example.com", password: "short" });

  assert.equal(providerCalled, false);
  assert.equal(model.getSnapshot().status, "ERROR");
  assert.equal(model.getSnapshot().error, "VALIDATION_FAILED");
});

test("17. clearError resets ERROR status back to UNAUTHENTICATED", async () => {
  const provider = createUnconfiguredAuthProvider();
  const model = createAuthModel(provider, { autoRestore: false });
  await model.signIn({ email: "invalid-email", password: "pass" });

  assert.equal(model.getSnapshot().status, "ERROR");
  assert.equal(model.getSnapshot().error, "VALIDATION_FAILED");

  model.clearError();
  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model.getSnapshot().error, null);
});

test("18. returnToSignIn resets AWAITING_EMAIL_CONFIRMATION back to UNAUTHENTICATED without network", async () => {
  const user = createMockUser({ email: "confirm@example.com" });
  let networkCalls = 0;
  const provider: AuthProvider = {
    async restoreSession(): Promise<AuthSession | null> {
      networkCalls++;
      return null;
    },
    async signIn(): Promise<AuthSession> {
      networkCalls++;
      throw new Error("No network call expected");
    },
    async signUp(): Promise<SignUpResult> {
      networkCalls++;
      return { user, session: null, requiresEmailConfirmation: true };
    },
    async signOut(): Promise<void> {
      networkCalls++;
    },
  };

  const model = createAuthModel(provider, { autoRestore: false });
  await model.signUp({ email: "confirm@example.com", password: "password123" });

  assert.equal(model.getSnapshot().status, "AWAITING_EMAIL_CONFIRMATION");
  assert.equal(model.getSnapshot().user?.email, "confirm@example.com");

  const callsBefore = networkCalls;
  model.returnToSignIn();

  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model.getSnapshot().user, null);
  assert.equal(model.getSnapshot().error, null);
  assert.equal(networkCalls, callsBefore);
});

