import { useSyncExternalStore, useState } from "react";
import { Sun, Moon, Languages, Palette, HardDrive, Laptop, RotateCcw, Check, TriangleAlert } from "lucide-react";
import { preferences, type Theme, type Language } from "../preferences/preferences";
import { useLabels } from "../preferences/useLabels";
import type { AuthUser } from "../auth/authTypes.ts";
import { GeneratedAvatar } from "../account/GeneratedAvatar";

export function SettingsScreen({ sessionNotSaved = false, user = null }: { sessionNotSaved?: boolean; user?: AuthUser | null } = {}) {
  const { t } = useLabels();
  const state = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  function setTheme(theme: Theme) {
    preferences.set({ theme });
    setStatusMessage(null);
  }

  function setLanguage(language: Language) {
    preferences.set({ language });
    setStatusMessage(null);
  }

  function handleReset() {
    preferences.set({ theme: "light", language: "es" });
    setStatusMessage(t("defaultsRestored"));
  }

  return (
    <main id="settings-workspace" className="workspace settings-workspace" tabIndex={-1}>
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">{t("settingsEyebrow")}</p>
          <h1>{t("settingsTitle")}</h1>
          <p className="workspace-intro">{t("settingsIntro")}</p>
        </div>
        <span className="workspace-badge">
          <span className="status-dot green" />
          {t("settingsBadge")}
        </span>
      </header>

      {sessionNotSaved && (
        <div className="session-notice" role="status">
          <TriangleAlert aria-hidden="true" />
          <div>
            <p className="session-notice-title">{t("sessionNotSaved")}</p>
            <p className="session-notice-help">{t("sessionNotSavedHelp")}</p>
          </div>
        </div>
      )}

      <div className="settings-grid">
        <section className="raised-panel settings-section" aria-labelledby="appearance-title">
          <header className="frame-header">
            <div>
              <p className="eyebrow">{t("appearanceEyebrow")}</p>
              <h2 id="appearance-title">{t("appearanceSection")}</h2>
            </div>
            <span className="panel-badge">{state.theme === "light" ? t("light") : t("dark")}</span>
          </header>
          <p className="settings-section-desc">{t("appearanceHelp")}</p>

          <div className="setting-options-grid" role="radiogroup" aria-label={t("appearanceAria")}>
            <button
              type="button"
              role="radio"
              aria-checked={state.theme === "light"}
              className={`setting-card ${state.theme === "light" ? "active" : ""}`}
              onClick={() => setTheme("light")}
            >
              <div className="setting-card-header">
                <div className="setting-card-lead">
                  <span className="setting-card-icon" aria-hidden="true"><Sun /></span>
                  <div>
                    <h3 className="setting-card-title">{t("lightTheme")}</h3>
                    <p className="setting-card-spec">{t("lightThemeSpec")}</p>
                  </div>
                </div>
                <div className="setting-indicator" aria-hidden="true">
                  <span className="setting-indicator-dot" />
                  <span>{state.theme === "light" ? t("activeState") : t("inactiveState")}</span>
                </div>
              </div>
              <p className="setting-card-desc">{t("lightThemeDesc")}</p>
              <div className="setting-spec-tag">
                <span className="theme-swatch light-swatch" aria-hidden="true" />
                <span>#E8EDF2 · #7662F5</span>
              </div>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={state.theme === "dark"}
              className={`setting-card ${state.theme === "dark" ? "active" : ""}`}
              onClick={() => setTheme("dark")}
            >
              <div className="setting-card-header">
                <div className="setting-card-lead">
                  <span className="setting-card-icon" aria-hidden="true"><Moon /></span>
                  <div>
                    <h3 className="setting-card-title">{t("darkTheme")}</h3>
                    <p className="setting-card-spec">{t("darkThemeSpec")}</p>
                  </div>
                </div>
                <div className="setting-indicator" aria-hidden="true">
                  <span className="setting-indicator-dot" />
                  <span>{state.theme === "dark" ? t("activeState") : t("inactiveState")}</span>
                </div>
              </div>
              <p className="setting-card-desc">{t("darkThemeDesc")}</p>
              <div className="setting-spec-tag">
                <span className="theme-swatch dark-swatch" aria-hidden="true" />
                <span>#171D27 · #7662F5</span>
              </div>
            </button>
          </div>
        </section>

        <section className="raised-panel settings-section" aria-labelledby="language-title">
          <header className="frame-header">
            <div>
              <p className="eyebrow">{t("languageEyebrow")}</p>
              <h2 id="language-title">{t("languageSection")}</h2>
            </div>
            <span className="panel-badge">{state.language === "es" ? "ES" : "EN"}</span>
          </header>
          <p className="settings-section-desc">{t("languageHelp")}</p>

          <div className="setting-options-grid" role="radiogroup" aria-label={t("languageAria")}>
            <button
              type="button"
              role="radio"
              aria-checked={state.language === "es"}
              className={`setting-card ${state.language === "es" ? "active" : ""}`}
              onClick={() => setLanguage("es")}
            >
              <div className="setting-card-header">
                <div className="setting-card-lead">
                  <span className="setting-card-icon" aria-hidden="true"><Languages /></span>
                  <div>
                    <h3 className="setting-card-title">{t("spanishLanguage")}</h3>
                    <p className="setting-card-spec">{t("spanishLanguageSpec")}</p>
                  </div>
                </div>
                <div className="setting-indicator" aria-hidden="true">
                  <span className="setting-indicator-dot" />
                  <span>{state.language === "es" ? t("activeState") : t("inactiveState")}</span>
                </div>
              </div>
              <p className="setting-card-desc">{t("spanishLanguageDesc")}</p>
              <div className="setting-spec-tag">
                <span>es-ES · i18next</span>
              </div>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={state.language === "en"}
              className={`setting-card ${state.language === "en" ? "active" : ""}`}
              onClick={() => setLanguage("en")}
            >
              <div className="setting-card-header">
                <div className="setting-card-lead">
                  <span className="setting-card-icon" aria-hidden="true"><Languages /></span>
                  <div>
                    <h3 className="setting-card-title">{t("englishLanguage")}</h3>
                    <p className="setting-card-spec">{t("englishLanguageSpec")}</p>
                  </div>
                </div>
                <div className="setting-indicator" aria-hidden="true">
                  <span className="setting-indicator-dot" />
                  <span>{state.language === "en" ? t("activeState") : t("inactiveState")}</span>
                </div>
              </div>
              <p className="setting-card-desc">{t("englishLanguageDesc")}</p>
              <div className="setting-spec-tag">
                <span>en-US · i18next</span>
              </div>
            </button>
          </div>
        </section>

        <section className="raised-panel settings-section" aria-labelledby="telemetry-title">
          <header className="frame-header">
            <div>
              <p className="eyebrow">{t("telemetryEyebrow")}</p>
              <h2 id="telemetry-title">{t("telemetrySection")}</h2>
            </div>
            <span className="panel-badge"><span className="status-dot green" /> ONLINE</span>
          </header>
          <p className="settings-section-desc">{t("telemetryHelp")}</p>

          <dl className="telemetry-grid">
            <div className="telemetry-item">
              <dt>{t("activeThemeLabel")}</dt>
              <dd><Palette aria-hidden="true" /> {state.theme === "light" ? t("lightTheme") : t("darkTheme")}</dd>
            </div>
            <div className="telemetry-item">
              <dt>{t("activeLanguageLabel")}</dt>
              <dd><Languages aria-hidden="true" /> {state.language === "es" ? "Español (es-ES)" : "English (en-US)"}</dd>
            </div>
            <div className="telemetry-item">
              <dt>{t("persistenceLabel")}</dt>
              <dd><HardDrive aria-hidden="true" /> {t("persistenceSynced")}</dd>
            </div>
            <div className="telemetry-item">
              <dt>{t("runtimeLabel")}</dt>
              <dd><Laptop aria-hidden="true" /> {t("runtimeValue")}</dd>
            </div>
          </dl>

          <footer className="settings-actions">
            <button
              type="button"
              className="action-button secondary-button"
              onClick={handleReset}
              aria-label={t("resetDefaults")}
            >
              <RotateCcw aria-hidden="true" />
              {t("resetDefaults")}
            </button>
            {statusMessage && (
              <span className="settings-feedback" role="status" aria-live="polite">
                <Check aria-hidden="true" /> {statusMessage}
              </span>
            )}
          </footer>
        </section>

        {user && (
          <section className="raised-panel settings-section" aria-labelledby="account-title">
            <header className="frame-header">
              <div>
                <p className="eyebrow">{t("accountEyebrow")}</p>
                <h2 id="account-title">{t("accountSection")}</h2>
              </div>
              <GeneratedAvatar seed={user.id} size="sm" />
            </header>
            <p className="settings-section-desc">{t("accountHelp")}</p>
            <dl className="telemetry-grid">
              <div className="telemetry-item">
                <dt>{t("accountEmailLabel")}</dt>
                <dd className="account-email-value">{user.email}</dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </main>
  );
}

