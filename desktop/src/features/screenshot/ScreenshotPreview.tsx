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
        <dl className="screenshot-metadata">
          <div className="screenshot-filename"><dt>{t("file")}</dt><dd>{screenshot.name}</dd></div>
          <div><dt>{t("dimensions")}</dt><dd>{screenshot.width} × {screenshot.height} {t("pixels")}</dd></div>
          <div><dt>{t("size")}</dt><dd>{formatFileSize(screenshot.size, i18n.language)}</dd></div>
          <div><dt>{t("format")}</dt><dd>{screenshot.format}</dd></div>
        </dl>
      </figcaption>
    </figure>
  );
}
