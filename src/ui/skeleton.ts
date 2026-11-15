import { SKELETON_EDGES } from '../analysis/landmarks';
import type { Landmark } from '../analysis/types';

/** Draw a pose onto a canvas whose drawing area maps to the full image. */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[] | null,
  w: number,
  h: number,
  scale = 1,
): void {
  if (!lm) return;
  const lw = Math.max(2, 3 * scale);
  ctx.lineCap = 'round';
  for (const [a, b] of SKELETON_EDGES) {
    const p = lm[a];
    const q = lm[b];
    if (!p || !q || p.v < 0.3 || q.v < 0.3) continue;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = lw + 2;
    line(ctx, p, q, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lw;
    line(ctx, p, q, w, h);
  }
  for (let i = 0; i < lm.length; i++) {
    const p = lm[i]!;
    if (i > 0 && i < 11 && i !== 7 && i !== 8) continue; // skip face detail
    if (i > 16 && i < 23) continue; // skip finger points
    if (p.v < 0.3) continue;
    ctx.fillStyle = p.v >= 0.7 ? '#22c55e' : p.v >= 0.5 ? '#facc15' : '#ef4444';
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, Math.max(3, 4.5 * scale), 0, Math.PI * 2);
    ctx.fill();
  }
}

function line(ctx: CanvasRenderingContext2D, p: Landmark, q: Landmark, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(p.x * w, p.y * h);
  ctx.lineTo(q.x * w, q.y * h);
  ctx.stroke();
}

/** Index of the frame whose time is closest to t (frames sorted by time). */
export function nearestFrame(times: number[], t: number): number {
  if (!times.length) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(times[lo]! - t) <= Math.abs(times[hi]! - t) ? lo : hi;
}
