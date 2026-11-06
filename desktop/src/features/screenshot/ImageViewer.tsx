import { useEffect, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import { handleVaultDialogKey } from "../projects/vaultKeyboard";

/**
 * Accessible full-size viewer for the reference image: modal dialog, focus moves to the close button and is trapped
 * there, Esc / the scrim / the button close it and focus returns to the element that opened it.
 */
export function ImageViewer({ src, name, trigger, onClose }: {
  src: string;
  name: string;
  /** Element to give focus back to when the viewer closes. */
  trigger: HTMLElement | null;
  onClose: () => void;
}) {
  const { t } = useLabels();
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [trigger]);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    handleVaultDialogKey(event, false, closeButton.current ? [closeButton.current] : [], document.activeElement, onClose);
  }

  return createPortal(
    <div className="vault-scrim image-viewer-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="image-viewer raised-panel" role="dialog" aria-modal="true" aria-labelledby="image-viewer-title" onKeyDown={keys}>
        <header className="image-viewer-header">
          <h2 id="image-viewer-title">{t("imageViewerTitle")}</h2>
          <button ref={closeButton} type="button" className="action-button secondary-button image-viewer-close" onClick={onClose}>
            <X aria-hidden="true" />{t("imageViewerClose")}
          </button>
        </header>
        <div className="image-viewer-stage">
          <img src={src} alt={t("selectedScreenshot", { name })} draggable={false} />
        </div>
        <p className="input-help image-viewer-name" title={name}>{name}</p>
      </div>
    </div>,
    document.body,
  );
}
