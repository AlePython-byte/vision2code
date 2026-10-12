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
}

/**
 * Deterministic in-memory storage test double and non-persistent fallback.
 * Guarantees zero leakage to disk, WebView localStorage, or sessionStorage.
 */
export class MemoryAuthStorage implements AuthStorage {
  private readonly store = new Map<string, string>();

  getStorageStatus(): AuthStorageStatus {
    return "MEMORY_FALLBACK";
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
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

