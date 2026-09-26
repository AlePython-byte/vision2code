export function Workspace() {
  return (
    <main id="workspace" className="workspace" tabIndex={-1}>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow mb-4">01 / Espacio de trabajo</p>
          <h1>De la visión.<br />A la estructura.</h1>
        </div>
        <p className="workspace-intro">Un espacio enfocado en convertir<br className="intro-break" /> interfaces en código frontend.</p>
      </div>
      <section className="workspace-frame" aria-labelledby="workspace-title">
        <header className="frame-header">
          <h2 id="workspace-title" className="eyebrow">Espacio de trabajo de interfaces</h2>
          <span className="eyebrow text-muted">Base / 001</span>
        </header>
        <div className="empty-workspace">
          <div className="structure-mark" aria-hidden="true">
            <span /><span /><span />
          </div>
          <p className="eyebrow text-accent">Espacio para lo que viene</p>
          <h3>Tu espacio de trabajo empieza aquí.</h3>
          <p className="empty-description">La base de escritorio está lista. Las imágenes de referencia,
            la generación de código y las vistas previas llegarán en las próximas etapas.</p>
        </div>
        <div className="frame-footer">
          <span className="status-dot" aria-hidden="true" />
          <p>Estructura del espacio <span className="text-muted">/ Ningún proyecto cargado</span></p>
        </div>
      </section>
    </main>
  );
}
