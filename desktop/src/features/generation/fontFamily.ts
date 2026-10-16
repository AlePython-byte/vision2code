/**
 * Font-family handling for generator v4. Pure and dependency-free: no I/O, clock or randomness.
 *
 * The schema's `fontFamily` is model output (untrusted). It is split on commas, each entry is
 * unquoted and kept only if it is a plain family name (letters, digits, spaces and hyphens, starting
 * with a letter, at most MAX_FAMILY_LENGTH characters); anything else is dropped, so a value can
 * never inject CSS, URLs or quotes. At most MAX_FAMILIES names are kept.
 *
 * The emitted list always ends in a generic family, because the declared fonts are usually not
 * installed and a list without one falls back to the browser default (a serif). A generic the
 * schema already lists is kept where it is; otherwise one is appended: `serif` or `monospace` when
 * the first named family is in the small closed lists below, `sans-serif` for everything else.
 */

export const MAX_FAMILIES = 4;
export const MAX_FAMILY_LENGTH = 64;

export const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong",
]);

/** Well-known serif families (lowercase). Deliberately short: unknown families get sans-serif. */
export const SERIF_FAMILIES: ReadonlySet<string> = new Set([
  "georgia", "times", "times new roman", "garamond", "eb garamond", "merriweather", "playfair display",
  "lora", "pt serif", "noto serif", "source serif pro", "libre baskerville", "cambria", "palatino",
]);

/** Well-known monospace families (lowercase). */
export const MONOSPACE_FAMILIES: ReadonlySet<string> = new Set([
  "courier", "courier new", "consolas", "menlo", "monaco", "fira code", "fira mono", "jetbrains mono",
  "source code pro", "ibm plex mono", "roboto mono", "sf mono", "ubuntu mono", "cascadia code",
]);

const FAMILY_NAME = /^[A-Za-z][A-Za-z0-9 -]*$/;

/** The sanitized family list, generic last unless the schema placed one itself; null when nothing usable remains. */
export function fontFamilyList(declared: string | null): readonly string[] | null {
  if (declared === null) return null;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const raw of declared.split(",")) {
    let entry = raw.trim();
    const quote = entry[0];
    if ((quote === "'" || quote === '"') && entry.length >= 2 && entry.endsWith(quote)) entry = entry.slice(1, -1).trim();
    entry = entry.replace(/\s+/g, " ");
    if (entry.length === 0 || entry.length > MAX_FAMILY_LENGTH || !FAMILY_NAME.test(entry)) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(GENERIC_FAMILIES.has(key) ? key : entry);
    if (names.length === MAX_FAMILIES) break;
  }
  if (names.length === 0) return null;
  if (names.some((name) => GENERIC_FAMILIES.has(name))) return names;
  const first = names[0]!.toLowerCase();
  const generic = SERIF_FAMILIES.has(first) ? "serif" : MONOSPACE_FAMILIES.has(first) ? "monospace" : "sans-serif";
  return [...names, generic];
}

/**
 * The value of a Tailwind arbitrary `[font-family:...]` class: named families in single quotes,
 * generics bare, separated by commas; spaces become underscores (Tailwind turns them back into
 * spaces). Sanitized names contain no quotes, commas, underscores or brackets, so nothing needs
 * escaping beyond that.
 */
export function fontFamilyValue(families: readonly string[]): string {
  return families.map((name) => (GENERIC_FAMILIES.has(name) ? name : "'" + name + "'").replace(/ /g, "_")).join(",");
}
