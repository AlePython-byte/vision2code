import { useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { i18n } from "../preferences/i18n";
import { useLabels } from "../preferences/useLabels";
import type { Screenshot } from "./loadScreenshot";
import { formatFileSize } from "./validation";
import { ImageViewer } from "./ImageViewer";

export function ScreenshotPreview({ screenshot }: { screenshot: Screenshot }) {
  const { t } = useLabels();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <figure className="screenshot-preview">
      <div className="screenshot-image-area">
        {/* The whole preview is one button: click (or Enter / Space) opens the full-size viewer. */}
        <button ref={opener} type="button" className="screenshot-zoom" aria-haspopup="dialog" aria-expanded={open}
          aria-label={t("enlargeScreenshot", { name: screenshot.name })} onClick={() => setOpen(true)}>
          <img src={screenshot.url} alt="" draggable={false} />
          <span className="screenshot-zoom-hint" aria-hidden="true"><Maximize2 />{t("enlargeHint")}</span>
        </button>
      </div>
      {open && <ImageViewer src={screenshot.url} name={screenshot.name} trigger={opener.current} onClose={() => setOpen(false)} />}
      <figcaption>
        {/* One compact row; the terms stay for screen readers. */}
        <dl className="screenshot-metadata">
          <div className="screenshot-filename"><dt className="sr-only">{t("file")}</dt><dd title={screenshot.name}>{screenshot.name}</dd></div>
          <div><dt className="sr-only">{t("dimensions")}</dt><dd>{screenshot.width} × {screenshot.height} {t("pixels")}</dd></div>
          <div><dt className="sr-only">{t("size")}</dt><dd>{formatFileSize(screenshot.size, i18n.language)}</dd></div>
          <div><dt className="sr-only">{t("format")}</dt><dd>{screenshot.format}</dd></div>
        </dl>
      </figcaption>
    </figure>
  );
}
