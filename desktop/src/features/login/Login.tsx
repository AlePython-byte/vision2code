import { useState, useSyncExternalStore } from "react";
import {
  Eye,
  EyeOff,
  Mail,
  LockKeyhole,
  ArrowRight,
  ScanLine,
  Code2,
  Layers,
  AlertCircle,
  MailCheck,
} from "lucide-react";
import { PreferenceControls } from "../preferences/PreferenceControls";
import { useLabels } from "../preferences/useLabels";
import type { AuthModel } from "../auth/authModel.ts";
import { probeBackendAuth } from "../auth/authProbe.ts";

export interface LoginProps {
  readonly authModel?: AuthModel | undefined;
  readonly onDemo?: (() => void) | undefined;
  readonly onAuthSuccess?: (() => void) | undefined;
}

export function Login({ authModel, onDemo, onAuthSuccess }: LoginProps) {
  const { t } = useLabels();
  const authState = authModel
    ? useSyncExternalStore(authModel.subscribe, authModel.getSnapshot, authModel.getSnapshot)
    : { status: "UNAUTHENTICATED" as const, user: null, error: null, revision: 0 };

  const isConfigured = Boolean(authModel);
  const [mode, setMode] = useState<"SIGN_IN" | "REGISTER">("SIGN_IN");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Restoring session state: do not flash login form before restore completes
  if (authState.status === "RESTORING") {
    return (
      <main className="auth-restoring-shell" role="status" aria-live="polite">
        <div className="auth-restoring-card raised-panel">
          <div className="auth-spinner" aria-hidden="true" />
          <p className="eyebrow">{t("restoringSession")}</p>
        </div>
      </main>
    );
  }

  function switchMode(newMode: "SIGN_IN" | "REGISTER") {
    setMode(newMode);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setLocalError(null);
    authModel?.clearError();
  }

  function handleReturnToSignIn() {
    if (authState.user?.email) {
      setEmail(authState.user.email);
    }
    authModel?.returnToSignIn();
    switchMode("SIGN_IN");
  }

  const isRegisterMode = mode === "REGISTER";
  const isAuthenticating = authState.status === "AUTHENTICATING" || isSubmitting;
  const isSubmitDisabled = !isConfigured || isAuthenticating;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isConfigured || isAuthenticating || !authModel) {
      return;
    }

    const trimmedEmail = (typeof email === "string" ? email : "").trim();
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setLocalError(t("authErrorVALIDATION_FAILED"));
      return;
    }

    if (!password || (typeof password === "string" && password.length < 8)) {
      setLocalError(t("authErrorPASSWORD_TOO_SHORT"));
      return;
    }

    if (isRegisterMode) {
      if (password !== confirmPassword) {
        setLocalError(t("authErrorPASSWORD_MISMATCH"));
        return;
      }
    }

    setLocalError(null);
    authModel.clearError();
    setIsSubmitting(true);

    try {
      if (!isRegisterMode) {
        await authModel.signIn({ email: trimmedEmail, password });
        setPassword("");
        // Backend auth probe validation: verify NestJS accepts the bearer token.
        // signIn never throws (failures live in the model), and without a session the probe reports 401,
        // which would replace the real error (bad credentials, unconfirmed email...) with SESSION_EXPIRED.
        if (authModel.getSnapshot().status === "AUTHENTICATED") {
          void probeBackendAuth(authModel.getAccessToken).then((probe) => {
            if (probe.isUnauthorized) {
              void authModel.expireSession("SESSION_EXPIRED");
            }
          });
        }
        onAuthSuccess?.();
      } else {
        await authModel.signUp({ email: trimmedEmail, password });
        setPassword("");
        setConfirmPassword("");
        onAuthSuccess?.();
      }
    } catch {
      // Errors are mapped and stored in authModel.getSnapshot().error
    } finally {
      setIsSubmitting(false);
    }
  }

  // Determine active error to display
  let activeErrorMessage: string | null = localError;
  if (!activeErrorMessage && authState.error) {
    const errorKey = `authError${authState.error}`;
    activeErrorMessage = t(errorKey) || t("authErrorUNKNOWN");
  }

  return (
    <main className="login-shell">
      <header className="login-topbar">
        <span className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          Vision2Code
        </span>
        <PreferenceControls />
      </header>

      <div className="login-grid">
        <section className="login-story">
          <p className="eyebrow">{t("loginEyebrow")}</p>
          <h1>{t("loginTitle")}</h1>
          <p className="login-manifesto">{t("loginIntro")}</p>
          <p className="workspace-intro">{t("loginDescription")}</p>
          <div className="login-instrument" aria-hidden="true">
            <ScanLine />
            <span />
            <Layers />
            <span />
            <Code2 />
          </div>
          <p className="eyebrow">{t("labStatus")}</p>
        </section>

        <section className="login-panel raised-panel" aria-labelledby="login-title">
          <p className="eyebrow">Vision2Code / 01</p>
          <h2 id="login-title">
            {authState.status === "AWAITING_EMAIL_CONFIRMATION"
              ? t("checkYourEmail")
              : mode === "SIGN_IN"
              ? t("signIn")
              : t("register")}
          </h2>

          {authState.status === "AWAITING_EMAIL_CONFIRMATION" ? (
            /* Email Confirmation UX */
            <div className="email-confirmation-box" role="status" aria-live="polite">
              <div className="confirmation-icon-wrap" aria-hidden="true">
                <MailCheck />
              </div>
              <p className="login-notice">
                {t("confirmationSentTo")}{" "}
                <span className="confirmation-email-tag">
                  {authState.user?.email || email}
                </span>
              </p>
              <p className="login-notice">{t("confirmationExplanation")}</p>
              <button
                type="button"
                className="action-button primary-action"
                onClick={handleReturnToSignIn}
              >
                {t("returnToSignIn")}
              </button>
            </div>
          ) : (
            /* Sign In / Register Forms */
            <>
              {/* Mode switch navigation */}
              <div className="auth-mode-nav" role="tablist" aria-label={t("login")}>
                <button
                  type="button"
                  role="tab"
                  className={`auth-mode-btn ${mode === "SIGN_IN" ? "active" : ""}`}
                  aria-selected={mode === "SIGN_IN"}
                  onClick={() => switchMode("SIGN_IN")}
                >
                  {t("signIn")}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`auth-mode-btn ${mode === "REGISTER" ? "active" : ""}`}
                  aria-selected={mode === "REGISTER"}
                  onClick={() => switchMode("REGISTER")}
                >
                  {t("register")}
                </button>
              </div>

              {activeErrorMessage && (
                <div
                  className="auth-error-banner"
                  role="alert"
                  aria-live="assertive"
                  id="auth-error-message"
                >
                  <AlertCircle aria-hidden="true" />
                  <span>{activeErrorMessage}</span>
                </div>
              )}

              <p className="login-notice" id="auth-notice">
                {isConfigured ? t("authNotice") : t("authUnavailable")}
              </p>

              <form
                onSubmit={handleSubmit}
                aria-describedby={activeErrorMessage ? "auth-error-message auth-notice" : "auth-notice"}
                autoComplete="off"
              >
                <label htmlFor="login-email">
                  <Mail aria-hidden="true" />
                  {t("email")}
                </label>
                <input
                  id="login-email"
                  type="email"
                  value={typeof email === "string" ? email : ""}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  spellCheck={false}
                  required
                  disabled={isAuthenticating}
                  aria-invalid={Boolean(activeErrorMessage)}
                />

                <label htmlFor="login-password">
                  <LockKeyhole aria-hidden="true" />
                  {t("password")}
                </label>
                <div className="password-field">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={typeof password === "string" ? password : ""}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={!isRegisterMode ? "current-password" : "new-password"}
                    required
                    disabled={isAuthenticating}
                    aria-invalid={Boolean(activeErrorMessage)}
                  />
                  <button
                    type="button"
                    aria-label={t(showPassword ? "hidePassword" : "showPassword")}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isAuthenticating}
                  >
                    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                  </button>
                </div>

                {mode === "REGISTER" && (
                  <>
                    <label htmlFor="login-confirm-password">
                      <LockKeyhole aria-hidden="true" />
                      {t("confirmPassword")}
                    </label>
                    <div className="password-field">
                      <input
                        id="login-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        value={typeof confirmPassword === "string" ? confirmPassword : ""}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        required
                        disabled={isAuthenticating}
                        aria-invalid={Boolean(activeErrorMessage)}
                      />
                      <button
                        type="button"
                        aria-label={t(showConfirmPassword ? "hideConfirmPassword" : "showConfirmPassword")}
                        aria-pressed={showConfirmPassword}
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        disabled={isAuthenticating}
                      >
                        {showConfirmPassword ? (
                          <EyeOff aria-hidden="true" />
                        ) : (
                          <Eye aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  className="action-button primary-action"
                  disabled={isSubmitDisabled}
                >
                  {isAuthenticating
                    ? !isRegisterMode
                      ? t("signingIn")
                      : t("signingUp")
                    : !isRegisterMode
                    ? t("signIn")
                    : t("register")}
                </button>
              </form>
            </>
          )}

          {onDemo && authState.status !== "AWAITING_EMAIL_CONFIRMATION" && (
            <div className="demo-entry">
              <p className="eyebrow">{t("demoLabel")}</p>
              <button
                className="action-button"
                type="button"
                onClick={onDemo}
              >
                {t("demoEntry")}
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
