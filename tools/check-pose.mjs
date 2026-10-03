// Milestone 2 browser check: run pose extraction on a video window and dump
// coverage, the PoseSequence JSON, and overlay screenshots for visual review.
// Usage: node tools/check-pose.mjs <video> <start> <end> [variant=full] [outDir] [shots=6] [fps]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openApp } from './browser.mjs';

const [videoPath, start = '0', end = '5', variant = 'full', outDir = os.tmpdir(), shots = '6', fps] = process.argv.slice(2);
if (!videoPath) { console.error('usage: node tools/check-pose.mjs <video> <start> <end> [variant] [outDir] [shots] [fps]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

const { page, logs, close } = await openApp();
try {
  const input = await page.$('#video-input');
  await input.uploadFile(videoPath);
  await page.waitForFunction(() => window.__swingDebug?.meta || window.__swingDebug?.error, { timeout: 60000 });
  await page.evaluate((s, e, v, f) => {
    document.getElementById('range-start').value = s;
    document.getElementById('range-end').value = e;
    document.getElementById('model-variant').value = v;
    if (f) window.__forceSampleFps = Number(f);
  }, start, end, variant, fps);
  const t0 = Date.now();
  await page.click('#analyze-btn');
  await page.waitForFunction(() => window.__swingDebug?.pose || window.__swingDebug?.poseError, { timeout: 30 * 60000, polling: 1000 });
  const dbg = await page.evaluate(() => ({ pose: window.__swingDebug.pose, coverage: window.__swingDebug.coverage, err: window.__swingDebug.poseError }));
  if (dbg.err) throw new Error(dbg.err);
  const { pose, coverage } = dbg;
  console.log(`model=${pose.model} delegate=${pose.delegate} frames=${pose.frames.length} wall=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('poseFraction', coverage.poseFraction.toFixed(3));
  for (const [g, v] of Object.entries(coverage.groups)) console.log(`  ${g.padEnd(10)} ${(v * 100).toFixed(1)}%`);
  const base = `pose-${path.basename(videoPath)}-${start}-${end}-${variant}`;
  fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify(pose));
  const n = Number(shots);
  const stage = await page.$('.stage');
  for (let i = 0; i < n; i++) {
    const f = pose.frames[Math.round((i / Math.max(1, n - 1)) * (pose.frames.length - 1))];
    await page.evaluate(async (t) => {
      const v = document.getElementById('video');
      await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; });
      await new Promise((r) => setTimeout(r, 200));
    }, f.t);
    await stage.screenshot({ path: path.join(outDir, `${base}-${String(i).padStart(2, '0')}-t${f.t.toFixed(2)}.png`) });
  }
  console.log('wrote', path.join(outDir, base) + '*');
} finally {
  const errs = logs.filter((l) => /error|warn/i.test(l));
  if (errs.length) console.log(errs.slice(0, 20).join('\n'));
  await close();
}
