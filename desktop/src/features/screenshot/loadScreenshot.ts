import { validateScreenshotFile, ScreenshotValidationError } from "./validation.ts";
import type { ScreenshotFormat } from "./validation.ts";

export interface Screenshot {
  file: File;
  name: string;
  size: number;
  format: ScreenshotFormat;
  width: number;
  height: number;
  url: string;
}

function decodeImage(url: string, signal: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
      image.removeAttribute("src");
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Image selection cancelled", "AbortError"));
    };
    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      cleanup();
      if (width > 0 && height > 0) resolve({ width, height });
      else reject(new ScreenshotValidationError("No se pudo decodificar la imagen. Elige otro archivo."));
    };
    image.onerror = () => {
      cleanup();
      reject(new ScreenshotValidationError("No se pudo decodificar la imagen. Puede estar dañada; elige otro archivo."));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else image.src = url;
  });
}

export async function loadScreenshot(file: File, signal: AbortSignal): Promise<Screenshot> {
  const format = await validateScreenshotFile(file);
  signal.throwIfAborted();
  const url = URL.createObjectURL(file);
  try {
    const dimensions = await decodeImage(url, signal);
    signal.throwIfAborted();
    return { file, name: file.name, size: file.size, format, url, ...dimensions };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
