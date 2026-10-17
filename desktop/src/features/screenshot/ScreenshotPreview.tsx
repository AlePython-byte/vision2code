import { i18n } from "../preferences/i18n";
import { useLabels } from "../preferences/useLabels";
import type { Screenshot } from "./loadScreenshot";
import { formatFileSize } from "./validation";

export function ScreenshotPreview({ screenshot }: { screenshot: Screenshot }) {
  const { t } = useLabels();
  return (
    <figure className="screenshot-preview">
      <div className="screenshot-image-area">
        <img src={screenshot.url} alt={t("selectedScreenshot", { name: screenshot.name })} draggable={false} />
      </div>
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
