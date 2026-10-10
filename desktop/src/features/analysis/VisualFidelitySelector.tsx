import type { KeyboardEvent } from "react";
import { useLabels } from "../preferences/useLabels";
import {
  type VisualFidelity,
  VISUAL_FIDELITY_OPTIONS,
  VISUAL_FIDELITY_CONFIGS,
} from "./generationProfileModel";

export function VisualFidelitySelector({
  value,
  onChange,
  onCycle,
  disabled = false,
}: {
  value: VisualFidelity;
  onChange: (value: VisualFidelity) => void;
  onCycle?: () => void;
  disabled?: boolean;
}) {
  const { t } = useLabels();
  const currentConfig = VISUAL_FIDELITY_CONFIGS[value];

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const currentIndex = VISUAL_FIDELITY_OPTIONS.indexOf(value);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = (currentIndex + 1) % VISUAL_FIDELITY_OPTIONS.length;
      onChange(VISUAL_FIDELITY_OPTIONS[nextIndex]!);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const prevIndex = (currentIndex - 1 + VISUAL_FIDELITY_OPTIONS.length) % VISUAL_FIDELITY_OPTIONS.length;
      onChange(VISUAL_FIDELITY_OPTIONS[prevIndex]!);
    }
  }

  function handleDialClick() {
    if (disabled) return;
    if (onCycle) {
      onCycle();
    } else {
      const currentIndex = VISUAL_FIDELITY_OPTIONS.indexOf(value);
      const nextIndex = (currentIndex + 1) % VISUAL_FIDELITY_OPTIONS.length;
      onChange(VISUAL_FIDELITY_OPTIONS[nextIndex]!);
    }
  }

  return (
    <div className="fidelity-card" data-fidelity={value}>
      <button
        type="button"
        className="fidelity-dial"
        onClick={handleDialClick}
        disabled={disabled}
        aria-label={`${t("fidelityAria")}: ${t(currentConfig.labelKey)}`}
        title={`${t("fidelity")}: ${t(currentConfig.labelKey)}`}
      >
        <div
          className="fidelity-dial-rotor"
          style={{ transform: `rotate(${currentConfig.rotationDegrees}deg)` }}
          aria-hidden="true"
        >
          <span />
        </div>
        <div className="fidelity-dial-ticks" aria-hidden="true">
          <span className={`fidelity-tick tick-fast ${value === "fast" ? "active" : ""}`} />
          <span className={`fidelity-tick tick-balanced ${value === "balanced" ? "active" : ""}`} />
          <span className={`fidelity-tick tick-precise ${value === "precise" ? "active" : ""}`} />
        </div>
      </button>

      <div className="fidelity-content">
        <div className="fidelity-header">
          <p className="eyebrow">{t("fidelity")}</p>
          <span className="fidelity-badge">{t(currentConfig.labelKey)}</span>
        </div>

        <div
          className="fidelity-segmented"
          role="radiogroup"
          aria-label={t("fidelityAria")}
          onKeyDown={handleKeyDown}
        >
          {VISUAL_FIDELITY_OPTIONS.map((mode) => {
            const config = VISUAL_FIDELITY_CONFIGS[mode];
            const isSelected = value === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected ? 0 : -1}
                disabled={disabled}
                className={`fidelity-segment ${isSelected ? "active" : ""}`}
                onClick={() => onChange(mode)}
              >
                {t(config.labelKey)}
              </button>
            );
          })}
        </div>

        <p className="fidelity-description input-help">{t(currentConfig.descKey)}</p>
      </div>
    </div>
  );
}

