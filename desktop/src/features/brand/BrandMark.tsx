/**
 * The Vision2Code symbol: a capture viewfinder (four corners) around code brackets.
 *
 * It draws only the symbol with `currentColor`, so the parent (`.brand-mark`) supplies the violet tile and the label.
 * The geometry mirrors `src-tauri/icons/source/logo.svg`, the single source of the app icons.
 * Decorative on purpose: the parent button has an aria-label, and the login shows the name as text next to it.
 */
export function BrandMark() {
  return (
    <svg className="brand-mark-symbol" viewBox="9 9 46 46" aria-hidden="true" focusable="false" fill="none"
      stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 23V11H23M41 11H53V23M11 41V53H23M41 53H53V41" />
      <path d="M24 25L17 32L24 39M40 25L47 32L40 39M35 24L29 40" />
    </svg>
  );
}
