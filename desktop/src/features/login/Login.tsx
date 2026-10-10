import { useState } from "react";
import { Eye, EyeOff, Mail, LockKeyhole, ArrowRight, ScanLine, Code2, Layers } from "lucide-react";
import { PreferenceControls } from "../preferences/PreferenceControls";
import { useLabels } from "../preferences/useLabels";

export function Login({ onDemo }: { onDemo: () => void }) {
  const { t } = useLabels();
  const [visible, setVisible] = useState(false);
  return <main className="login-shell">
    <header className="login-topbar"><span className="login-brand"><span className="brand-mark" aria-hidden="true">V</span>Vision2Code</span><PreferenceControls /></header>
    <div className="login-grid">
      <section className="login-story">
        <p className="eyebrow">{t("loginEyebrow")}</p><h1>{t("loginTitle")}</h1>
        <p className="login-manifesto">{t("loginIntro")}</p><p className="workspace-intro">{t("loginDescription")}</p>
        <div className="login-instrument" aria-hidden="true"><ScanLine /><span /><Layers /><span /><Code2 /></div>
        <p className="eyebrow">{t("labStatus")}</p>
      </section>
      <section className="login-panel raised-panel" aria-labelledby="login-title">
        <p className="eyebrow">Vision2Code / 01</p><h2 id="login-title">{t("login")}</h2>
        <p className="login-notice" id="auth-notice">{t("authUnavailable")}</p>
        <form onSubmit={(event) => event.preventDefault()} aria-describedby="auth-notice" autoComplete="off">
          <label htmlFor="login-email"><Mail aria-hidden="true" />{t("email")}</label>
          <input id="login-email" type="email" autoComplete="off" spellCheck={false} />
          <label htmlFor="login-password"><LockKeyhole aria-hidden="true" />{t("password")}</label>
          <div className="password-field"><input id="login-password" type={visible ? "text" : "password"} autoComplete="off" />
            <button type="button" aria-label={t(visible ? "hidePassword" : "showPassword")} aria-pressed={visible}
              onClick={() => setVisible(!visible)}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
          </div>
          <button type="submit" className="action-button primary-action" disabled>{t("signIn")}</button>
          <button type="button" className="action-button" disabled>{t("createAccount")} · {t("soon")}</button>
        </form>
        <div className="demo-entry"><p className="eyebrow">{t("demoLabel")}</p>
          <button className="action-button primary-action" type="button" onClick={onDemo}>{t("demoEntry")}<ArrowRight aria-hidden="true" /></button>
        </div>
      </section>
    </div>
  </main>;
}
