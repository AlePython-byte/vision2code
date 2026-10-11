/**
 * Pure calculation of aspect-ratio preserving fit-to-viewport scale
 * for the Vision2Code local preview sandbox.
 *
 * Rules:
 * 1. scale = min(effectiveWidth / contentWidth, effectiveHeight / contentHeight, maxScale)
 * 2. In FIT mode, scale never exceeds maxScale (default 1.0), so smaller interfaces are never enlarged.
 * 3. Both X and Y dimensions are scaled by the exact same scalar (aspect ratio strictly preserved).
 * 4. Gracefully handles zero or negative dimensions.
 */

export interface FitDimensions {
  readonly availableWidth: number;
  readonly availableHeight: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly padding?: number;
  readonly maxScale?: number;
}

export interface FitScaleResult {
  readonly scale: number;
  readonly scaledWidth: number;
  readonly scaledHeight: number;
  readonly availableWidth: number;
  readonly availableHeight: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
}

export const DEFAULT_FIT_PADDING = 16;
export const DEFAULT_MAX_SCALE = 1;

export function calculateFitScale(options: FitDimensions): FitScaleResult {
  const {
    availableWidth,
    availableHeight,
    contentWidth,
    contentHeight,
    padding = DEFAULT_FIT_PADDING,
    maxScale = DEFAULT_MAX_SCALE,
  } = options;

  if (contentWidth <= 0 || contentHeight <= 0 || availableWidth <= 0 || availableHeight <= 0) {
    return {
      scale: 1,
      scaledWidth: Math.max(0, contentWidth),
      scaledHeight: Math.max(0, contentHeight),
      availableWidth,
      availableHeight,
      contentWidth,
      contentHeight,
    };
  }

  const effectiveWidth =
    availableWidth > padding * 2
      ? availableWidth - padding * 2
      : availableWidth * 0.9;

  const effectiveHeight =
    availableHeight > padding * 2
      ? availableHeight - padding * 2
      : availableHeight * 0.9;

  const scaleX = effectiveWidth / contentWidth;
  const scaleY = effectiveHeight / contentHeight;
  const rawScale = Math.min(scaleX, scaleY);

  // Never exceed maxScale (1.0 in FIT mode) and keep strictly positive
  const scale = Math.max(0.01, Math.min(rawScale, maxScale));

  const scaledWidth = Math.round(contentWidth * scale * 100) / 100;
  const scaledHeight = Math.round(contentHeight * scale * 100) / 100;

  return {
    scale,
    scaledWidth,
    scaledHeight,
    availableWidth,
    availableHeight,
    contentWidth,
    contentHeight,
  };
}

