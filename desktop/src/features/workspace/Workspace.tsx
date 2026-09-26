import { ScreenshotInput } from "../screenshot/ScreenshotInput";

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
      <ScreenshotInput />
    </main>
  );
}
