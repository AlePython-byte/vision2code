import type { AuthStorage, AuthStorageStatus } from "./authStorage.ts";
import { MemoryAuthStorage } from "./authStorage.ts";

/**
 * Checks whether the current runtime environment is inside an active Tauri window.
 */
export function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// Only Vite's dev server: a packaged build (or a webview without `process`) never logs.
function isDebug(): boolean {
  return import.meta.env?.DEV === true;
}

function debugLog(...args: unknown[]): void {
  if (isDebug()) {
    console.info(...args);
  }
}

function debugWarn(...args: unknown[]): void {
  if (isDebug()) {
    console.warn(...args);
  }
}

function debugError(...args: unknown[]): void {
  if (isDebug()) {
    console.error(...args);
  }
}

export interface StrongholdStore {
  get(key: string): Promise<Uint8Array | null>;
  insert(key: string, value: number[], lifetime?: number): Promise<void>;
  remove(key: string): Promise<Uint8Array | null>;
}

export interface StrongholdClient {
  getStore(): StrongholdStore;
}

export interface StrongholdInstance {
  loadClient(name: string): Promise<StrongholdClient>;
  createClient(name: string): Promise<StrongholdClient>;
  save(): Promise<void>;
}

export interface StrongholdBackend {
  load(snapshotPath: string, password: string): Promise<StrongholdInstance>;
}

export interface StrongholdStorageOptions {
  clientName?: string | undefined;
  snapshotFileName?: string | undefined;
  vaultKeyProvider?: (() => Promise<string>) | undefined;
  vaultPathProvider?: (() => Promise<string>) | undefined;
  strongholdBackend?: StrongholdBackend | undefined;
}

/**
 * Secure Tauri storage adapter backed by official Tauri Stronghold (IOTA Stronghold).
 *
 * Security properties:
 * - Master key material is dynamically generated per-installation via OS-level RNG and Argon2 salt,
 *   never a fixed hardcoded string literal in source code.
 * - Snapshots are persisted strictly in the OS application local data directory.
 * - Zero tokens are ever stored in WebView localStorage or sessionStorage.
 * - Concurrency: save operations are serialized to prevent snapshot file corruption.
 * - Fallback: If Tauri or Stronghold is unavailable, gracefully falls back to an isolated in-memory
 *   store for the lifetime of the session. NEVER falls back to WebView localStorage.
 */
export class TauriStrongholdAuthStorage implements AuthStorage {
  private readonly clientName: string;
  private readonly snapshotFileName: string;
  private readonly customKeyProvider?: (() => Promise<string>) | undefined;
  private readonly customPathProvider?: (() => Promise<string>) | undefined;
  private readonly customBackend?: StrongholdBackend | undefined;
  private readonly memoryFallback = new MemoryAuthStorage();

  private storeInstance: StrongholdStore | null = null;
  private strongholdInstance: StrongholdInstance | null = null;
  private initPromise: Promise<void> | null = null;
  private initError: Error | null = null;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(options: StrongholdStorageOptions = {}) {
    this.clientName = options.clientName ?? "v2c-auth-client";
    this.snapshotFileName = options.snapshotFileName ?? "vault.hold";
    this.customKeyProvider = options.vaultKeyProvider;
    this.customPathProvider = options.vaultPathProvider;
    this.customBackend = options.strongholdBackend;
  }

  /**
   * Lazily initializes Stronghold when first needed.
   * Never runs during module import or in test environments unless backend is injected.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.storeInstance) {
      return;
    }
    if (this.initError) {
      return;
    }

    if (!isTauriEnvironment() && !this.customBackend) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          debugLog("[Stronghold] initialization started");

          // 1. Resolve snapshot path via backend get_vault_path command (matches app_local_data_dir exactly)
          // or fallback to path plugin appLocalDataDir if available
          let snapshotPath: string;
          if (this.customPathProvider) {
            snapshotPath = await this.customPathProvider();
          } else {
            const { invoke } = await import("@tauri-apps/api/core");
            try {
              snapshotPath = await invoke<string>("get_vault_path");
            } catch {
              const { appLocalDataDir } = await import("@tauri-apps/api/path");
              const localDir = await appLocalDataDir();
              const cleanDir = localDir.replace(/[/\\]+$/, "");
              snapshotPath = `${cleanDir}/${this.snapshotFileName}`;
            }
          }

          // 2. Retrieve installation-unique 256-bit key from Tauri backend
          let vaultKey: string;
          if (this.customKeyProvider) {
            vaultKey = await this.customKeyProvider();
          } else {
            const { invoke } = await import("@tauri-apps/api/core");
            vaultKey = await invoke<string>("get_vault_key");
          }
          debugLog("[Stronghold] credential key retrieved:", vaultKey ? "yes" : "no");

          // 3. Load or initialize Stronghold snapshot
          let stronghold: StrongholdInstance;
          if (this.customBackend) {
            stronghold = await this.customBackend.load(snapshotPath, vaultKey);
          } else {
            const { Stronghold } = await import("@tauri-apps/plugin-stronghold");
            stronghold = (await Stronghold.load(snapshotPath, vaultKey)) as unknown as StrongholdInstance;
          }
          this.strongholdInstance = stronghold;
          debugLog("[Stronghold] vault loaded: yes");

          // 4. Load or create client
          let client: StrongholdClient;
          try {
            client = await stronghold.loadClient(this.clientName);
            debugLog("[Stronghold] client loaded");
          } catch {
            client = await stronghold.createClient(this.clientName);
            debugLog("[Stronghold] client created");
          }

          this.storeInstance = client.getStore();
          debugLog("[AuthStorage] selected backend: stronghold");
        } catch (err) {
          this.initError = err instanceof Error ? err : new Error(String(err));
          debugWarn(
            "[AuthStorage] Stronghold unavailable — using ephemeral memory fallback",
            this.initError.name ?? "Error"
          );
          debugLog("[AuthStorage] selected backend: memory");
        }
      })();
    }

    await this.initPromise;
  }

  private async flushSave(): Promise<void> {
    if (!this.strongholdInstance) {
      return;
    }
    const currentSave = this.saveQueue.then(async () => {
      await this.strongholdInstance!.save();
      debugLog("[Stronghold] snapshot save succeeded");
    });
    this.saveQueue = currentSave.catch((err) => {
      debugError(
        "[Stronghold] snapshot save failed",
        err instanceof Error ? err.name : "Error"
      );
    });
    await currentSave;
  }

  async getItem(key: string): Promise<string | null> {
    debugLog("[Stronghold] getItem called");
    await this.ensureInitialized();

    if (!this.storeInstance) {
      const val = await this.memoryFallback.getItem(key);
      debugLog(`[Stronghold] record exists: ${val !== null ? "yes" : "no"}`);
      return val;
    }

    try {
      const bytes: Uint8Array | null = await this.storeInstance.get(key);
      if (!bytes || bytes.length === 0) {
        debugLog("[Stronghold] record exists: no");
        return null;
      }
      debugLog("[Stronghold] record exists: yes");
      return new TextDecoder().decode(bytes);
    } catch {
      debugLog("[Stronghold] record exists: no");
      return this.memoryFallback.getItem(key);
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    debugLog("[Stronghold] setItem called");
    await this.ensureInitialized();

    if (!this.storeInstance) {
      this.memoryFallback.setItem(key, value);
      return;
    }

    try {
      const data = Array.from(new TextEncoder().encode(value));
      await this.storeInstance.insert(key, data);
      await this.flushSave();
    } catch (err) {
      this.memoryFallback.setItem(key, value);
      throw err;
    }
  }

  async removeItem(key: string): Promise<void> {
    debugLog("[Stronghold] removeItem called");
    await this.ensureInitialized();

    if (!this.storeInstance) {
      this.memoryFallback.removeItem(key);
      debugLog("[Stronghold] removeItem succeeded");
      return;
    }

    try {
      await this.storeInstance.remove(key);
      await this.flushSave();
      debugLog("[Stronghold] removeItem succeeded");
    } catch (err) {
      this.memoryFallback.removeItem(key);
      debugError(
        "[Stronghold] removeItem failed",
        err instanceof Error ? err.name : "Error"
      );
      throw err;
    }
  }

  /**
   * Returns observable status ("STRONGHOLD" or "MEMORY_FALLBACK").
   */
  getStorageStatus(): AuthStorageStatus {
    return Boolean(this.storeInstance && !this.initError)
      ? "STRONGHOLD"
      : "MEMORY_FALLBACK";
  }

  /**
   * Returns true if Stronghold is active and persistent, or false if in memory fallback.
   */
  isPersistent(): boolean {
    return this.getStorageStatus() === "STRONGHOLD";
  }
}

let defaultAuthStorage: AuthStorage | null = null;

/**
 * Returns the default AuthStorage for the application lifecycle.
 */
export function getDefaultAuthStorage(): AuthStorage {
  if (defaultAuthStorage) {
    return defaultAuthStorage;
  }

  if (isTauriEnvironment()) {
    defaultAuthStorage = new TauriStrongholdAuthStorage();
  } else {
    defaultAuthStorage = new MemoryAuthStorage();
  }

  return defaultAuthStorage;
}

/**
 * Allows overriding or resetting the default auth storage for deterministic testing.
 */
export function setDefaultAuthStorageForTesting(storage: AuthStorage | null): void {
  defaultAuthStorage = storage;
}
