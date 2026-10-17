import { Plus, ImagePlus, Trash2 } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { useEffect, useRef } from "react";
import { ScreenshotPreview } from "./ScreenshotPreview";
import type { useScreenshot } from "./useScreenshot";
import type { ScreenshotStatus } from "./useScreenshot";
import { MAX_SCREENSHOT_SIZE_LABEL, SCREENSHOT_ACCEPT } from "./validation";

const statusLabels: Record<ScreenshotStatus, string> = {
  EMPTY: "screenshotEmpty",
  DRAGGING: "screenshotDragging",
  VALIDATING: "screenshotValidating",
  READY: "screenshotReady",
  ERROR: "screenshotError",
};

export function ScreenshotInput({
  controller,
  inputRef: externalInputRef,
}: {
  controller: ReturnType<typeof useScreenshot>;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const { t, message } = useLabels();
  const { screenshot, status, error, setDragging, selectFiles, removeScreenshot } = controller;
  const internalInputRef = useRef<HTMLInputElement>(null);
  const fileInput = externalInputRef ?? internalInputRef;
  const dragDepth = useRef(0);

  const triggerPicker = () => {
    fileInput.current?.click();
  };

  const handleAffordanceClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    triggerPicker();
  };

  const handleSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.closest(".input-help")) return;
    event.stopPropagation();
    triggerPicker();
  };

  const handleDropAreaClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (screenshot) return;
    const target = event.target as HTMLElement;
    if (target.closest("button") || target.closest(".input-help") || target.closest(".screenshot-actions")) return;
    triggerPicker();
  };

  const handleBrowseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    triggerPicker();
  };

  const handleSurfaceKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      if (event.target === event.currentTarget) {
        event.preventDefault();
        triggerPicker();
      }
    }
  };

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

  // Empty: the select button belongs to the centred block. With an image: Replace / Remove sit under the preview.
  const actions = (
    <div className="screenshot-actions">
      <button
        className="action-button"
        type="button"
        aria-describedby="screenshot-help"
        onClick={handleBrowseClick}
      >
        <ImagePlus aria-hidden="true" />{screenshot ? t("replaceScreenshot") : t("selectImage")}
      </button>
      {(screenshot || status === "VALIDATING") && (
        <button
          className="action-button secondary-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            removeScreenshot();
          }}
        >
          <Trash2 aria-hidden="true" />{screenshot ? t("removeScreenshot") : t("cancelSelection")}
        </button>
      )}
    </div>
  );
  return (
    <section className="raised-panel screenshot-input" aria-labelledby="screenshot-title">
      <header className="frame-header">
        <div><p className="eyebrow">{t("screenshotEyebrow")}</p><h2 id="screenshot-title">{t("screenshotTitle")}</h2></div>
        <span className="panel-badge">{screenshot ? t("ready") : t("empty")}</span>
      </header>
      <div
        className="screenshot-drop-area"
        data-dragging={status === "DRAGGING"}
        aria-busy={status === "VALIDATING"}
        onClick={handleDropAreaClick}
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
          <div
            className="empty-workspace"
            role="region"
            tabIndex={0}
            aria-label={t("dropTitle")}
            onClick={handleSurfaceClick}
            onKeyDown={handleSurfaceKeyDown}
          >
            <button
              type="button"
              className="upload-mark"
              aria-label={t("uploadAffordanceAria")}
              onClick={handleAffordanceClick}
            >
              <Plus aria-hidden="true" />
            </button>
            <h3>{t("dropTitle")}</h3>
            <p className="empty-description">{t("dropHelp")}</p>
            {actions}
          </div>
        )}
        <div className="screenshot-controls">
          <input
            ref={fileInput}
            type="file"
            accept={SCREENSHOT_ACCEPT}
            hidden
            aria-label={t("selectScreenshotLabel")}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void selectFiles(files);
            }}
          />
          {screenshot && actions}
          <p id="screenshot-help" className="input-help">{t("screenshotHelp", { size: MAX_SCREENSHOT_SIZE_LABEL })}</p>
        </div>
      </div>
      <div className="screenshot-feedback">
        {/* The badge and the footer already show the state; this live region only announces it to screen readers. */}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{t(statusLabels[status])}</p>
        {error && <p role="alert" className="input-error">{message(error)}{screenshot ? t("keepScreenshot") : ""}</p>}
      </div>
    </section>
  );
}
