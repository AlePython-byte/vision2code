import type { UINode } from "@vision2code/contracts";

/**
 * Text heuristics shared by the generator (to decide how a text box wraps) and by the fidelity
 * metrics (to count the same nodes). Pure and dependency-free.
 */

/** Average glyph width as a fraction of the font size; a rough, documented approximation. */
export const TEXT_WIDTH_FACTOR = 0.55;
/** Font size assumed when the schema has none (the browser default). */
export const DEFAULT_FONT_SIZE = 16;
/** Line height assumed, as a multiple of the font size, when the schema has none. */
export const DEFAULT_LINE_HEIGHT_FACTOR = 1.2;
/** A text box up to this many line heights tall is treated as a single line. */
export const SINGLE_LINE_MAX_LINES = 1.5;

/**
 * Single-line text: the content has no line break and the box is at most 1.5 line heights tall,
 * where the line height is text.lineHeight (px) or, when absent, 1.2 x the font size. With
 * `paddingAware` the node's own vertical padding is not counted as text height: a 40 px button with
 * 8 px padding holds one 24 px line. Generator v2 ignored that (default); v3 and the metrics use it.
 */
export function isSingleLineText(node: UINode, options: { readonly paddingAware?: boolean } = {}): boolean {
  const text = node.text;
  if (text === null || /[\r\n]/.test(text.content)) return false;
  const fontSize = text.fontSize ?? DEFAULT_FONT_SIZE;
  const lineHeight = text.lineHeight ?? fontSize * DEFAULT_LINE_HEIGHT_FACTOR;
  const padding = options.paddingAware ? node.layout.padding.top + node.layout.padding.bottom : 0;
  return Math.max(0, node.bounds.height - padding) <= lineHeight * SINGLE_LINE_MAX_LINES;
}

/**
 * Estimated rendered width of the text on one line:
 * characters (code points) x fontSize x 0.55, rounded to 2 decimals so float noise never decides
 * a comparison. An approximation, not a font measurement.
 */
export function estimateTextWidth(node: UINode): number {
  const text = node.text;
  if (text === null) return 0;
  const width = [...text.content].length * (text.fontSize ?? DEFAULT_FONT_SIZE) * TEXT_WIDTH_FACTOR;
  return Math.round(width * 100) / 100;
}
