// Frame-rate estimation from observed frame presentation times.
// Browsers do not expose a video's frame rate directly. We only report one
// when consecutive-frame timestamp deltas are consistent; otherwise null.

/**
 * @param {{mediaTime:number, presentedFrames:number}[]} samples
 *   Callbacks from requestVideoFrameCallback, in order.
 * @param {{minPairs?:number, tolerance?:number, minAgreement?:number}} [opts]
 * @returns {{fps:number|null, reliable:boolean, reason:string, pairs:number, medianDelta:number|null}}
 */
export function estimateFrameRate(samples, opts = {}) {
  const { minPairs = 10, tolerance = 0.1, minAgreement = 0.8 } = opts;
  const deltas = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    // Only use pairs known to be adjacent frames; skipped frames would
    // inflate the delta.
    if (b.presentedFrames - a.presentedFrames !== 1) continue;
    const d = b.mediaTime - a.mediaTime;
    if (d > 0) deltas.push(d);
  }
  if (deltas.length < minPairs) {
    return { fps: null, reliable: false, reason: `too few consecutive frames observed (${deltas.length} < ${minPairs})`, pairs: deltas.length, medianDelta: null };
  }
  const sorted = [...deltas].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)];
  const agree = deltas.filter((d) => Math.abs(d - med) <= tolerance * med).length / deltas.length;
  if (agree < minAgreement) {
    return { fps: null, reliable: false, reason: `frame intervals inconsistent (${Math.round(agree * 100)}% agree)`, pairs: deltas.length, medianDelta: med };
  }
  return { fps: 1 / med, reliable: true, reason: 'consistent frame intervals', pairs: deltas.length, medianDelta: med };
}

const VIDEO_EXT = ['mov', 'mp4', 'm4v', 'webm', '3gp'];

/**
 * Cheap pre-check before handing a file to <video>. The browser has the
 * final word on whether it can decode it.
 * @param {{name:string, type:string, size:number}} file
 */
export function checkVideoFile(file) {
  if (!file) return { ok: false, reason: '沒有選擇檔案。' };
  if (file.size === 0) return { ok: false, reason: '檔案是空的。' };
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const typeOk = typeof file.type === 'string' && file.type.startsWith('video/');
  // iOS sometimes reports an empty MIME type; fall back to the extension.
  if (!typeOk && !VIDEO_EXT.includes(ext)) {
    return { ok: false, reason: `這不是影片檔（${file.type || ext || '未知格式'}）。` };
  }
  return { ok: true, reason: '' };
}
