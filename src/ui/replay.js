// Static skeleton replay for a stored swing: skeleton at peak hand speed,
// this swing's hand path, and recent valid swings' hand paths.
import { expandSequence, LM } from '../pose/landmarks.js';
import { drawSkeleton, nearestFrameIndex } from './skeleton.js';

export function drawReplay(canvas, sw, allSwings, maxW = 360) {
  if (!sw?.landmarks) return false;
  const seq = expandSequence(sw.landmarks);
  const aspect = seq.height / seq.width;
  const w = Math.min(maxW, 420);
  const h = Math.min(w * aspect, 460);
  const cw = h / aspect;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(h * dpr);
  const ev = sw.analysis.events;
  const tShow = ev?.peakHandSpeed ?? seq.frames[Math.floor(seq.frames.length / 2)]?.t;
  const k = nearestFrameIndex(seq.frames, tShow);
  const trails = [];
  if (ev?.motionStart !== undefined) {
    const handPt = (lm) => {
      const l = lm[LM.LEFT_WRIST];
      const r = lm[LM.RIGHT_WRIST];
      if (l[3] < 0.5 && r[3] < 0.5) return null;
      return [(l[0] * l[3] + r[0] * r[3]) / (l[3] + r[3]), (l[1] * l[3] + r[1] * r[3]) / (l[3] + r[3])];
    };
    const n = sw.analysis.normalization;
    if (n) {
      const prev = allSwings.filter((s) => s.valid && s.number < sw.number && s.analysis.trajectory).slice(-3);
      for (const p of prev) {
        trails.push({
          color: '#c792ea', alpha: 0.7, width: 0.7,
          points: p.analysis.trajectory.hands.map((q) => (q ? [(n.origin[0] + n.direction * q[0] * n.T) / seq.width, (n.origin[1] + q[1] * n.T) / seq.height] : null)),
        });
      }
    }
    trails.push({ color: '#ffd60a', width: 1.1, points: seq.frames.filter((f) => f.t >= ev.motionStart && f.t <= ev.swingEnd && f.lm).map((f) => handPt(f.lm)) });
  }
  drawSkeleton(canvas, seq.frames[k]?.lm ?? null, { trails });
  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  return true;
}
