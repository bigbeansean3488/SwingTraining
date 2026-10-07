// Convert a video segment into an MJPEG file that Chrome can use as a fake
// camera (--use-file-for-fake-video-capture), so the in-app recorder can be
// tested with a real person in front of the "camera".
// Usage: node tools/make-fake-camera.mjs <video> <start> <end> <out.mjpeg> [width=540] [fps=30]
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './browser.mjs';

const [videoPath, start, end, out, width = '540', fps = '30'] = process.argv.slice(2);
if (!videoPath || !start || !end || !out) { console.error('usage: node tools/make-fake-camera.mjs <video> <start> <end> <out.mjpeg> [width] [fps]'); process.exit(2); }

const rel = path.relative(process.cwd(), path.resolve(videoPath)).split(path.sep).map(encodeURIComponent).join('/');
const { page, close } = await openApp();
try {
  const frames = await page.evaluate(async (src, s, e, w, f) => {
    const v = document.createElement('video');
    v.muted = true;
    v.src = src;
    await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('cannot load video')); });
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round((w * v.videoHeight) / v.videoWidth / 2) * 2;
    const ctx = c.getContext('2d');
    const outFrames = [];
    for (let t = s; t <= e; t += 1 / f) {
      await new Promise((r) => { v.onseeked = r; v.currentTime = t; });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      outFrames.push(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }
    return outFrames;
  }, `/${rel}`, Number(start), Number(end), Number(width), Number(fps));
  fs.writeFileSync(out, Buffer.concat(frames.map((b) => Buffer.from(b, 'base64'))));
  console.log(`wrote ${frames.length} frames to ${out}`);
} finally {
  await close();
}
