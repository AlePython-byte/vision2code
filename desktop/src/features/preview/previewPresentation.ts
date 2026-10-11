import { calculateFitScale } from "./previewFit.ts";

export type PreviewViewportPreset = "desktop" | "tablet" | "mobile";
export type PreviewZoomMode = "fit" | "50" | "75" | "100";

export interface ViewportPresetConfig {
  readonly width: number;
  readonly height: number;
  readonly labelKey: string;
}

export const PREVIEW_VIEWPORT_PRESETS: Record<PreviewViewportPreset, ViewportPresetConfig> = {
  desktop: { width: 1440, height: 900, labelKey: "previewDeviceDesktop" },
  tablet: { width: 768, height: 1024, labelKey: "previewDeviceTablet" },
  mobile: { width: 390, height: 844, labelKey: "previewDeviceMobile" },
};

export const PREVIEW_ZOOM_MODES: readonly PreviewZoomMode[] = ["fit", "50", "75", "100"] as const;

export const PREVIEW_ZOOM_SCALES: Record<Exclude<PreviewZoomMode, "fit">, number> = {
  "50": 0.5,
  "75": 0.75,
  "100": 1.0,
};

export const DEFAULT_VIEWPORT_PRESET: PreviewViewportPreset = "desktop";
export const DEFAULT_ZOOM_MODE: PreviewZoomMode = "fit";

export interface PresentationScaleOptions {
  readonly preset: PreviewViewportPreset;
  readonly zoomMode: PreviewZoomMode;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly padding?: number;
}

export interface PresentationScaleResult {
  readonly scale: number;
  readonly scaledWidth: number;
  readonly scaledHeight: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
}

/**
 * Pure calculation of preview presentation scaling and viewport bounds.
 *
 * Rules:
 * 1. For "fit" mode: calculates aspect-ratio preserving fit scale within available stage bounds.
 * 2. For manual zoom modes ("50", "75", "100"): applies exact scalar (0.5, 0.75, 1.0) to content dimensions.
 * 3. Never stretches width and height independently; uniform aspect ratio is strictly preserved.
 * 4. Pure computation with zero side effects, no network/AI calls, and no mutation of project sources.
 */
export function calculatePresentationScale(options: PresentationScaleOptions): PresentationScaleResult {
  const { preset, zoomMode, stageWidth, stageHeight, padding = 16 } = options;
  const config = PREVIEW_VIEWPORT_PRESETS[preset] ?? PREVIEW_VIEWPORT_PRESETS.desktop;
  const contentWidth = config.width;
  const contentHeight = config.height;

  if (zoomMode === "fit") {
    const fit = calculateFitScale({
      availableWidth: stageWidth,
      availableHeight: stageHeight,
      contentWidth,
      contentHeight,
      padding,
      maxScale: 1.0,
    });
    return {
      scale: fit.scale,
      scaledWidth: fit.scaledWidth,
      scaledHeight: fit.scaledHeight,
      contentWidth,
      contentHeight,
    };
  }

  const manualScale = PREVIEW_ZOOM_SCALES[zoomMode] ?? 1.0;
  return {
    scale: manualScale,
    scaledWidth: Math.round(contentWidth * manualScale * 100) / 100,
    scaledHeight: Math.round(contentHeight * manualScale * 100) / 100,
    contentWidth,
    contentHeight,
  };
}

export interface PreviewPresentationState {
  readonly preset: PreviewViewportPreset;
  readonly zoomMode: PreviewZoomMode;
}

/**
 * Creates an isolated presentation controller for device viewport presets and zoom modes.
 * Presentation state is strictly distinct from compilation/project state.
 */
export function createPreviewPresentation(initial?: Partial<PreviewPresentationState>) {
  let state: PreviewPresentationState = {
    preset: initial?.preset ?? DEFAULT_VIEWPORT_PRESET,
    zoomMode: initial?.zoomMode ?? DEFAULT_ZOOM_MODE,
  };
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPreset(preset: PreviewViewportPreset) {
      if (state.preset === preset) return;
      state = { ...state, preset };
      notify();
    },
    setZoomMode(zoomMode: PreviewZoomMode) {
      if (state.zoomMode === zoomMode) return;
      state = { ...state, zoomMode };
      notify();
    },
    reset() {
      state = { preset: DEFAULT_VIEWPORT_PRESET, zoomMode: DEFAULT_ZOOM_MODE };
      notify();
    },
  };
}

export type PreviewPresentation = ReturnType<typeof createPreviewPresentation>;

