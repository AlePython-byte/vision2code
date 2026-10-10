export type Theme = "light" | "dark";
export type Language = "es" | "en";
export interface Preferences { theme: Theme; language: Language }
export const PREFERENCES_KEY = "vision2code.preferences";
export function createPreferences(storage?: Pick<Storage, "getItem" | "setItem">) {
  let state: Preferences = { theme: "light", language: "es" };
  try {
    const saved: unknown = JSON.parse(storage?.getItem(PREFERENCES_KEY) ?? "null");
    if (saved && typeof saved === "object") {
      const value = saved as Partial<Preferences>;
      state = { theme: value.theme === "dark" ? "dark" : "light", language: value.language === "en" ? "en" : "es" };
    }
  } catch { /* Unavailable or corrupt storage must not prevent startup. */ }
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: Partial<Preferences>) {
      state = { ...state, ...next };
      try { storage?.setItem(PREFERENCES_KEY, JSON.stringify(state)); } catch { /* Continue with session-local preferences. */ }
      listeners.forEach((listener) => listener());
    },
  };
}
function localStorageIfAvailable() { try { return globalThis.localStorage; } catch { return undefined; } }
export const preferences = createPreferences(localStorageIfAvailable());
