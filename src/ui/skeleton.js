// Skeleton overlay drawn on a <canvas> stacked over the <video>.
import { SKELETON_EDGES, VIS_THRESHOLD, NUM_LANDMARKS } from '../pose/landmarks.js';

const OK = '#46c27a';
const LOW = '#e5534b';

/** Size the canvas backing store to the displayed video size. */
export function syncCanvas(canvas, video) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(video.clientWidth * dpr);
  const h = Math.round(video.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

/**
 * Draw one frame's landmarks. Low-visibility landmarks/edges are drawn red
 * and dashed so unreliable tracking is visible rather than hidden.
 */
export function drawSkeleton(canvas, lm, { threshold = VIS_THRESHOLD, trails = [] } = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const lw = Math.max(2, W / 200);

  for (const trail of trails) drawTrail(ctx, trail, W, H, lw);
  if (!lm) return;

  ctx.lineCap = 'round';
  for (const [a, b] of SKELETON_EDGES) {
    const pa = lm[a];
    const pb = lm[b];
    const ok = pa[3] >= threshold && pb[3] >= threshold;
    ctx.strokeStyle = ok ? OK : LOW;
    ctx.lineWidth = lw;
    ctx.setLineDash(ok ? [] : [lw * 2, lw * 2]);
    ctx.beginPath();
    ctx.moveTo(pa[0] * W, pa[1] * H);
    ctx.lineTo(pb[0] * W, pb[1] * H);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (let i = 0; i < NUM_LANDMARKS; i++) {
    const p = lm[i];
    ctx.fillStyle = p[3] >= threshold ? '#fff' : LOW;
    ctx.beginPath();
    ctx.arc(p[0] * W, p[1] * H, lw * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** trail: { points: [[x,y] normalized image coords], color } */
function drawTrail(ctx, trail, W, H, lw) {
  const pts = trail.points.filter(Boolean);
  if (pts.length < 2) return;
  ctx.strokeStyle = trail.color;
  ctx.globalAlpha = trail.alpha ?? 1;
  ctx.lineWidth = lw * (trail.width ?? 0.8);
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
  for (const p of pts.slice(1)) ctx.lineTo(p[0] * W, p[1] * H);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Index of the frame whose time is closest to t (frames sorted by t). */
export function nearestFrameIndex(frames, t) {
  let lo = 0;
  let hi = frames.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(frames[lo - 1].t - t) < Math.abs(frames[lo].t - t)) return lo - 1;
  return lo;
}
