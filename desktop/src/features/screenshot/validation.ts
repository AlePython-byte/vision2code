export const MAX_SCREENSHOT_BYTES = 10_000_000;
export const MAX_SCREENSHOT_SIZE_LABEL = `${MAX_SCREENSHOT_BYTES / 1_000_000} MB`;
export const SCREENSHOT_ACCEPT = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";

export type ScreenshotFormat = "PNG" | "JPEG" | "WEBP";

const formats = {
  PNG: { extensions: ["png"], mime: "image/png" },
  JPEG: { extensions: ["jpg", "jpeg"], mime: "image/jpeg" },
  WEBP: { extensions: ["webp"], mime: "image/webp" },
} satisfies Record<ScreenshotFormat, { extensions: string[]; mime: string }>;

export class ScreenshotValidationError extends Error {}

function detectFormat(bytes: Uint8Array): ScreenshotFormat | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "PNG";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "JPEG";
  const text = new TextDecoder("ascii").decode(bytes);
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "WEBP";
  return null;
}

export async function validateScreenshotFile(file: File): Promise<ScreenshotFormat> {
  if (file.size > MAX_SCREENSHOT_BYTES) {
    throw new ScreenshotValidationError(`La imagen supera el límite de ${MAX_SCREENSHOT_SIZE_LABEL}. Selecciona un archivo más pequeño.`);
  }
  if (file.size === 0) {
    throw new ScreenshotValidationError("El archivo está vacío. Selecciona una imagen válida.");
  }
  const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase();
  const format = (Object.keys(formats) as ScreenshotFormat[]).find(
    (key) => (formats[key].extensions as readonly string[]).includes(extension ?? ""),
  );
  if (!format || (file.type !== "" && file.type.toLowerCase() !== formats[format].mime)) {
    throw new ScreenshotValidationError("Formato no compatible. Selecciona una imagen PNG, JPEG o WEBP con su extensión correcta.");
  }
  // File.type can be empty or inferred from the name. Verify the signature as well.
  const detected = detectFormat(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (detected !== format) {
    throw new ScreenshotValidationError("El contenido del archivo no coincide con una imagen PNG, JPEG o WEBP válida.");
  }
  return format;
}

export function formatFileSize(bytes: number): string {
  return new Intl.NumberFormat("es", {
    style: "unit",
    unit: bytes >= 1_000_000 ? "megabyte" : "kilobyte",
    maximumFractionDigits: 2,
  }).format(bytes / (bytes >= 1_000_000 ? 1_000_000 : 1_000));
}
