/**
 * Deterministic generated avatar. Pure: no imports, no I/O, no clock, no randomness beyond the seed.
 * The seed is the Supabase user id (never the e-mail address), so the same account always gets the same face and
 * two accounts almost never share one. FNV-1a turns the seed into a 32-bit number; mulberry32 draws from it.
 */

export const AVATAR_PALETTE_COUNT = 8;
export const AVATAR_EYE_VARIANTS = ["dots", "wide", "sleepy", "wink", "happy"] as const;
export type AvatarEyes = (typeof AVATAR_EYE_VARIANTS)[number];

export interface AvatarSpec {
  /** Index into the palettes declared as `--avatar-<n>-*` tokens in foundation.css (0-based here, 1-based there). */
  readonly palette: number;
  /** Closed SVG path of the blob, in a 64 x 64 view box. */
  readonly blobPath: string;
  readonly eyes: AvatarEyes;
}

/** 32-bit FNV-1a over the UTF-16 code units of the seed. */
export function fnv1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a small seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CENTER = 32;
const POINTS = 8;
const BASE_RADIUS = 23;
const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A closed Catmull-Rom spline through the points, written as cubic Béziers: the control points of the segment
 * Pi -> Pi+1 are Pi + (Pi+1 - Pi-1) / 6 and Pi+1 - (Pi+2 - Pi) / 6.
 */
export function smoothClosedPath(points: ReadonlyArray<readonly [number, number]>): string {
  const count = points.length;
  const at = (index: number) => points[((index % count) + count) % count]!;
  let path = `M${round(at(0)[0])} ${round(at(0)[1])}`;
  for (let index = 0; index < count; index += 1) {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    const c1 = [x1 + (x2 - x0) / 6, y1 + (y2 - y0) / 6] as const;
    const c2 = [x2 - (x3 - x1) / 6, y2 - (y3 - y1) / 6] as const;
    path += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(x2)} ${round(y2)}`;
  }
  return `${path}Z`;
}

export function avatarSpec(seed: string): AvatarSpec {
  const random = mulberry32(fnv1a(seed));
  const palette = Math.floor(random() * AVATAR_PALETTE_COUNT);
  const eyes = AVATAR_EYE_VARIANTS[Math.floor(random() * AVATAR_EYE_VARIANTS.length)]!;
  const points: Array<readonly [number, number]> = [];
  for (let index = 0; index < POINTS; index += 1) {
    // Eight points around a circle: a small angle wobble and a radius between 82% and 112% of the base.
    const angle = ((index + (random() - 0.5) * 0.3) / POINTS) * Math.PI * 2;
    const radius = BASE_RADIUS * (0.82 + random() * 0.3);
    points.push([CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius]);
  }
  return Object.freeze({ palette, blobPath: smoothClosedPath(points), eyes });
}
