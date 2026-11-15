// 2-D geometry helpers (pixel space).

export interface Vec {
  x: number;
  y: number;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Interior angle ABC in degrees (0..180); 180 = straight line. */
export function angleAt(a: Vec, b: Vec, c: Vec): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (n === 0) return NaN;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Signed angle (degrees) of the segment from `base` to `tip` relative to image
 * vertical (up). Positive when the tip leans toward `forward` (+1 = image right).
 */
export function leanFromVertical(base: Vec, tip: Vec, forward: 1 | -1): number {
  const dx = (tip.x - base.x) * forward;
  const up = base.y - tip.y; // image y grows downward
  return (Math.atan2(dx, up) * 180) / Math.PI;
}
