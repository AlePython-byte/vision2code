import type { Screenshot } from "./loadScreenshot";
import { formatFileSize } from "./validation";

export function ScreenshotPreview({ screenshot }: { screenshot: Screenshot }) {
  return (
    <figure className="screenshot-preview">
      <div className="screenshot-image-area">
        <img src={screenshot.url} alt={`Captura seleccionada: ${screenshot.name}`} draggable={false} />
      </div>
      <figcaption>
        <dl className="screenshot-metadata">
          <div className="screenshot-filename"><dt>Archivo</dt><dd>{screenshot.name}</dd></div>
          <div><dt>Dimensiones</dt><dd>{screenshot.width} × {screenshot.height} píxeles</dd></div>
          <div><dt>Tamaño</dt><dd>{formatFileSize(screenshot.size)}</dd></div>
          <div><dt>Formato</dt><dd>{screenshot.format}</dd></div>
        </dl>
      </figcaption>
    </figure>
  );
}
