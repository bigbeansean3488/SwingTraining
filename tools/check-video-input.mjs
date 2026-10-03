// Milestone 1 browser check: valid video loads + metadata; invalid files fail clearly.
// Usage: node tools/check-video-input.mjs <video-file> [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openApp, startSession } from './browser.mjs';

const videoPath = process.argv[2];
const outDir = process.argv[3] || os.tmpdir();
if (!videoPath) { console.error('usage: node tools/check-video-input.mjs <video> [outDir]'); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swing-'));
const txt = path.join(tmp, 'notes.txt');
fs.writeFileSync(txt, 'not a video');
const fakeMp4 = path.join(tmp, 'corrupt.mp4');
fs.writeFileSync(fakeMp4, Buffer.alloc(4096, 7));

const { page, logs, close } = await openApp();
await startSession(page);
let failures = 0;
const expect = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

async function upload(file) {
  await page.evaluate(() => { window.__swingDebug = undefined; });
  const input = await page.$('#video-input');
  await input.uploadFile(file);
  await page.waitForFunction(() => window.__swingDebug !== undefined, { timeout: 60000 });
  await page.evaluate(() => document.getElementById('video').pause());
  return page.evaluate(() => window.__swingDebug);
}

try {
  const bad1 = await upload(txt);
  expect(bad1.error && /Not a video/.test(bad1.error), `text file rejected: ${bad1.error}`);
  expect(await page.$eval('#video-error', (e) => !e.hidden), 'error message visible');

  const bad2 = await upload(fakeMp4);
  expect(!!bad2.error, `corrupt .mp4 rejected: ${bad2.error}`);

  const ok = await upload(videoPath);
  expect(!ok.error, 'valid video loaded');
  if (!ok.error) {
    console.log('metadata', JSON.stringify(ok.meta), 'fps', JSON.stringify(ok.fpsInfo));
    expect(ok.meta.duration > 0 && ok.meta.width > 0, 'duration and dimensions present');
    expect(ok.fpsInfo.fps === null || (ok.fpsInfo.fps > 1 && ok.fpsInfo.fps < 300), 'fps either null or plausible');
    expect(await page.$eval('#video-error', (e) => e.hidden), 'error cleared after valid load');
    const playable = await page.evaluate(async () => {
      const v = document.getElementById('video');
      const t0 = v.currentTime; await v.play(); await new Promise((r) => setTimeout(r, 800)); v.pause();
      return v.currentTime > t0;
    });
    expect(playable, 'video plays (currentTime advances)');
    await page.screenshot({ path: path.join(outDir, 'm1-video-input.png'), fullPage: true });
  }
  expect(!logs.some((l) => l.startsWith('[pageerror]')), 'no uncaught page errors');
} finally {
  if (logs.length) console.log(logs.join('\n'));
  await close();
}
process.exit(failures ? 1 : 0);
