import { Workspace } from "./Workspace";

export function ApplicationShell() {
  return (
    <div className="application-shell">
      <a className="skip-link" href="#workspace">Saltar al espacio de trabajo</a>
      <header className="app-header">
        <a href="#workspace" className="brand" aria-label="Espacio de trabajo de Vision2Code">
          <span className="brand-mark" aria-hidden="true">V/2</span>
          <span>Vision2Code<span className="text-accent">.</span></span>
        </a>
        <div className="utility-label">Escritorio <span className="text-muted">/</span> Base</div>
      </header>
      <div className="shell-body">
        <nav className="navigation" aria-label="Navegación principal">
          <p className="eyebrow navigation-label">Estudio</p>
          <a className="navigation-item" href="#workspace" aria-current="page">
            <span className="font-mono text-accent" aria-hidden="true">01</span>
            Espacio de trabajo
            <span className="nav-arrow" aria-hidden="true">↗</span>
          </a>
          <p className="navigation-note">Una interfaz.<br />Un punto de partida.</p>
        </nav>
        <Workspace />
      </div>
      <footer className="app-footer">
        <span>Vision2Code / Base de escritorio</span>
        <span>Versión 0.1.0</span>
      </footer>
    </div>
  );
}
