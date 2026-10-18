// "Cerrar sesión" -> close -> reopen must show the login. Reproduces the reported bug with a simulated Stronghold disk: the
// Supabase SDK (auth-js 2.117) only removes the stored session AFTER its POST /logout answers, while the UI already
// showed the login; closing the app in between left the session in vault.hold and the next start restored it.
import test from "node:test";
import assert from "node:assert/strict";
import { createAuthModel, type AuthModel } from "../src/features/auth/authModel.ts";
import { createSupabaseAuthProvider } from "../src/features/auth/supabaseAuthProvider.ts";
import { TauriStrongholdAuthStorage } from "../src/features/auth/tauriStrongholdStorage.ts";
import { getSupabaseClient, supabaseAuthStorageKey } from "../src/features/auth/supabaseClient.ts";
import { MemoryAuthStorage } from "../src/features/auth/authStorage.ts";

const KEY = "sb-testproject-auth-token";
const USER = { id: "usr-signout-1", email: "designer@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", aud: "authenticated" };

function sessionJson(accessToken: string): string {
  return JSON.stringify({
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: USER,
  });
}

/** A vault file on a fake disk: each `open()` is a new app start that loads what the last successful save wrote. */
function simulatedVault() {
  const disk = new Map<string, Uint8Array>();
  let failSaves = false;
  let saves = 0;
  const backend = {
    async load() {
      const working = new Map(disk);
      const store = {
        async get(key: string) { return working.get(key) ?? null; },
        async insert(key: string, value: number[]) { working.set(key, new Uint8Array(value)); },
        async remove(key: string) { const previous = working.get(key) ?? null; working.delete(key); return previous; },
      };
      const client = { getStore: () => store };
      return {
        async loadClient() { return client; },
        async createClient() { return client; },
        async save() {
          saves += 1;
          if (failSaves) throw new Error("Disk full: cannot commit Stronghold snapshot");
          disk.clear();
          for (const [key, value] of working) disk.set(key, value);
        },
      };
    },
  };
  return {
    open: () => new TauriStrongholdAuthStorage({
      strongholdBackend: backend,
      vaultKeyProvider: async () => "disposable-test-key",
      vaultPathProvider: async () => "C:/disposable/vault.hold",
    }),
    failSaves(value: boolean) { failSaves = value; },
    get saves() { return saves; },
  };
}

/** Same order as auth-js `_signOut`: read the stored session, wait for POST /logout, only then remove it locally. */
function fakeSupabaseClient(storage: TauriStrongholdAuthStorage, logout: Promise<void> = Promise.resolve()) {
  return {
    auth: {
      async getSession() {
        const raw = await storage.getItem(KEY);
        return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
      },
      async signInWithPassword() {
        const raw = sessionJson("new-access");
        await storage.setItem(KEY, raw);
        return { data: { user: USER, session: JSON.parse(raw) }, error: null };
      },
      async signOut() {
        if (await storage.getItem(KEY)) await logout;
        await storage.removeItem(KEY);
        await storage.removeItem(`${KEY}-code-verifier`);
        await storage.removeItem(`${KEY}-user`);
        return { error: null };
      },
    },
  } as any;
}

function start(storage: TauriStrongholdAuthStorage, logout?: Promise<void>): AuthModel {
  const provider = createSupabaseAuthProvider(fakeSupabaseClient(storage, logout), { storage, storageKey: KEY, remoteSignOutWaitMs: 5 });
  return createAuthModel(provider, { autoRestore: false });
}

function waitForStatus(model: AuthModel, status: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (model.getSnapshot().status === status) return resolve();
    const timer = setTimeout(() => { stop(); reject(new Error(`status stayed ${model.getSnapshot().status}`)); }, 1000);
    const stop = model.subscribe(() => {
      if (model.getSnapshot().status === status) { clearTimeout(timer); stop(); resolve(); }
    });
  });
}

const never = new Promise<void>(() => {});

test("Cerrar sesión, then closing before the server answers: the next start shows the login", async () => {
  const vault = simulatedVault();
  const first = vault.open();
  await first.setItem(KEY, sessionJson("old-access"));
  const model = start(first, never);
  await model.restoreSession();
  assert.equal(model.getSnapshot().status, "AUTHENTICATED");

  void model.signOut();
  await waitForStatus(model, "UNAUTHENTICATED");
  // The app is closed here: POST /logout never answered.

  const reopened = vault.open();
  assert.equal(await reopened.getItem(KEY), null, "the session must be gone from disk once the login is shown");
  const next = start(reopened);
  await next.restoreSession();
  assert.equal(next.getSnapshot().status, "UNAUTHENTICATED");
});

test("while the vault is being cleared the model says SIGNING_OUT, not signed out", async () => {
  const vault = simulatedVault();
  const storage = vault.open();
  await storage.setItem(KEY, sessionJson("old-access"));
  const model = start(storage, never);
  await model.restoreSession();

  const done = model.signOut();
  assert.equal(model.getSnapshot().status, "SIGNING_OUT");
  assert.equal(model.getSnapshot().user, null, "the workspace is unmounted at once");
  await done;
  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model.getSnapshot().error, null);
});

test("a session write that lands after signOut (late refresh) never reaches the disk", async () => {
  const vault = simulatedVault();
  const storage = vault.open();
  await storage.setItem(KEY, sessionJson("old-access"));
  const model = start(storage);
  await model.restoreSession();
  await model.signOut();

  // e.g. a TOKEN_REFRESHED that was already in flight when the user pressed Cerrar sesión.
  await storage.setItem(KEY, sessionJson("refreshed-access"));

  assert.equal(await storage.getItem(KEY), null);
  assert.equal(await vault.open().getItem(KEY), null);
});

test("if the vault cannot be written the session still leaves memory and the user is told", async () => {
  const vault = simulatedVault();
  const storage = vault.open();
  await storage.setItem(KEY, sessionJson("old-access"));
  const model = start(storage);
  await model.restoreSession();

  vault.failSaves(true);
  await model.signOut();

  assert.equal(model.getSnapshot().status, "UNAUTHENTICATED");
  assert.equal(model.getSnapshot().error, "SIGN_OUT_NOT_PERSISTED");
  assert.equal(await storage.getItem(KEY), null, "nothing can be read from memory after signOut");
  assert.equal(await model.getAccessToken(), null);
});

test("a valid session is still restored on the next start, and signing in again after Cerrar sesión is persisted", async () => {
  const vault = simulatedVault();
  const first = vault.open();
  const model = start(first);
  await model.signIn({ email: "designer@example.com", password: "Password123!" });
  assert.equal(model.getSnapshot().status, "AUTHENTICATED");

  const second = start(vault.open());
  await second.restoreSession();
  assert.equal(second.getSnapshot().status, "AUTHENTICATED", "012E persistence keeps working");

  await model.signOut();
  await model.signIn({ email: "designer@example.com", password: "Password123!" });
  assert.equal(model.getSnapshot().status, "AUTHENTICATED");
  const third = start(vault.open());
  await third.restoreSession();
  assert.equal(third.getSnapshot().status, "AUTHENTICATED", "the new session is written once the user signs in again");
});

test("signOut still asks the server to revoke the session", async () => {
  const vault = simulatedVault();
  const storage = vault.open();
  await storage.setItem(KEY, sessionJson("old-access"));
  let revoked = false;
  const client = fakeSupabaseClient(storage);
  const original = client.auth.signOut;
  client.auth.signOut = async () => { revoked = true; return original(); };
  const model = createAuthModel(createSupabaseAuthProvider(client, { storage, storageKey: KEY }), { autoRestore: false });
  await model.restoreSession();
  await model.signOut();
  assert.equal(revoked, true);
});

test("the client stores the session under the key the provider clears (same as the SDK default)", () => {
  assert.equal(supabaseAuthStorageKey("https://abcdefgh.supabase.co"), "sb-abcdefgh-auth-token");
  const client = getSupabaseClient({ url: "https://abcdefgh.supabase.co", publishableKey: "sb_publishable_test" }, new MemoryAuthStorage());
  assert.equal((client!.auth as any).storageKey, "sb-abcdefgh-auth-token");
});

test("removing keys that are not there writes nothing (each real save rewrites the snapshot, ~2 s)", async () => {
  const vault = simulatedVault();
  const storage = vault.open();
  await storage.setItem(KEY, sessionJson("old-access"));
  const before = vault.saves;
  await storage.removeItem(`${KEY}-code-verifier`);
  await storage.removeItem(`${KEY}-user`);
  assert.equal(vault.saves, before);
  await storage.removeItem(KEY);
  assert.equal(vault.saves, before + 1);
  await storage.clearSession([KEY, `${KEY}-user`]);
  assert.equal(vault.saves, before + 1, "the session was already off the disk");
  assert.equal(await vault.open().getItem(KEY), null);
});

test("clearSession persists what an earlier failed save left behind", async () => {
  const vault = simulatedVault();
  const storage = vault.open();
  await storage.setItem(KEY, sessionJson("old-access"));
  vault.failSaves(true);
  await assert.rejects(storage.removeItem(KEY));
  assert.ok(await vault.open().getItem(KEY), "the failed save left the session on disk");

  vault.failSaves(false);
  await storage.clearSession([KEY]);
  assert.equal(await vault.open().getItem(KEY), null);
});
