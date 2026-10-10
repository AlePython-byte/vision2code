import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { preferences } from "./preferences.ts";
import { es, en } from "./resources.ts";

export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources: { es: { translation: es }, en: { translation: en } },
  lng: preferences.getSnapshot().language, fallbackLng: "es", supportedLngs: ["es", "en"],
  interpolation: { escapeValue: false }, initAsync: false,
});
function applyPreferences() {
  const { theme, language } = preferences.getSnapshot();
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;
  }
  if (i18n.language !== language) void i18n.changeLanguage(language);
}
applyPreferences();
preferences.subscribe(applyPreferences);
