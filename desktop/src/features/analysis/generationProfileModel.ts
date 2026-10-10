import type { OutputStack } from "@vision2code/contracts";

export type VisualFidelity = "fast" | "balanced" | "precise";

export const DEFAULT_VISUAL_FIDELITY: VisualFidelity = "balanced";

export const VISUAL_FIDELITY_OPTIONS: readonly VisualFidelity[] = ["fast", "balanced", "precise"] as const;

export interface VisualFidelityConfig {
  value: VisualFidelity;
  rotationDegrees: number;
  labelKey: "fidelityFast" | "fidelityBalanced" | "fidelityPrecise";
  descKey: "fidelityFastDesc" | "fidelityBalancedDesc" | "fidelityPreciseDesc";
}

export const VISUAL_FIDELITY_CONFIGS: Record<VisualFidelity, VisualFidelityConfig> = {
  fast: {
    value: "fast",
    rotationDegrees: -35,
    labelKey: "fidelityFast",
    descKey: "fidelityFastDesc",
  },
  balanced: {
    value: "balanced",
    rotationDegrees: 0,
    labelKey: "fidelityBalanced",
    descKey: "fidelityBalancedDesc",
  },
  precise: {
    value: "precise",
    rotationDegrees: 35,
    labelKey: "fidelityPrecise",
    descKey: "fidelityPreciseDesc",
  },
};

export interface GenerationProfileState {
  outputStack: OutputStack;
  fidelity: VisualFidelity;
}

export interface GenerationProfileModel {
  getSnapshot: () => GenerationProfileState;
  subscribe: (listener: () => void) => () => void;
  setOutputStack: (stack: OutputStack) => void;
  setFidelity: (fidelity: VisualFidelity) => void;
  cycleFidelity: () => VisualFidelity;
}

export function createGenerationProfileModel(
  initial?: Partial<GenerationProfileState>,
): GenerationProfileModel {
  let state: GenerationProfileState = {
    outputStack: initial?.outputStack ?? "REACT_TAILWIND",
    fidelity: initial?.fidelity ?? DEFAULT_VISUAL_FIDELITY,
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
    setOutputStack(outputStack: OutputStack) {
      if (state.outputStack === outputStack) return;
      state = { ...state, outputStack };
      notify();
    },
    setFidelity(fidelity: VisualFidelity) {
      if (state.fidelity === fidelity) return;
      state = { ...state, fidelity };
      notify();
    },
    cycleFidelity() {
      const order: VisualFidelity[] = ["fast", "balanced", "precise"];
      const currentIndex = order.indexOf(state.fidelity);
      const nextIndex = (currentIndex + 1) % order.length;
      const next = order[nextIndex]!;
      state = { ...state, fidelity: next };
      notify();
      return next;
    },
  };
}

