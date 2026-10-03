// Compare the two pose extraction methods on the same video window:
// seek-per-frame (extractPoseSequence, exact frames) vs playback
// (extractPoseByPlayback, used for long multi-swing recordings).
// Reports speed and, for frames at matching media times, landmark agreement.
// Usage: node tools/compare-extraction.mjs <video> <start> <end> [model=full] [targetFps=30]
import { openApp, startSession } from './browser.mjs';

const [videoPath, start, end, model = 'full', targetFps = '30'] = process.argv.slice(2);
if (!videoPath || !start || !end) { console.error('usage: node tools/compare-extraction.mjs <video> <start> <end> [model] [targetFps]'); process.exit(2); }

const { page, logs, close } = await openApp();
try {
  await startSession(page);
  await page.evaluate(() => { window.__app.multiSwing = false; });
  const input = await page.$('#video-input');
  await input.uploadFile(videoPath);
  await page.waitForFunction(() => window.__swingDebug?.meta || window.__swingDebug?.error, { timeout: 60000 });
  await page.waitForFunction(() => !window.__app.busy, { timeout: 30 * 60000, polling: 500 });
  const r = await page.evaluate(async (s, e, m, f) => {
    const mp = await import('/src/pose/mediapipe.js');
    const video = document.getElementById('video');
    const fps = window.__app.video.fpsInfo?.reliable ? window.__app.video.fpsInfo.fps : 30;
    const a = await mp.extractPoseSequence(video, { variant: m, start: s, end: e, sampleFps: f });
    const b = await mp.extractPoseByPlayback(video, { variant: m, start: s, end: e, targetFps: f, videoFps: fps });
    // Match frames by media time (within a quarter frame).
    const diffs = [];
    let nullMismatch = 0;
    for (const fb of b.frames) {
      let best = null;
      for (const fa of a.frames) if (!best || Math.abs(fa.t - fb.t) < Math.abs(best.t - fb.t)) best = fa;
      if (!best || Math.abs(best.t - fb.t) > 0.25 / fps) continue;
      if (!best.lm || !fb.lm) { if (!!best.lm !== !!fb.lm) nullMismatch++; continue; }
      // Mean landmark distance in pixels over landmarks visible in both.
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 33; i++) {
        if (best.lm[i][3] < 0.5 || fb.lm[i][3] < 0.5) continue;
        sum += Math.hypot((best.lm[i][0] - fb.lm[i][0]) * a.width, (best.lm[i][1] - fb.lm[i][1]) * a.height);
        n++;
      }
      if (n) diffs.push({ t: fb.t, px: sum / n });
    }
    // Which seek frame does each playback frame resemble most? (offset in s)
    const dist = (x, y) => { let sum = 0; let n = 0; for (let i = 0; i < 33; i++) { if (x[i][3] < 0.5 || y[i][3] < 0.5) continue; sum += Math.hypot((x[i][0] - y[i][0]) * a.width, (x[i][1] - y[i][1]) * a.height); n++; } return n ? sum / n : Infinity; };
    const offsets = b.frames.filter((fb) => fb.lm).map((fb) => {
      let best = null;
      for (const fa of a.frames) {
        if (!fa.lm || Math.abs(fa.t - fb.t) > 0.3) continue;
        const d = dist(fa.lm, fb.lm);
        if (!best || d < best.d) best = { d, off: fa.t - fb.t };
      }
      return best ? Math.round(best.off * 1000) : null;
    });
    diffs.sort((x, y) => x.px - y.px);
    const q = (p) => diffs[Math.min(diffs.length - 1, Math.floor(p * diffs.length))]?.px;
    return {
      video: { width: a.width, height: a.height, fps },
      seek: { frames: a.frames.length, ms: a.processingMs },
      playback: { frames: b.frames.length, ms: b.processingMs, sampleFps: b.sampleFps, playbackRate: b.playbackRate },
      matched: diffs.length, nullMismatch,
      pxMedian: q(0.5), pxP90: q(0.9), pxMax: diffs[diffs.length - 1]?.px,
      worst: diffs.slice(-3),
      bestMatchOffsetMs: offsets,
    };
  }, Number(start), Number(end), model, Number(targetFps));
  console.log(JSON.stringify(r, null, 2));
} finally {
  const errs = logs.filter((l) => /pageerror|error/i.test(l));
  if (errs.length) console.log(errs.slice(0, 10).join('\n'));
  await close();
}
