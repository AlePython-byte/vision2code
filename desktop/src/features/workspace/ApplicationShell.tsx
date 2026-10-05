import { Workspace } from "./Workspace";

export function ApplicationShell() {
  return (
    <div className="application-shell">
      <a className="skip-link" href="#workspace">Saltar al espacio de trabajo</a>
      <nav className="navigation" aria-label="Navegación principal">
        <a href="#workspace" className="brand-mark" aria-label="Espacio de trabajo de Vision2Code">V</a>
        <div className="navigation-links">
          <a className="navigation-item" href="#workspace" aria-current="page"><span aria-hidden="true">CA</span><small>Captura</small></a>
          <button className="navigation-item" disabled aria-label="Proyectos, próximamente"><span aria-hidden="true">PR</span><small>Proyectos</small></button>
          <button className="navigation-item" disabled aria-label="Biblioteca, próximamente"><span aria-hidden="true">BI</span><small>Biblioteca</small></button>
        </div>
        <span className="navigation-note">V/2<br />0.1.0</span>
      </nav>
      <div className="shell-content">
        <Workspace />
        <footer className="app-footer"><span>Vision2Code / Estudio de interfaces</span><span>Versión 0.1.0</span></footer>
      </div>
    </div>
  );
}
