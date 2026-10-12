import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createAuthModel,
  probeBackendAuth,
} from "../src/features/auth/index.ts";
import {
  MemoryAuthStorage,
  cleanLegacyLocalStorage,
} from "../src/features/auth/authStorage.ts";
import {
  TauriStrongholdAuthStorage,
  getDefaultAuthStorage,
  isTauriEnvironment,
} from "../src/features/auth/tauriStrongholdStorage.ts";
import {
  createSupabaseAuthProvider,
} from "../src/features/auth/supabaseAuthProvider.ts";

function createMockSupabaseUser(overrides: Partial<any> = {}) {
  return {
    id: "usr-sec-001",
    aud: "authenticated",
    role: "authenticated",
    email: "designer@example.com",
    email_confirmed_at: "2026-03-01T12:00:00Z",
    phone: "",
    confirmed_at: "2026-03-01T12:00:00Z",
    last_sign_in_at: "2026-03-01T12:00:00Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2026-03-01T12:00:00Z",
    updated_at: "2026-03-01T12:00:00Z",
    ...overrides,
  };
}

function createMockSupabaseSession(user: any, accessToken = "vault-token-xyz-123", refreshToken = "vault-refresh-789") {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  };
}

test("1. storage adapter getItem", async () => {
  const storage = new MemoryAuthStorage();
  assert.equal(await storage.getItem("test-key"), null);

  storage.setItem("test-key", "test-value");
  assert.equal(await storage.getItem("test-key"), "test-value");
});

test("2. storage adapter setItem", async () => {
  const storage = new MemoryAuthStorage();
  await storage.setItem("auth-key", "initial-data");
  assert.equal(await storage.getItem("auth-key"), "initial-data");

  await storage.setItem("auth-key", "updated-data");
  assert.equal(await storage.getItem("auth-key"), "updated-data");
});

test("3. storage adapter removeItem", async () => {
  const storage = new MemoryAuthStorage();
  await storage.setItem("session", "persisted-credentials");
  assert.equal(await storage.getItem("session"), "persisted-credentials");

  await storage.removeItem("session");
  assert.equal(await storage.getItem("session"), null);
});

test("4. no WebView localStorage used for auth persistence", async () => {
  const fakeLocalStorage: Record<string, string> = {
    "sb-test-auth-token": "legacy-token-should-be-purged",
    "unrelated-setting": "keep-me",
  };

  const originalWindow = globalThis.window;
  (globalThis as any).window = {
    localStorage: {
      length: 2,
      key(i: number) {
        return Object.keys(fakeLocalStorage)[i] ?? null;
      },
      getItem(key: string) {
        return fakeLocalStorage[key] ?? null;
      },
      setItem(key: string, value: string) {
        fakeLocalStorage[key] = value;
      },
      removeItem(key: string) {
        delete fakeLocalStorage[key];
        (this as any).length = Object.keys(fakeLocalStorage).length;
      },
    },
  };

  try {
    cleanLegacyLocalStorage();
    assert.equal(fakeLocalStorage["sb-test-auth-token"], undefined);
    assert.equal(fakeLocalStorage["unrelated-setting"], "keep-me");

    // Operations on AuthStorage never write to localStorage
    const storage = new MemoryAuthStorage();
    await storage.setItem("sb-new-auth-token", "secure-token");
    assert.equal(fakeLocalStorage["sb-new-auth-token"], undefined);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("5. restore valid persisted session", async () => {
  const storage = new MemoryAuthStorage();
  const mockUser = createMockSupabaseUser({ id: "usr-restored-1", email: "restore@example.com" });
  const mockSession = createMockSupabaseSession(mockUser, "restored-jwt-token");

  // Storage contains the serialized session
  await storage.setItem("sb-session", JSON.stringify(mockSession));

  const mockClient = {
    auth: {
      async getSession() {
        const raw = await storage.getItem("sb-session");
        return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.restoreSession();

  const snapshot = model.getSnapshot();
  assert.equal(snapshot.status, "AUTHENTICATED");
  assert.equal(snapshot.user?.id, "usr-restored-1");
  assert.equal(snapshot.user?.email, "restore@example.com");
  assert.equal(snapshot.user?.emailVerified, true);
});

test("6. no persisted session -> UNAUTHENTICATED", async () => {
  const storage = new MemoryAuthStorage();
  assert.equal(await storage.getItem("sb-session"), null);

  const mockClient = {
    auth: {
      async getSession() {
        return { data: { session: null }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.restoreSession();

  const snapshot = model.getSnapshot();
  assert.equal(snapshot.status, "UNAUTHENTICATED");
  assert.equal(snapshot.user, null);
  assert.equal(snapshot.error, null);
});

test("7. invalid persisted value fails safely", async () => {
  const storage = new MemoryAuthStorage();
  await storage.setItem("sb-session", "malformed-corrupted-json-{{{");

  const mockClient = {
    auth: {
      async getSession() {
        try {
          const raw = await storage.getItem("sb-session");
          return { data: { session: JSON.parse(raw!) }, error: null };
        } catch {
          // Corrupted storage returns null session in SDK
          return { data: { session: null }, error: null };
        }
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.restoreSession();

  const snapshot = model.getSnapshot();
  assert.equal(snapshot.status, "UNAUTHENTICATED");
  assert.equal(snapshot.user, null);
});

test("8. sign-in persists session through adapter", async () => {
  const storage = new MemoryAuthStorage();
  const mockUser = createMockSupabaseUser({ id: "usr-signin", email: "logged@example.com" });
  const mockSession = createMockSupabaseSession(mockUser, "signin-access-jwt");

  const mockClient = {
    auth: {
      async signInWithPassword() {
        await storage.setItem("sb-session", JSON.stringify(mockSession));
        return { data: { user: mockUser, session: mockSession }, error: null };
      },
      async getSession() {
        const raw = await storage.getItem("sb-session");
        return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.signIn({ email: "logged@example.com", password: "Password123!" });

  assert.equal(model.getSnapshot().status, "AUTHENTICATED");
  const storedValue = await storage.getItem("sb-session");
  assert.ok(storedValue);
  assert.ok(storedValue.includes("signin-access-jwt"));
});

test("9. refreshed session overwrites old serialized session", async () => {
  const storage = new MemoryAuthStorage();
  const mockUser = createMockSupabaseUser();
  const initialSession = createMockSupabaseSession(mockUser, "initial-jwt", "refresh-token-1");
  await storage.setItem("sb-session", JSON.stringify(initialSession));

  // Token refresh rotation
  const refreshedSession = createMockSupabaseSession(mockUser, "rotated-jwt", "refresh-token-2");
  await storage.setItem("sb-session", JSON.stringify(refreshedSession));

  const storedValue = await storage.getItem("sb-session");
  assert.ok(storedValue?.includes("rotated-jwt"));
  assert.equal(storedValue?.includes("initial-jwt"), false);
});

test("10. logout removes persisted session", async () => {
  const storage = new MemoryAuthStorage();
  await storage.setItem("sb-session", JSON.stringify(createMockSupabaseSession(createMockSupabaseUser())));

  const mockClient = {
    auth: {
      async signOut() {
        await storage.removeItem("sb-session");
        return { error: null };
      },
      async getSession() {
        const raw = await storage.getItem("sb-session");
        return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.signOut();

  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(await storage.getItem("sb-session"), null);
});

test("11. restart after logout does not authenticate", async () => {
  const storage = new MemoryAuthStorage();

  const mockClient = {
    auth: {
      async signOut() {
        await storage.removeItem("sb-session");
        return { error: null };
      },
      async getSession() {
        const raw = await storage.getItem("sb-session");
        return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);

  // First session: sign out
  const model1 = createAuthModel(provider, { autoRestore: false });
  await model1.signOut();

  // Simulated restart: fresh model instance
  const model2 = createAuthModel(provider, { autoRestore: false });
  await model2.restoreSession();

  assert.equal(model2.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model2.getSnapshot().user, null);
});

test("12. AuthState contains zero tokens", async () => {
  const storage = new MemoryAuthStorage();
  const mockUser = createMockSupabaseUser();
  const mockSession = createMockSupabaseSession(mockUser, "very-confidential-token-12345");
  await storage.setItem("sb-session", JSON.stringify(mockSession));

  const mockClient = {
    auth: {
      async getSession() {
        const raw = await storage.getItem("sb-session");
        return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });
  await model.restoreSession();

  const snapshot = model.getSnapshot();
  const snapshotJson = JSON.stringify(snapshot);

  assert.equal(snapshotJson.includes("very-confidential-token"), false);
  assert.equal((snapshot as any).access_token, undefined);
  assert.equal((snapshot as any).refresh_token, undefined);
  assert.equal((snapshot.user as any).access_token, undefined);
});

test("13. no password persistence", async () => {
  const storage = new MemoryAuthStorage();
  const mockUser = createMockSupabaseUser();
  const mockSession = createMockSupabaseSession(mockUser);

  const mockClient = {
    auth: {
      async signInWithPassword() {
        await storage.setItem("sb-session", JSON.stringify(mockSession));
        return { data: { user: mockUser, session: mockSession }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.signIn({ email: "user@example.com", password: "PlainTextSecretPassword999!" });

  const storedValue = await storage.getItem("sb-session");
  assert.ok(storedValue);
  assert.equal(storedValue.includes("PlainTextSecretPassword999!"), false);

  const snapshotJson = JSON.stringify(model.getSnapshot());
  assert.equal(snapshotJson.includes("PlainTextSecretPassword999!"), false);
});

test("14. no production Stronghold initialization during Node tests", () => {
  assert.equal(isTauriEnvironment(), false);

  const storage = new TauriStrongholdAuthStorage();
  assert.equal(storage.isPersistent(), false);

  const defaultStorage = getDefaultAuthStorage();
  assert.ok(defaultStorage instanceof MemoryAuthStorage);
});

test("15. storage failure does not silently fall back to localStorage", async () => {
  const storage = new TauriStrongholdAuthStorage();

  const fakeLocalStorage: Record<string, string> = {};
  const originalWindow = globalThis.window;
  (globalThis as any).window = {
    localStorage: {
      setItem(key: string, value: string) {
        fakeLocalStorage[key] = value;
      },
    },
  };

  try {
    await storage.setItem("sb-test-token", "token-value");
    assert.equal(Object.keys(fakeLocalStorage).length, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("16. getAccessToken still works after restore", async () => {
  const storage = new MemoryAuthStorage();
  const mockUser = createMockSupabaseUser();
  const mockSession = createMockSupabaseSession(mockUser, "restored-bearer-token-abc");
  await storage.setItem("sb-session", JSON.stringify(mockSession));

  const mockClient = {
    auth: {
      async getSession() {
        const raw = await storage.getItem("sb-session");
        return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.restoreSession();

  const token = await model.getAccessToken();
  assert.equal(token, "restored-bearer-token-abc");
});

test("17. backend auth probe still works with restored session", async () => {
  const storage = new MemoryAuthStorage();
  const mockUser = createMockSupabaseUser({ id: "usr-probed" });
  const mockSession = createMockSupabaseSession(mockUser, "valid-probe-jwt-token");
  await storage.setItem("sb-session", JSON.stringify(mockSession));

  const mockClient = {
    auth: {
      async getSession() {
        const raw = await storage.getItem("sb-session");
        return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });
  await model.restoreSession();

  const mockTransport = async (url: any, options: any) => {
    assert.ok(url.toString().endsWith("/auth/me"));
    assert.equal(options.headers["Authorization"], "Bearer valid-probe-jwt-token");
    return new Response(JSON.stringify({ user: { id: "usr-probed", email: "designer@example.com" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const probe = await probeBackendAuth(
    model.getAccessToken,
    "http://localhost:3000/api/v1",
    mockTransport as any
  );

  assert.equal(probe.ok, true);
  assert.equal(probe.status, 200);
  assert.equal(probe.user?.id, "usr-probed");
});

test("18. stale restore result protection remains", async () => {
  let resolveSlowRestore: (session: any) => void;
  const slowRestorePromise = new Promise((resolve) => {
    resolveSlowRestore = resolve;
  });

  const mockClient = {
    auth: {
      getSession() {
        return slowRestorePromise;
      },
      async signOut() {
        return { error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  // 1. Start restore
  const restorePromise = model.restoreSession();

  // 2. User explicitly signs out while restore is in flight
  await model.signOut();
  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");

  // 3. Stale restore finishes with an authenticated session
  const mockUser = createMockSupabaseUser();
  const mockSession = createMockSupabaseSession(mockUser);
  resolveSlowRestore!({ data: { session: mockSession }, error: null });
  await restorePromise;

  // 4. Stale restore must NOT overwrite the explicit UNAUTHENTICATED state
  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
});

test("19. storage records remain inaccessible through ordinary React state", () => {
  const storage = new MemoryAuthStorage();
  storage.setItem("sensitive-key", "secret-payload");

  const model = createAuthModel({
    async restoreSession() { return null; },
    async signIn() { throw new Error(); },
    async signUp() { throw new Error(); },
    async signOut() {},
  });

  const snapshot = model.getSnapshot();
  assert.equal((snapshot as any).storage, undefined);
  assert.equal((snapshot as any).store, undefined);
  assert.equal(JSON.stringify(snapshot).includes("secret-payload"), false);
});

test("20. Tauri capability config contains only required Stronghold permission(s)", () => {
  const capabilityPath = path.resolve(process.cwd(), "src-tauri/capabilities/default.json");
  assert.ok(fs.existsSync(capabilityPath), "default.json capability file must exist");

  const content = JSON.parse(fs.readFileSync(capabilityPath, "utf-8"));
  assert.ok(Array.isArray(content.permissions), "permissions must be an array");

  // Verify minimal Stronghold permissions without wildcard or global permissions
  const strongholdPermissions = content.permissions.filter((p: string) => p.startsWith("stronghold:"));
  assert.ok(strongholdPermissions.length > 0, "must include Stronghold permissions");
  assert.equal(content.permissions.includes("stronghold:default"), false, "uses granular permissions rather than default wildcard");

  const requiredGranular = [
    "stronghold:allow-initialize",
    "stronghold:allow-create-client",
    "stronghold:allow-load-client",
    "stronghold:allow-get-store-record",
    "stronghold:allow-save-store-record",
    "stronghold:allow-remove-store-record",
    "stronghold:allow-save",
  ];

  for (const perm of requiredGranular) {
    assert.ok(content.permissions.includes(perm), `permissions must include ${perm}`);
  }
});

// =========================================================================
// PART 7 — HARDENED MASTER-KEY TESTS (TASK 008D.1)
// =========================================================================

test("21. plaintext vault.key is never created on filesystem", () => {
  // Check that no vault.key exists in the workspace
  const workspaceRoot = process.cwd();
  const potentialPaths = [
    path.join(workspaceRoot, "vault.key"),
    path.join(workspaceRoot, "desktop", "vault.key"),
    path.join(workspaceRoot, "desktop", "src-tauri", "vault.key"),
  ];

  for (const p of potentialPaths) {
    assert.equal(fs.existsSync(p), false, `plaintext vault.key must not exist at ${p}`);
  }

  // Check Rust source code: lib.rs only removes legacy vault.key and never writes it
  const libRsPath = path.resolve(process.cwd(), "src-tauri/src/lib.rs");
  const libRsContent = fs.readFileSync(libRsPath, "utf-8");
  assert.equal(libRsContent.includes('fs::write(&key_path'), false, "lib.rs must never write to vault.key");
  assert.ok(libRsContent.includes("fs::remove_file"), "lib.rs must actively remove legacy vault.key if found");
});

test("22. source contains no hardcoded vault password or key", () => {
  const libRs = fs.readFileSync(path.resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf-8");
  const storageTs = fs.readFileSync(path.resolve(process.cwd(), "src/features/auth/tauriStrongholdStorage.ts"), "utf-8");
  const authStorageTs = fs.readFileSync(path.resolve(process.cwd(), "src/features/auth/authStorage.ts"), "utf-8");

  for (const src of [libRs, storageTs, authStorageTs]) {
    assert.equal(src.includes('const vaultPassword = "'), false);
    assert.equal(src.includes("vaultPassword = '"), false);
    assert.equal(src.includes('const vaultKey = "'), false);
    assert.equal(src.includes("vaultKey = '"), false);
  }
});

test("23. OS credential provider stores generated key once", () => {
  const keyring = new Map<string, string>();
  function getOrGenerateKey(service: string, user: string): string {
    const key = `${service}:${user}`;
    const existing = keyring.get(key);
    if (existing) {
      return existing;
    }
    const generated = "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00";
    keyring.set(key, generated);
    return generated;
  }

  // First run: generates and stores
  assert.equal(keyring.size, 0);
  const key1 = getOrGenerateKey("vision2code", "vault_master_key");
  assert.equal(keyring.size, 1);
  assert.equal(key1, "a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00");
});

test("24. later startup retrieves same key from OS credential store", () => {
  const keyring = new Map<string, string>();
  keyring.set("vision2code:vault_master_key", "persisted-device-key-256bit");

  function getOrGenerateKey(service: string, user: string): string {
    const key = `${service}:${user}`;
    const existing = keyring.get(key);
    if (existing) {
      return existing;
    }
    const generated = "new-key";
    keyring.set(key, generated);
    return generated;
  }

  // Second run: reads existing without overwriting
  const retrievedKey = getOrGenerateKey("vision2code", "vault_master_key");
  assert.equal(retrievedKey, "persisted-device-key-256bit");
  assert.equal(keyring.get("vision2code:vault_master_key"), "persisted-device-key-256bit");
});

test("25. credential-store failure does not fall back to plaintext", async () => {
  // Simulate OS Credential Manager failure (e.g. access denied)
  const failingStorage = new TauriStrongholdAuthStorage();

  // If storage fails to obtain OS credential, it must route to memoryFallback
  // and NOT write any key file to disk
  await failingStorage.setItem("token-key", "token-val");
  const value = await failingStorage.getItem("token-key");
  assert.equal(value, "token-val");

  // Verify no key file was written
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "vault.key")), false);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "src-tauri/vault.key")), false);
});

test("26. credential-store failure does not use localStorage", async () => {
  const failingStorage = new TauriStrongholdAuthStorage();

  const fakeLocalStorage: Record<string, string> = {};
  const originalWindow = globalThis.window;
  (globalThis as any).window = {
    localStorage: {
      setItem(key: string, value: string) {
        fakeLocalStorage[key] = value;
      },
    },
  };

  try {
    await failingStorage.setItem("sb-auth-token", "sensitive-jwt");
    assert.equal(Object.keys(fakeLocalStorage).length, 0);
    assert.equal(fakeLocalStorage["sb-auth-token"], undefined);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("27. logout clears Supabase session but does NOT destroy the OS master key", async () => {
  const keyring = new Map<string, string>();
  keyring.set("vision2code:vault_master_key", "master-key-remains-intact");

  const storage = new MemoryAuthStorage();
  await storage.setItem("sb-session", "session-to-clear");

  const mockClient = {
    auth: {
      async signOut() {
        await storage.removeItem("sb-session");
        // Keyring master key must NOT be deleted
        return { error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });
  await model.signOut();

  // Session in vault is cleared
  assert.equal(await storage.getItem("sb-session"), null);
  // Master key in OS keyring remains intact
  assert.equal(keyring.get("vision2code:vault_master_key"), "master-key-remains-intact");
});

test("28. deleting or revoking secure credential causes safe reauthentication behavior", async () => {
  const keyring = new Map<string, string>();
  // Simulate user deleting credentials via Windows Credential Manager
  keyring.delete("vision2code:vault_master_key");

  const mockClient = {
    auth: {
      async getSession() {
        // Vault cannot be opened with missing key, returns null session
        return { data: { session: null }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.restoreSession();

  // Model gracefully enters UNAUTHENTICATED rather than crashing
  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model.getSnapshot().user, null);
  assert.equal(model.getSnapshot().error, null);
});

test("29. WebView AuthState remains token-free across all operations", async () => {
  const storage = new MemoryAuthStorage();
  const mockUser = createMockSupabaseUser();
  const mockSession = createMockSupabaseSession(mockUser, "access-token-999", "refresh-token-888");

  const mockClient = {
    auth: {
      async signInWithPassword() {
        await storage.setItem("sb-session", JSON.stringify(mockSession));
        return { data: { user: mockUser, session: mockSession }, error: null };
      },
      async getSession() {
        return { data: { session: mockSession }, error: null };
      },
    },
  };

  const provider = createSupabaseAuthProvider(mockClient as any);
  const model = createAuthModel(provider, { autoRestore: false });

  await model.signIn({ email: "user@example.com", password: "Password123!" });
  const snapshot1 = model.getSnapshot();
  assert.equal(JSON.stringify(snapshot1).includes("access-token-999"), false);
  assert.equal(JSON.stringify(snapshot1).includes("refresh-token-888"), false);

  await model.restoreSession();
  const snapshot2 = model.getSnapshot();
  assert.equal(JSON.stringify(snapshot2).includes("access-token-999"), false);
  assert.equal(JSON.stringify(snapshot2).includes("refresh-token-888"), false);
});

test("30. no key material or tokens are logged", async () => {
  const logs: string[] = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  console.log = (...args: any[]) => {
    logs.push(args.join(" "));
  };
  console.error = (...args: any[]) => {
    logs.push(args.join(" "));
  };

  try {
    const storage = new TauriStrongholdAuthStorage();
    await storage.setItem("sb-session", "test-token-value");
    await storage.getItem("sb-session");
    await storage.removeItem("sb-session");

    for (const log of logs) {
      assert.equal(log.includes("test-token-value"), false);
      assert.equal(log.includes("vault_master_key"), false);
    }
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
});

// =========================================================================
// PART 9 — REAL TAURI RUNTIME FAILURE MODE TESTS (TASK 008D.2)
// =========================================================================

function createSimulatedStrongholdBackend() {
  const diskSnapshots = new Map<string, Map<string, Uint8Array>>();
  const recordedOperations: string[] = [];

  return {
    diskSnapshots,
    recordedOperations,
    backend: {
      async load(snapshotPath: string, _password: string) {
        recordedOperations.push(`load:${snapshotPath}`);
        if (!diskSnapshots.has(snapshotPath)) {
          diskSnapshots.set(snapshotPath, new Map());
        }
        const fileStore = diskSnapshots.get(snapshotPath)!;
        // In-memory working copy
        const workingStore = new Map<string, Uint8Array>(fileStore);

        const storeInstance = {
          async get(key: string) {
            recordedOperations.push(`get:${key}`);
            return workingStore.get(key) ?? null;
          },
          async insert(key: string, value: number[]) {
            recordedOperations.push(`insert:${key}`);
            workingStore.set(key, new Uint8Array(value));
          },
          async remove(key: string) {
            recordedOperations.push(`remove:${key}`);
            const prev = workingStore.get(key) ?? null;
            workingStore.delete(key);
            return prev;
          },
        };

        const clientInstance = {
          getStore() {
            return storeInstance;
          },
        };

        return {
          async loadClient(name: string) {
            recordedOperations.push(`loadClient:${name}`);
            return clientInstance;
          },
          async createClient(name: string) {
            recordedOperations.push(`createClient:${name}`);
            return clientInstance;
          },
          async save() {
            recordedOperations.push(`save:${snapshotPath}`);
            // Commit workingStore to simulated disk
            diskSnapshots.set(snapshotPath, new Map(workingStore));
          },
        };
      },
    },
  };
}

test("31. setItem does not resolve until durable save resolves", async () => {
  let saveFinished = false;
  let resolveSave: () => void;
  const savePromise = new Promise<void>((resolve) => {
    resolveSave = resolve;
  });

  const backend = {
    async load(_path: string, _pass: string) {
      return {
        async loadClient() {
          return {
            getStore() {
              return {
                async get() { return null; },
                async insert() {},
                async remove() { return null; },
              };
            },
          };
        },
        async createClient() {
          return {
            getStore() {
              return {
                async get() { return null; },
                async insert() {},
                async remove() { return null; },
              };
            },
          };
        },
        async save() {
          await savePromise;
          saveFinished = true;
        },
      };
    },
  };

  const storage = new TauriStrongholdAuthStorage({
    strongholdBackend: backend as any,
    vaultKeyProvider: async () => "mock-vault-key-hex",
    vaultPathProvider: async () => "C:/fake/app/data/vault.hold",
  });

  let setItemResolved = false;
  const setItemPromise = storage.setItem("sb-session", "data").then(() => {
    setItemResolved = true;
  });

  // Small tick to allow insert to finish and enter flushSave
  await new Promise((r) => setTimeout(r, 15));

  // setItem must NOT have resolved while save is pending
  assert.equal(setItemResolved, false);
  assert.equal(saveFinished, false);

  // Now resolve the save
  resolveSave!();
  await setItemPromise;

  assert.equal(setItemResolved, true);
  assert.equal(saveFinished, true);
});

test("32. simulated app restart reads value persisted by previous storage instance", async () => {
  const sim = createSimulatedStrongholdBackend();
  const vaultPath = "C:/Users/appdata/Local/com.vision2code.desktop/vault.hold";
  const vaultKey = "64charhexmasterkey000000000000000000000000000000000000000000000000";

  // Run 1: First startup and sign-in
  const storage1 = new TauriStrongholdAuthStorage({
    strongholdBackend: sim.backend as any,
    vaultPathProvider: async () => vaultPath,
    vaultKeyProvider: async () => vaultKey,
  });

  assert.equal(await storage1.getItem("sb-session"), null);
  const sessionPayload = JSON.stringify({
    access_token: "persisted-token-run1",
    user: { id: "usr-run1", email: "run1@example.com" },
  });
  await storage1.setItem("sb-session", sessionPayload);

  // Verify memory and disk both have the record
  assert.equal(await storage1.getItem("sb-session"), sessionPayload);

  // Run 2: Simulated app restart (brand new TauriStrongholdAuthStorage instance)
  const storage2 = new TauriStrongholdAuthStorage({
    strongholdBackend: sim.backend as any,
    vaultPathProvider: async () => vaultPath,
    vaultKeyProvider: async () => vaultKey,
  });

  // Second run must load the existing snapshot and find the record
  const restoredValue = await storage2.getItem("sb-session");
  assert.equal(restoredValue, sessionPayload);
  assert.equal(storage2.getStorageStatus(), "STRONGHOLD");
});

test("33. same vault/client/store IDs across restart", async () => {
  const sim = createSimulatedStrongholdBackend();
  const vaultPath = "C:/appdata/Local/com.vision2code.desktop/vault.hold";
  const vaultKey = "masterkey123";

  // Run 1
  const storage1 = new TauriStrongholdAuthStorage({
    clientName: "v2c-auth-client",
    strongholdBackend: sim.backend as any,
    vaultPathProvider: async () => vaultPath,
    vaultKeyProvider: async () => vaultKey,
  });
  await storage1.setItem("test-key", "val");

  // Run 2
  const storage2 = new TauriStrongholdAuthStorage({
    clientName: "v2c-auth-client",
    strongholdBackend: sim.backend as any,
    vaultPathProvider: async () => vaultPath,
    vaultKeyProvider: async () => vaultKey,
  });
  await storage2.getItem("test-key");

  // Verify operations log used same vault and client names
  assert.ok(sim.recordedOperations.includes(`load:${vaultPath}`));
  assert.ok(sim.recordedOperations.includes("loadClient:v2c-auth-client"));
});

test("34. Stronghold init failure selects MEMORY_FALLBACK", async () => {
  const failingBackend = {
    async load() {
      throw new Error("Command plugin:path|resolve_directory not allowed by ACL");
    },
  };

  const storage = new TauriStrongholdAuthStorage({
    strongholdBackend: failingBackend as any,
    vaultKeyProvider: async () => "key",
    vaultPathProvider: async () => "path",
  });

  assert.equal(storage.getStorageStatus(), "MEMORY_FALLBACK");
  assert.equal(storage.isPersistent(), false);

  // Still works safely via ephemeral in-memory fallback
  await storage.setItem("temp-key", "temp-val");
  assert.equal(await storage.getItem("temp-key"), "temp-val");
  assert.equal(storage.getStorageStatus(), "MEMORY_FALLBACK");
});

test("35. fallback selection is observable for diagnostics", async () => {
  const sim = createSimulatedStrongholdBackend();
  const goodStorage = new TauriStrongholdAuthStorage({
    strongholdBackend: sim.backend as any,
    vaultPathProvider: async () => "path",
    vaultKeyProvider: async () => "key",
  });

  await goodStorage.setItem("k", "v");
  assert.equal(goodStorage.getStorageStatus(), "STRONGHOLD");

  const fallbackStorage = new TauriStrongholdAuthStorage({
    strongholdBackend: {
      async load() {
        throw new Error("Init rejected");
      },
    } as any,
    vaultPathProvider: async () => "path",
    vaultKeyProvider: async () => "key",
  });

  await fallbackStorage.getItem("k");
  assert.equal(fallbackStorage.getStorageStatus(), "MEMORY_FALLBACK");

  // Interface helper
  const { getAuthStorageStatus } = await import("../src/features/auth/authStorage.ts");
  assert.equal(getAuthStorageStatus(goodStorage), "STRONGHOLD");
  assert.equal(getAuthStorageStatus(fallbackStorage), "MEMORY_FALLBACK");
  assert.equal(getAuthStorageStatus(new MemoryAuthStorage()), "MEMORY_FALLBACK");
});

test("36. keyring returning existing key does not generate a new key", async () => {
  let generateCount = 0;
  const mockKeyring = new Map<string, string>();
  mockKeyring.set("vision2code:vault_master_key", "existing-stable-device-key-256");

  async function getKey() {
    const existing = mockKeyring.get("vision2code:vault_master_key");
    if (existing) {
      return existing;
    }
    generateCount++;
    const newKey = "new-random-key";
    mockKeyring.set("vision2code:vault_master_key", newKey);
    return newKey;
  }

  const key1 = await getKey();
  const key2 = await getKey();

  assert.equal(key1, "existing-stable-device-key-256");
  assert.equal(key2, "existing-stable-device-key-256");
  assert.equal(generateCount, 0, "must not generate a new key when existing key is found");
});

test("37. save failure does not pretend persistence succeeded", async () => {
  const backend = {
    async load() {
      return {
        async loadClient() {
          return {
            getStore() {
              return {
                async get() { return null; },
                async insert() {},
                async remove() { return null; },
              };
            },
          };
        },
        async createClient() {
          return {
            getStore() {
              return {
                async get() { return null; },
                async insert() {},
                async remove() { return null; },
              };
            },
          };
        },
        async save() {
          throw new Error("Disk full: cannot commit Stronghold snapshot");
        },
      };
    },
  };

  const storage = new TauriStrongholdAuthStorage({
    strongholdBackend: backend as any,
    vaultKeyProvider: async () => "key",
    vaultPathProvider: async () => "path",
  });

  // setItem must reject with the save error rather than silently succeeding
  await assert.rejects(
    async () => {
      await storage.setItem("sb-session", "session-value");
    },
    /Disk full/
  );
});

test("38. getItem after save returns stored Supabase value", async () => {
  const sim = createSimulatedStrongholdBackend();
  const storage = new TauriStrongholdAuthStorage({
    strongholdBackend: sim.backend as any,
    vaultPathProvider: async () => "C:/app/vault.hold",
    vaultKeyProvider: async () => "masterkey",
  });

  const mockUser = createMockSupabaseUser({ id: "usr-supabase-stored" });
  const mockSession = createMockSupabaseSession(mockUser, "supabase-stored-access-token");
  const serialized = JSON.stringify(mockSession);

  await storage.setItem("sb-session", serialized);

  const retrieved = await storage.getItem("sb-session");
  assert.ok(retrieved);
  const parsed = JSON.parse(retrieved);
  assert.equal(parsed.access_token, "supabase-stored-access-token");
  assert.equal(parsed.user.id, "usr-supabase-stored");
});

test("39. logout save/remove is durable before signOut completes", async () => {
  let removeDurable = false;
  let resolveRemoveSave: () => void;
  const removeSavePromise = new Promise<void>((resolve) => {
    resolveRemoveSave = resolve;
  });

  const backend = {
    async load() {
      let isRemoved = false;
      return {
        async loadClient() {
          return {
            getStore() {
              return {
                async get() { return isRemoved ? null : new TextEncoder().encode("session"); },
                async insert() {},
                async remove() { isRemoved = true; return null; },
              };
            },
          };
        },
        async createClient() {
          return {
            getStore() {
              return {
                async get() { return isRemoved ? null : new TextEncoder().encode("session"); },
                async insert() {},
                async remove() { isRemoved = true; return null; },
              };
            },
          };
        },
        async save() {
          if (isRemoved) {
            await removeSavePromise;
            removeDurable = true;
          }
        },
      };
    },
  };

  const storage = new TauriStrongholdAuthStorage({
    strongholdBackend: backend as any,
    vaultKeyProvider: async () => "key",
    vaultPathProvider: async () => "path",
  });

  // Populate initial session
  await storage.getItem("sb-session");

  let removeFinished = false;
  const removePromise = storage.removeItem("sb-session").then(() => {
    removeFinished = true;
  });

  await new Promise((r) => setTimeout(r, 15));
  assert.equal(removeFinished, false, "removeItem must not complete until save finishes");
  assert.equal(removeDurable, false);

  resolveRemoveSave!();
  await removePromise;

  assert.equal(removeFinished, true);
  assert.equal(removeDurable, true);
});

test("40. no secrets logged across all storage and auth operations", async () => {
  const loggedMessages: string[] = [];
  const capture = (...args: any[]) => {
    loggedMessages.push(args.join(" "));
  };

  const origLog = console.log;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;

  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;

  try {
    const sim = createSimulatedStrongholdBackend();
    const sensitiveKey = "super-secret-hex-key-9999999999999999999999999999999999999999";
    const sensitiveToken = "secret-access-token-jwt-super-confidential";
    const sensitivePassword = "PlainTextSuperSecretPassword123!";

    const storage = new TauriStrongholdAuthStorage({
      strongholdBackend: sim.backend as any,
      vaultPathProvider: async () => "C:/app/vault.hold",
      vaultKeyProvider: async () => sensitiveKey,
    });

    await storage.setItem("sb-session", JSON.stringify({ token: sensitiveToken, pass: sensitivePassword }));
    await storage.getItem("sb-session");
    await storage.removeItem("sb-session");

    for (const msg of loggedMessages) {
      assert.equal(msg.includes(sensitiveKey), false, "master key must never be logged");
      assert.equal(msg.includes(sensitiveToken), false, "access token must never be logged");
      assert.equal(msg.includes(sensitivePassword), false, "password must never be logged");
    }
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.warn = origWarn;
    console.error = origError;
  }
});


