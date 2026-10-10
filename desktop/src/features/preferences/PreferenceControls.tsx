import { useSyncExternalStore } from "react";
import { Languages, Sun, Moon } from "lucide-react";
import { preferences } from "./preferences";
import { useLabels } from "./useLabels";

export function PreferenceControls() {
  const { t } = useLabels();
  const state = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  return <div className="preference-controls" role="group" aria-label={t("preferences")}>
    <label><span>{state.theme === "light" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}{t("theme")}</span>
      <select value={state.theme} onChange={(event) => preferences.set({ theme: event.target.value === "dark" ? "dark" : "light" })}>
        <option value="light">{t("light")}</option><option value="dark">{t("dark")}</option>
      </select>
    </label>
    <label><span><Languages aria-hidden="true" />{t("language")}</span>
      <select value={state.language} onChange={(event) => preferences.set({ language: event.target.value === "en" ? "en" : "es" })}>
        <option value="es">Español</option><option value="en">English</option>
      </select>
    </label>
  </div>;
}
