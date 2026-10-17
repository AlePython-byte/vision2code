/** WCAG 2.x contrast maths and token reading shared by `report-contrast.mts` and `desktop/tests/contrast.test.ts`. Pure: no I/O. */

export type Theme = "light" | "dark";
export type Tokens = Record<string, string>;

const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const value = parseInt(match[1]!, 16);
  return 0.2126 * channel(((value >> 16) & 255) / 255) + 0.7152 * channel(((value >> 8) & 255) / 255) + 0.0722 * channel((value & 255) / 255);
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Custom properties declared by the `:root` block of each theme in `foundation.css`. */
export function readThemeTokens(css: string): Record<Theme, Tokens> {
  const block = (selector: string) => {
    const start = css.indexOf(selector);
    if (start < 0) throw new Error(`Missing ${selector} in foundation.css`);
    const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));
  };
  return { light: block(':root, :root[data-theme="light"]'), dark: block(':root[data-theme="dark"]') };
}

export interface ContrastPair { readonly label: string; readonly foreground: string; readonly background: string; readonly minimum: number }

/** What a form field must satisfy in each theme (WCAG 1.4.11: a control's boundary needs 3:1 against what touches it). */
export const FIELD_PAIRS: readonly ContrastPair[] = [
  { label: "field border / card", foreground: "--color-field-border", background: "--color-surface", minimum: 3 },
  { label: "field border / field fill", foreground: "--color-field-border", background: "--color-field", minimum: 3 },
  { label: "field text / field fill", foreground: "--color-ink", background: "--color-field", minimum: 4.5 },
];
/** Fill against card has no WCAG minimum; the bar is that it must be a visible step, not a rule. */
export const FIELD_FILL_STEP = { foreground: "--color-field", background: "--color-surface" } as const;

export function ratioFor(tokens: Tokens, foreground: string, background: string): number {
  const colour = (name: string) => {
    const value = tokens[name];
    if (value === undefined) throw new Error(`Missing token ${name}`);
    return value;
  };
  return contrastRatio(colour(foreground), colour(background));
}
