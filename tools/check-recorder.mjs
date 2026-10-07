// End-to-end check of the in-app recorder (camera preview + framing guide +
// recording → analysis) in headless Chrome with a fake camera.
// Usage: node tools/check-recorder.mjs <outDir> [fakeCamera.mjpeg] [recordSeconds=4]
//   Without a fake camera file Chrome shows a test pattern (no person).
//   Make one from real footage with tools/make-fake-camera.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { openApp, startSession } from './browser.mjs';

const [outDir, fakeCamera, seconds = '4'] = process.argv.slice(2);
if (!outDir) { console.error('usage: node tools/check-recorder.mjs <outDir> [fakeCamera.mjpeg] [recordSeconds]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
const expect = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const { page, logs, close } = await openApp({ fakeCamera: fakeCamera && path.resolve(fakeCamera) });
const text = (sel) => page.$eval(sel, (e) => e.innerText);
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await startSession(page, 'Recorder');
  await page.evaluate(() => { window.__app.poseModel = 'lite'; });
  expect(await page.$eval('#record-btn', (e) => !e.hidden && /錄影/.test(e.textContent)), '● 錄影 is the primary action when a camera is available');
  expect(/選影片/.test(await text('#next-btn')), 'library picker is the secondary action (選影片)');

  await page.click('#record-btn');
  await page.waitForFunction(() => !document.getElementById('recorder').hidden && document.querySelector('.rec-video')?.readyState >= 2, { timeout: 20000 });
  expect(true, 'recorder opens with a live camera preview');
  await page.waitForFunction(() => document.querySelectorAll('.rec-checks li').length >= 1 && !/正在/.test(document.querySelector('.rec-checks').innerText), { timeout: 120000 });
  const checks = await text('.rec-checks');
  console.log('framing:', checks.replace(/\n/g, ' | '));
  expect(/沒有偵測到人|全身|大小|位置|靠|看不到/.test(checks), 'live framing check shows a concrete instruction');
  const overlay = await page.$eval('.rec-overlay', (c) => ({ w: c.width, h: c.height }));
  expect(overlay.w > 0 && overlay.h > 0, `guide overlay drawn over the preview (${overlay.w}×${overlay.h})`);
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, panelBottom: document.querySelector('.rec-main').getBoundingClientRect().bottom, vh: innerHeight }));
  expect(o.sw <= o.iw && o.panelBottom <= o.vh, 'recorder fits the phone screen (no overflow, record button visible)');
  await shot('rec-framing');

  await page.click('[data-rec="record"]');
  await page.waitForFunction(() => !document.querySelector('.rec-timer').hidden, { timeout: 5000 });
  expect(/停止並分析/.test(await text('[data-rec="record"]')), 'recording: button becomes 停止並分析, timer shown');
  await new Promise((r) => setTimeout(r, Number(seconds) * 1000));
  await shot('rec-recording');
  await page.evaluate(() => { window.__swingDebug = undefined; });
  await page.click('[data-rec="record"]');
  await page.waitForFunction(() => document.getElementById('recorder').hidden, { timeout: 20000 });
  await page.waitForFunction(() => window.__swingDebug?.meta || window.__swingDebug?.error, { timeout: 60000 });
  const meta = await page.evaluate(() => window.__swingDebug.meta || { error: window.__swingDebug.error });
  console.log('recorded file:', JSON.stringify(meta));
  expect(!meta.error && Math.abs(meta.duration - Number(seconds)) < 2, `recorded video loads with a finite duration (${meta.duration?.toFixed?.(1)} s)`);
  await page.waitForFunction(() => window.__swingDebug?.recordId || window.__swingDebug?.batchDone || window.__swingDebug?.poseError || (window.__app.status?.error && !window.__app.busy), { timeout: 60 * 60000, polling: 1000 });
  const res = await page.evaluate(() => ({ status: window.__app.status, seg: window.__swingDebug.segmentation, swings: window.__app.swings.map((s) => ({ n: s.number, status: s.analysis.status, reason: s.analysis.reason, qc: s.poseQuality?.level })) }));
  console.log('analysis:', JSON.stringify(res));
  expect(true, 'recording handed to the analysis workflow');
  const b64 = await page.evaluate(async () => {
    const buf = new Uint8Array(await window.__app.video.file.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.writeFileSync(path.join(outDir, 'recorded.mp4'), Buffer.from(b64, 'base64'));
  expect(/儲存這段影片/.test(await text('#practice-save')), 'in-app recording can be saved (not in the photo library)');
  await shot('rec-result');

  const pageErrors = logs.filter((l) => l.startsWith('[pageerror]'));
  expect(!pageErrors.length, `no uncaught page errors${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`);
} finally {
  await close();
}
process.exit(failures ? 1 : 0);
