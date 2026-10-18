/**
 * UISchema v1 -> simplified block model for thumbnails. Pure: no imports, no I/O, no clock, no randomness.
 *
 * The model is deliberately NOT faithful: it keeps proportions and hierarchy (frames, text lines, images, buttons,
 * inputs, dividers, icons) in a fixed 160 x 100 view box and says nothing about colour. The schema's own colours
 * are never read for painting (only to tell a dark surface from a light one), so the component paints every block
 * with design tokens and both themes are covered.
 *
 * It accepts `unknown` and never throws: an invalid or empty schema gives an empty model, and a huge or deeply
 * nested one is cut at `THUMB_MAX_NODES` / `THUMB_MAX_DEPTH` / `THUMB_MAX_BLOCKS` (traversal is iterative, so depth
 * cannot overflow the stack).
 */

export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 100;
export const THUMB_MAX_DEPTH = 8;
export const THUMB_MAX_NODES = 300;
export const THUMB_MAX_BLOCKS = 400;

export type ThumbKind = "page" | "frame" | "text" | "image" | "icon" | "button" | "input" | "divider";
/** How a block is painted; the component maps each tone to a token. */
export type ThumbTone = "light" | "deep" | "outline" | "strong" | "muted" | "accent" | "onaccent" | "field";

export interface ThumbBlock {
  readonly kind: ThumbKind;
  readonly tone: ThumbTone;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Corner radius in view-box units. */
  readonly r: number;
  /** Sits on a dark surface (its nearest filled frame or the page is dark): text and lines are drawn light. */
  readonly dark: boolean;
}

export interface SchemaThumbnailModel {
  readonly width: typeof THUMB_WIDTH;
  readonly height: typeof THUMB_HEIGHT;
  /** Back to front. */
  readonly blocks: readonly ThumbBlock[];
  /** Nodes read from the schema (never more than THUMB_MAX_NODES). */
  readonly nodeCount: number;
  /** The schema had more nodes, depth or blocks than the limits allow. */
  readonly truncated: boolean;
  /** Nothing drawable: callers show a placeholder. */
  readonly empty: boolean;
}

const EMPTY: SchemaThumbnailModel = Object.freeze({
  width: THUMB_WIDTH, height: THUMB_HEIGHT, blocks: Object.freeze([]), nodeCount: 0, truncated: false, empty: true,
});

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Relative luminance of a `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` colour; `null` when absent, invalid or transparent. */
function luminanceOf(color: unknown): number | null {
  if (typeof color !== "string") return null;
  const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(color.trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length <= 4) hex = [...hex].map((digit) => digit + digit).join("");
  const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  if (alpha < 0.1) return null;
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

interface Frame { x: number; y: number; w: number; h: number }

/** Reads `bounds` (screenshot-relative, as the schema documents) and maps it into the view box. */
function boundsOf(node: Json, scale: number): Frame | null {
  const bounds = node.bounds;
  if (!isObject(bounds) || !finite(bounds.x) || !finite(bounds.y) || !finite(bounds.width) || !finite(bounds.height)) return null;
  if (bounds.width < 0 || bounds.height < 0) return null;
  return { x: bounds.x * scale, y: bounds.y * scale, w: bounds.width * scale, h: bounds.height * scale };
}

/** Intersection with the view box; `null` when nothing visible remains or it is smaller than a hair. */
function clip(frame: Frame, minimum: number): Frame | null {
  const x0 = clamp(frame.x, 0, THUMB_WIDTH);
  const y0 = clamp(frame.y, 0, THUMB_HEIGHT);
  const x1 = clamp(frame.x + frame.w, 0, THUMB_WIDTH);
  const y1 = clamp(frame.y + frame.h, 0, THUMB_HEIGHT);
  if (x1 - x0 < minimum || y1 - y0 < minimum) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function typographyOf(node: Json): { size: number; weight: number; lineHeight: number | null; content: string; align: string } {
  const text = isObject(node.text) ? node.text : {};
  const size = finite(text.fontSize) && text.fontSize > 0 ? text.fontSize : 14;
  return {
    size,
    weight: finite(text.fontWeight) ? text.fontWeight : 400,
    lineHeight: finite(text.lineHeight) && text.lineHeight > 0 ? text.lineHeight : null,
    content: typeof text.content === "string" ? text.content : "",
    align: typeof text.textAlign === "string" ? text.textAlign : "START",
  };
}

export function schemaThumbnail(input: unknown): SchemaThumbnailModel {
  try {
    return build(input);
  } catch {
    return EMPTY;
  }
}

function build(input: unknown): SchemaThumbnailModel {
  if (!isObject(input) || !isObject(input.root)) return EMPTY;
  const root = input.root;
  const rootBounds = isObject(root.bounds) ? root.bounds : null;
  const source = isObject(input.source) ? input.source : null;
  const sourceWidth = source && finite(source.width) && source.width > 0 ? source.width
    : rootBounds && finite(rootBounds.width) && finite(rootBounds.x) && rootBounds.width + rootBounds.x > 0 ? rootBounds.width + rootBounds.x : 0;
  if (sourceWidth <= 0) return EMPTY;
  // Fit the width; a page taller than the box shows its top (a thumbnail keeps a stable aspect, it never shrinks to a sliver).
  const scale = THUMB_WIDTH / sourceWidth;

  const blocks: ThumbBlock[] = [];
  let nodeCount = 0;
  let truncated = false;
  const push = (block: Omit<ThumbBlock, "dark">, dark: boolean) => {
    if (blocks.length >= THUMB_MAX_BLOCKS) { truncated = true; return; }
    blocks.push(Object.freeze({ ...block, dark, x: round(block.x), y: round(block.y), w: round(block.w), h: round(block.h), r: round(block.r) }));
  };

  const stack: Array<{ node: unknown; depth: number; dark: boolean }> = [{ node: root, depth: 0, dark: false }];
  while (stack.length > 0) {
    const { node, depth, dark: inheritedDark } = stack.pop()!;
    let dark = inheritedDark;
    if (!isObject(node)) continue;
    if (nodeCount >= THUMB_MAX_NODES) { truncated = true; break; }
    nodeCount += 1;
    const frame = boundsOf(node, scale);
    if (!frame) continue; // an invalid node takes its subtree with it
    const type = typeof node.type === "string" ? node.type : "";
    const style = isObject(node.style) ? node.style : {};
    const background = luminanceOf(style.background);
    const border = isObject(style.border) && finite(style.border.width) && style.border.width > 0;
    const radius = finite(style.radius) ? clamp(style.radius * scale, 0, 40) : 0;
    const visible = clip(frame, 0.5);

    if (type === "DIVIDER") {
      // Thinner than the visibility threshold by design, so it is clipped on its own.
      const thickness = clamp(Math.min(frame.w, frame.h), 0.7, 1.6);
      const horizontal = frame.w >= frame.h;
      const long = clip(horizontal ? { x: frame.x, y: frame.y, w: frame.w, h: thickness } : { x: frame.x, y: frame.y, w: thickness, h: frame.h }, 0.5);
      if (long) push({ kind: "divider", tone: "outline", ...long, r: thickness / 2 }, dark);
    } else if (visible) {
      switch (type) {
        case "FRAME": {
          const isRoot = depth === 0;
          if (isRoot || background !== null) {
            dark = background !== null && background < 0.2;
            push({ kind: isRoot ? "page" : "frame", tone: dark ? "deep" : "light", ...visible, r: isRoot ? 0 : Math.min(radius, visible.h / 2) }, dark);
          } else if (border) push({ kind: "frame", tone: "outline", ...visible, r: Math.min(radius, visible.h / 2) }, dark);
          break;
        }
        case "IMAGE":
          push({ kind: "image", tone: "light", ...visible, r: Math.min(radius, visible.h / 2) }, dark);
          break;
        case "ICON": {
          const side = Math.min(visible.w, visible.h);
          push({ kind: "icon", tone: "accent", x: visible.x + (visible.w - side) / 2, y: visible.y + (visible.h - side) / 2, w: side, h: side, r: side / 2 }, dark);
          break;
        }
        case "BUTTON": {
          const filled = background !== null || !border;
          push({ kind: "button", tone: filled ? "accent" : "outline", ...visible, r: Math.min(Math.max(radius, 1), visible.h / 2) }, dark);
          const { content, size } = typographyOf(node);
          if (content.trim() && visible.w >= 8 && visible.h >= 3) {
            const barH = clamp(size * scale * 0.5, 0.9, visible.h * 0.4);
            const barW = clamp(content.length * size * scale * 0.5, 3, visible.w * 0.7);
            push({ kind: "text", tone: filled ? "onaccent" : "muted", x: visible.x + (visible.w - barW) / 2, y: visible.y + (visible.h - barH) / 2, w: barW, h: barH, r: barH / 2 }, dark);
          }
          break;
        }
        case "INPUT": {
          push({ kind: "input", tone: "field", ...visible, r: Math.min(Math.max(radius, 0.8), visible.h / 2) }, dark);
          const { content, size } = typographyOf(node);
          if (content.trim() && visible.w >= 8 && visible.h >= 3) {
            const barH = clamp(size * scale * 0.45, 0.8, visible.h * 0.35);
            const barW = clamp(content.length * size * scale * 0.5, 3, visible.w * 0.6);
            push({ kind: "text", tone: "muted", x: visible.x + Math.min(2, visible.w * 0.08), y: visible.y + (visible.h - barH) / 2, w: barW, h: barH, r: barH / 2 }, dark);
          }
          break;
        }
        case "TEXT": {
          const { size, weight, lineHeight, content, align } = typographyOf(node);
          const pitch = (lineHeight ?? size * 1.35) * scale;
          const lines = clamp(Math.round(frame.h / Math.max(pitch, 0.01)), 1, 4);
          const barH = clamp(size * scale * 0.5, 0.9, Math.max(pitch * 0.7, 0.9));
          const strong = size >= 20 || weight >= 600;
          const fraction = content ? clamp((content.length * size * 0.5 * scale) / Math.max(frame.w, 0.01), 0.25, 1) : 0.7;
          for (let line = 0; line < lines; line += 1) {
            const width = frame.w * (lines > 1 && line === lines - 1 ? Math.min(fraction, 0.6) : lines > 1 ? 1 : fraction);
            const y = frame.y + line * pitch + (pitch - barH) / 2;
            const x = align === "CENTER" ? frame.x + (frame.w - width) / 2 : align === "END" ? frame.x + frame.w - width : frame.x;
            const bar = clip({ x, y, w: width, h: barH }, 0.4);
            if (bar) push({ kind: "text", tone: strong ? "strong" : "muted", ...bar, r: bar.h / 2 }, dark);
          }
          break;
        }
        default:
          break;
      }
    }

    const children = node.children;
    if (Array.isArray(children) && children.length > 0) {
      if (depth + 1 > THUMB_MAX_DEPTH) { truncated = true; continue; }
      // Reversed so the stack pops children in document order: parents before children, siblings in paint order.
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ node: children[index], depth: depth + 1, dark });
    }
  }

  const drawable = blocks.some((block) => block.kind !== "page");
  if (!drawable) return Object.freeze({ ...EMPTY, nodeCount, truncated });
  return Object.freeze({ width: THUMB_WIDTH, height: THUMB_HEIGHT, blocks: Object.freeze(blocks), nodeCount, truncated, empty: false });
}

/** A small invented page (header, heading, two lines, a button) drawn by the same code, for loading and empty states. */
export const PLACEHOLDER_THUMBNAIL: SchemaThumbnailModel = schemaThumbnail({
  source: { width: 160, height: 100 },
  root: {
    type: "FRAME", bounds: { x: 0, y: 0, width: 160, height: 100 }, style: {}, children: [
      { type: "FRAME", bounds: { x: 8, y: 8, width: 144, height: 12 }, style: { border: { width: 1 }, radius: 4 }, children: [] },
      { type: "TEXT", bounds: { x: 12, y: 30, width: 90, height: 10 }, text: { content: "heading heading", fontSize: 20 }, style: {}, children: [] },
      { type: "TEXT", bounds: { x: 12, y: 46, width: 120, height: 14 }, text: { content: "line of text that goes on and on", fontSize: 8, lineHeight: 7 }, style: {}, children: [] },
      { type: "IMAGE", bounds: { x: 96, y: 62, width: 56, height: 30 }, style: {}, children: [] },
      { type: "BUTTON", bounds: { x: 12, y: 70, width: 40, height: 14 }, style: { radius: 7 }, children: [] },
    ],
  },
});
