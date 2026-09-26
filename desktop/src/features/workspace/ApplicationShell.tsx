import { Workspace } from "./Workspace";

export function ApplicationShell() {
  return (
    <div className="application-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <header className="app-header">
        <a href="#workspace" className="brand" aria-label="Vision2Code workspace">
          <span className="brand-mark" aria-hidden="true">V/2</span>
          <span>Vision2Code<span className="text-accent">.</span></span>
        </a>
        <div className="utility-label">Desktop <span className="text-muted">/</span> Foundation</div>
      </header>
      <div className="shell-body">
        <nav className="navigation" aria-label="Main navigation">
          <p className="eyebrow navigation-label">Studio</p>
          <a className="navigation-item" href="#workspace" aria-current="page">
            <span className="font-mono text-accent" aria-hidden="true">01</span>
            Workspace
            <span className="nav-arrow" aria-hidden="true">↗</span>
          </a>
          <p className="navigation-note">An interface.<br />A starting point.</p>
        </nav>
        <Workspace />
      </div>
      <footer className="app-footer">
        <span>Vision2Code / Desktop foundation</span>
        <span>Build 0.1.0</span>
      </footer>
    </div>
  );
}
