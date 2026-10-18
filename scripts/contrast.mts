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
/** Scrollbar thumb against its track (WCAG 1.4.11: a control's visible part needs 3:1 against what touches it). */
export const SCROLLBAR_PAIRS: readonly ContrastPair[] = [
  { label: "scrollbar thumb / track", foreground: "--color-scrollbar-thumb", background: "--color-scrollbar-track", minimum: 3 },
  { label: "scrollbar thumb:hover / track", foreground: "--color-scrollbar-thumb-hover", background: "--color-scrollbar-track", minimum: 3 },
];

/** A disabled control is exempt from WCAG, but the product keeps its label legible: 3:1 at least. */
export const DISABLED_PAIRS: readonly ContrastPair[] = [
  { label: "disabled primary label / fill", foreground: "--color-disabled-fg", background: "--color-disabled-bg", minimum: 3 },
];

/** The "session will not be saved" notice: icon and border (non-text, 3:1) and the sentences (4.5:1) on the surfaces they sit on. */
export const SESSION_NOTICE_PAIRS: readonly ContrastPair[] = [
  { label: "notice icon / rail badge surface", foreground: "--color-warning", background: "--color-surface", minimum: 3 },
  { label: "notice icon / notice fill", foreground: "--color-warning", background: "--color-tint", minimum: 3 },
  { label: "notice sentence / notice fill", foreground: "--color-ink", background: "--color-tint", minimum: 4.5 },
  { label: "notice help line / notice fill", foreground: "--color-muted", background: "--color-tint", minimum: 4.5 },
];

/** Generated avatars: the eyes keep 3:1 against the blob they sit on (non-text), and the blob is a visible step over its background. */
export const AVATAR_PALETTES = 8;
export const AVATAR_PAIRS: readonly ContrastPair[] = Array.from({ length: AVATAR_PALETTES }, (_, index) => [
  { label: `avatar ${index + 1} eyes / blob`, foreground: `--avatar-${index + 1}-eyes`, background: `--avatar-${index + 1}-blob`, minimum: 3 },
  { label: `avatar ${index + 1} blob / background`, foreground: `--avatar-${index + 1}-blob`, background: `--avatar-${index + 1}-bg`, minimum: 1.5 },
]).flat();

/** Project/Library thumbnails: the caption and the fidelity chip are text (4.5:1); the drawn lines and buttons are decorative shapes that keep 3:1 against the page they sit on. */
export const THUMBNAIL_PAIRS: readonly ContrastPair[] = [
  { label: "thumbnail caption / pill", foreground: "--color-muted", background: "--color-tint", minimum: 4.5 },
  { label: "fidelity chip / its fill", foreground: "--color-ink", background: "--color-surface", minimum: 4.5 },
  { label: "thumbnail ink / paper", foreground: "--thumb-on-paper", background: "--thumb-paper", minimum: 4.5 },
  { label: "thumbnail ink / raised paper", foreground: "--thumb-on-paper", background: "--thumb-paper-raised", minimum: 4.5 },
  { label: "thumbnail light ink / slate", foreground: "--thumb-on-slate", background: "--thumb-slate", minimum: 4.5 },
  { label: "thumbnail light ink / raised slate", foreground: "--thumb-on-slate", background: "--thumb-slate-raised", minimum: 4.5 },
  { label: "thumbnail button / paper", foreground: "--color-primary", background: "--thumb-paper", minimum: 3 },
  { label: "thumbnail button label / button", foreground: "--color-surface", background: "--color-primary", minimum: 3 },
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
