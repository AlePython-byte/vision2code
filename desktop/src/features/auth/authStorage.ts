export type AuthStorageStatus = "STRONGHOLD" | "MEMORY_FALLBACK";

/**
 * Interface conforming to Supabase's SupportedStorage contract.
 * Used to decouple session persistence from browser/WebView localStorage.
 */
export interface AuthStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
  getStorageStatus?(): AuthStorageStatus;
  /** True once it is known that the session will NOT survive closing the app (memory only). False while still deciding. */
  isSessionEphemeral?(): boolean;
  /** Notifies when `isSessionEphemeral()` may have changed. */
  subscribeStorageStatus?(listener: () => void): () => void;
  /**
   * Sign-out: removes `keys` and resolves only once that removal is persisted. From the call on, reads return null
   * and writes are ignored until `allowSessionWrites()`, so a late token refresh cannot bring the session back.
   * On a persistence failure the keys are already unreadable and the error is thrown.
   */
  clearSession?(keys: readonly string[]): Promise<void>;
  /** A new sign-in or sign-up starts: writes are accepted again. */
  allowSessionWrites?(): void;
}

/** Observable view of `isSessionEphemeral` for the UI (framework-free: getSnapshot / subscribe). */
export interface SessionPersistenceStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): boolean;
}

export function createSessionPersistenceStore(storage: AuthStorage): SessionPersistenceStore {
  return {
    subscribe: (listener) => storage.subscribeStorageStatus?.(listener) ?? (() => {}),
    getSnapshot: () => storage.isSessionEphemeral?.() ?? false,
  };
}

/**
 * Deterministic in-memory storage test double and non-persistent fallback.
 * Guarantees zero leakage to disk, WebView localStorage, or sessionStorage.
 */
export class MemoryAuthStorage implements AuthStorage {
  private readonly store = new Map<string, string>();
  private sealed = false;

  getStorageStatus(): AuthStorageStatus {
    return "MEMORY_FALLBACK";
  }

  isSessionEphemeral(): boolean {
    return true;
  }

  subscribeStorageStatus(): () => void {
    return () => {};
  }

  getItem(key: string): string | null {
    if (this.sealed) return null;
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.sealed) return;
    this.store.set(key, value);
  }

  async clearSession(keys: readonly string[]): Promise<void> {
    this.sealed = true;
    for (const key of keys) this.store.delete(key);
  }

  allowSessionWrites(): void {
    this.sealed = false;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  get size(): number {
    return this.store.size;
  }
}

/**
 * Clean-break strategy: Purges any legacy Supabase session records from
 * WebView localStorage so that no residual access/refresh tokens remain in browser storage.
 */
export function cleanLegacyLocalStorage(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith("sb-") || key.includes("supabase.auth.token"))) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Silently ignore storage access restrictions (e.g. sandboxed iframes)
  }
}

/**
 * Returns the observable storage status of the given AuthStorage instance.
 */
export function getAuthStorageStatus(storage?: AuthStorage): AuthStorageStatus {
  if (storage && typeof storage.getStorageStatus === "function") {
    return storage.getStorageStatus();
  }
  return "MEMORY_FALLBACK";
}

