import { useEffect, useRef, useState } from "react";
import { OutputStackSchema } from "@vision2code/contracts";
import type { OutputStack } from "@vision2code/contracts";
import { ScreenshotPreview } from "./ScreenshotPreview";
import { useScreenshot } from "./useScreenshot";
import type { ScreenshotStatus } from "./useScreenshot";
import { MAX_SCREENSHOT_SIZE_LABEL, SCREENSHOT_ACCEPT } from "./validation";

const statusLabels: Record<ScreenshotStatus, string> = {
  EMPTY: "Sin captura seleccionada",
  DRAGGING: "Suelta la imagen para validarla",
  VALIDATING: "Validando imagen…",
  READY: "Captura lista",
  ERROR: "No se pudo aceptar la imagen",
};

export function ScreenshotInput() {
  const { screenshot, status, error, setDragging, selectFiles, removeScreenshot } = useScreenshot();
  const [outputStack, setOutputStack] = useState<OutputStack>("REACT_TAILWIND");
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    // Prevent dropped files outside the input region from navigating the WebView.
    const preventFileNavigation = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
    };
    const resetDrag = () => { dragDepth.current = 0; setDragging(false); };
    const leaveWindow = (event: DragEvent) => { if (!event.relatedTarget) resetDrag(); };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    window.addEventListener("drop", resetDrag);
    window.addEventListener("dragend", resetDrag);
    window.addEventListener("dragleave", leaveWindow);
    window.addEventListener("blur", resetDrag);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
      window.removeEventListener("drop", resetDrag);
      window.removeEventListener("dragend", resetDrag);
      window.removeEventListener("dragleave", leaveWindow);
      window.removeEventListener("blur", resetDrag);
    };
  }, [setDragging]);

  return (
    <section className="workspace-frame screenshot-input" aria-labelledby="screenshot-title">
      <header className="frame-header">
        <h2 id="screenshot-title" className="eyebrow">Imagen de referencia</h2>
        <span className="eyebrow text-muted">Entrada / 002</span>
      </header>
      <div
        className="screenshot-drop-area"
        data-dragging={status === "DRAGGING"}
        aria-busy={status === "VALIDATING"}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void selectFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {screenshot ? <ScreenshotPreview screenshot={screenshot} /> : (
          <div className="empty-workspace">
            <p className="eyebrow text-accent">Empieza con una captura</p>
            <h3>Arrastra tu interfaz aquí.</h3>
            <p className="empty-description">Selecciona una imagen de tu equipo o suéltala en este espacio.</p>
          </div>
        )}
        <div className="screenshot-controls">
          <input ref={fileInput} type="file" accept={SCREENSHOT_ACCEPT} hidden
            aria-label="Seleccionar una captura de pantalla"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void selectFiles(files);
            }} />
          <div className="screenshot-actions">
            <button className="action-button" type="button" aria-describedby="screenshot-help"
              onClick={() => fileInput.current?.click()}>
              {screenshot ? "Reemplazar captura" : "Seleccionar imagen"}
            </button>
            {(screenshot || status === "VALIDATING") && (
              <button className="action-button secondary-button" type="button" onClick={removeScreenshot}>
                {screenshot ? "Eliminar captura" : "Cancelar selección"}
              </button>
            )}
          </div>
          <p id="screenshot-help" className="input-help">PNG, JPEG o WEBP · Máximo {MAX_SCREENSHOT_SIZE_LABEL}. La imagen permanece en memoria; no se envía ni se guarda.</p>
        </div>
      </div>
      <div className="screenshot-feedback">
        <p role="status" aria-live="polite" aria-atomic="true">{statusLabels[status]}</p>
        {error && <p role="alert" className="input-error">{error}{screenshot ? " Se conserva la captura anterior." : ""}</p>}
      </div>
      <div className="output-stack-control">
        <label htmlFor="output-stack">Tecnología de salida</label>
        <select id="output-stack" value={outputStack} onChange={(event) => {
          const result = OutputStackSchema.safeParse(event.currentTarget.value);
          if (result.success) setOutputStack(result.data);
        }}>
          <option value="REACT_TAILWIND">React + Tailwind CSS</option>
          <option value="HTML_CSS">HTML + CSS</option>
        </select>
        <p className="input-help">Elige la tecnología para las próximas etapas. La generación aún no está disponible.</p>
      </div>
    </section>
  );
}
