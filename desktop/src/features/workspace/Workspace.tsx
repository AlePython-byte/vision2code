export function Workspace() {
  return (
    <main id="workspace" className="workspace" tabIndex={-1}>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow mb-4">01 / Workspace</p>
          <h1>From vision.<br />To structure.</h1>
        </div>
        <p className="workspace-intro">A focused space for translating<br className="intro-break" /> interfaces into frontend code.</p>
      </div>
      <section className="workspace-frame" aria-labelledby="workspace-title">
        <header className="frame-header">
          <h2 id="workspace-title" className="eyebrow">Interface workspace</h2>
          <span className="eyebrow text-muted">Foundation / 001</span>
        </header>
        <div className="empty-workspace">
          <div className="structure-mark" aria-hidden="true">
            <span /><span /><span />
          </div>
          <p className="eyebrow text-accent">Space for what comes next</p>
          <h3>Your workspace starts here.</h3>
          <p className="empty-description">The desktop foundation is in place. Reference images,
            code generation, and previews will arrive in future versions.</p>
        </div>
        <div className="frame-footer">
          <span className="status-dot" aria-hidden="true" />
          <p>Workspace shell <span className="text-muted">/ No project loaded</span></p>
        </div>
      </section>
    </main>
  );
}
