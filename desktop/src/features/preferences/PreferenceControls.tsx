import { useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Languages, Moon, Palette, Sun } from "lucide-react";
import { preferences } from "./preferences";
import { useLabels } from "./useLabels";

interface Option<T extends string> { readonly value: T; readonly label: string; readonly name?: string; readonly icon?: ReactNode }

/** Accessible radio group: roving tabindex, arrows (and Home/End) move the selection and the focus. */
export function SegmentedRadioGroup<T extends string>({ id, label, icon, value, options, onChange }: {
  id: string; label: string; icon: ReactNode; value: T; options: readonly Option<T>[]; onChange: (value: T) => void;
}) {
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const last = options.length - 1;
    const index = options.findIndex((option) => option.value === value);
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % options.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index - 1 + options.length) % options.length
      : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(options[next]!.value);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
  return (
    <div className="preference-field">
      <span id={id} className="preference-label">{icon}{label}</span>
      <div className="fidelity-segmented preference-segmented" role="radiogroup" aria-labelledby={id} onKeyDown={move}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button key={option.value} type="button" role="radio"
              aria-checked={selected} aria-label={option.name} title={option.name} tabIndex={selected ? 0 : -1}
              className={`fidelity-segment preference-segment ${selected ? "active" : ""}`} onClick={() => onChange(option.value)}>
              {option.icon}{option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PreferenceControls() {
  const { t } = useLabels();
  const state = useSyncExternalStore(preferences.subscribe, preferences.getSnapshot, preferences.getSnapshot);
  return <div className="preference-controls" role="group" aria-label={t("preferences")}>
    <SegmentedRadioGroup id="preference-theme" label={t("theme")} icon={<Palette aria-hidden="true" />} value={state.theme}
      options={[
        { value: "light", label: t("light"), icon: <Sun aria-hidden="true" /> },
        { value: "dark", label: t("dark"), icon: <Moon aria-hidden="true" /> },
      ]}
      onChange={(theme) => preferences.set({ theme })} />
    <SegmentedRadioGroup id="preference-language" label={t("language")} icon={<Languages aria-hidden="true" />} value={state.language}
      options={[
        { value: "es", label: "ES", name: "Español" },
        { value: "en", label: "EN", name: "English" },
      ]}
      onChange={(language) => preferences.set({ language })} />
  </div>;
}
