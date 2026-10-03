// Milestone 9 end-to-end check of the practice loop in headless Chrome.
// Usage: node tools/check-practice.mjs [outDir] [video start end]
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openApp } from './browser.mjs';

const [outDir = os.tmpdir(), videoPath, vStart = '0', vEnd = '5'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const { page, logs, close } = await openApp();
let failures = 0;
const expect = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const swings = () => page.evaluate(() => window.__app.swings.map((s) => ({ id: s.id, number: s.number, valid: s.valid, score: s.consistency?.score ?? null, contact: s.contact, baselineIds: s.comparison?.baselineIds ?? null, label: s.video?.label })));
const ready = () => page.waitForFunction(() => window.__appReady === true, { timeout: 30000 });
const resultText = () => page.$eval('#result-card', (e) => e.innerText);
// The UI re-renders asynchronously after saves; click inside the page and let
// pending renders settle instead of holding element handles across renders.
async function click(sel) {
  await page.evaluate((q) => document.querySelector(q).click(), sel);
  await new Promise((r) => setTimeout(r, 150));
}

async function addDemo(kind) {
  const n = (await swings()).length;
  await page.evaluate((k) => document.querySelector(`[data-demo="${k}"]`).click(), kind);
  await page.waitForFunction((k) => window.__app.swings.length === k && document.querySelector('#result-card h2')?.textContent === `Swing #${k}`, { timeout: 30000 }, n + 1);
}

try {
  await ready();
  expect(await page.$eval('#start-card', (e) => !e.hidden), 'start screen shown on first visit');
  await page.type('#player-name', 'Test player');
  await page.select('#batting-side', 'R');
  await page.click('#start-session');
  await page.waitForFunction(() => !!window.__app.session);
  // Demo details must be open for clicks to land.
  await page.evaluate(() => { document.getElementById('demo-block').open = true; });

  for (const k of ['normal', 'normal', 'normal', 'longStride', 'badTracking', 'head']) await addDemo(k);
  let s = await swings();
  console.log(JSON.stringify(s.map(({ number, valid, score, label }) => ({ number, valid, score, label }))));
  expect(s.length === 6, '6 swings processed without reload');
  expect(s[0].score === null, 'first swing builds the baseline');
  expect(s[1].score >= 85 && s[2].score >= 85, `near-baseline swings score high (${s[1].score}, ${s[2].score})`);
  expect(s[3].score < s[1].score - 10, `longer stride scores lower (${s[3].score})`);
  expect(s[4].valid === false, 'tracking-failure swing rejected');
  expect(!s[5].baselineIds.includes(s[4].id), 'rejected swing not in later baseline');
  expect(s[5].baselineIds.length === 4, 'baseline = 4 previous valid swings');

  let txt = await resultText();
  expect(/More head movement than your last 4 swings/.test(txt), 'head-movement swing explained in plain words');
  await page.screenshot({ path: path.join(outDir, 'm9-result-head.png'), fullPage: true });

  // Inspect the rejected swing and the long-stride swing from history.
  await click(`#history [data-id="${s[4].id}"]`);
  txt = await resultText();
  expect(/Unable to reliably analyze this swing/.test(txt), 'rejected swing fails visibly');
  expect(/player lost for|tracking lost/.test(txt), 'rejected swing lists QC reasons');
  await page.screenshot({ path: path.join(outDir, 'm9-result-rejected.png'), fullPage: true });
  await click(`#history [data-id="${s[3].id}"]`);
  txt = await resultText();
  expect(/Stride\s+Longer than your baseline/.test(txt), 'longer stride explained');

  // Contact labels via result buttons.
  await click(`#history [data-id="${s[1].id}"]`);
  await click('#result-card [data-label="good"]');
  await page.waitForFunction(() => window.__app.swings[1].contact === 'good', { timeout: 5000 }).catch(() => {});
  await click(`#history [data-id="${s[3].id}"]`);
  await click('#result-card [data-label="poor"]');
  await page.waitForFunction(() => window.__app.swings[1].contact === 'good' && window.__app.swings[3].contact === 'poor', { timeout: 5000 }).catch(() => {});
  s = await swings();
  expect(s[1].contact === 'good' && s[3].contact === 'poor', 'contact labels stored');
  const counts = await page.$$eval('#label-view table:first-of-type tbody tr', (rows) => Object.fromEntries(rows.map((r) => [r.cells[0].textContent, Number(r.cells[1].textContent)])));
  expect(counts.good === 1 && counts.poor === 1 && counts.unlabeled === 3, `metrics-vs-label view counts labels ${JSON.stringify(counts)}`);

  // Refresh: session should survive.
  await page.reload({ waitUntil: 'load' });
  await ready();
  const after = await swings();
  expect(after.length === 6, `session survives refresh (${after.length} swings)`);
  expect(after[1].contact === 'good' && after[3].contact === 'poor', 'labels survive refresh');
  expect(JSON.stringify(after.map((x) => x.score)) === JSON.stringify(s.map((x) => x.score)), 'scores identical after refresh');
  expect(await page.$eval('#session-card', (e) => !e.hidden), 'active session restored');

  // Exclude a swing from the baseline → later comparisons recomputed.
  await click(`#history [data-id="${after[3].id}"]`);
  await page.evaluate(() => { document.querySelector('#result-card details').open = true; });
  await click('#result-card [data-action="exclude"]');
  await page.waitForFunction(() => window.__app.swings[3].excludeFromBaseline === true, { timeout: 5000 }).catch(() => {});
  const ex = await swings();
  expect(!ex[5].baselineIds.includes(ex[3].id), 'excluded swing removed from later baseline');

  if (videoPath) {
    const input = await page.$('#video-input');
    await page.evaluate(() => { window.__swingDebug = undefined; });
    await input.uploadFile(videoPath);
    await page.waitForFunction(() => window.__swingDebug?.meta || window.__swingDebug?.error, { timeout: 60000 });
    const long = await page.$eval('#range-block', (e) => !e.hidden);
    if (long) {
      await page.evaluate((a, b) => { document.getElementById('range-start').value = a; document.getElementById('range-end').value = b; }, vStart, vEnd);
      await page.click('#analyze-btn');
    }
    await page.waitForFunction(() => window.__swingDebug?.recordId || window.__swingDebug?.poseError, { timeout: 20 * 60000, polling: 1000 });
    const dbg = await page.evaluate(() => ({ err: window.__swingDebug.poseError, status: window.__swingDebug.analysis?.status, reason: window.__swingDebug.analysis?.reason, qc: window.__swingDebug.analysis?.qc?.reasons }));
    console.log('real video:', JSON.stringify(dbg));
    expect(!dbg.err, 'real video analyzed in the same session without reload');
    expect((await swings()).length === 7, 'real-video swing added to the session');
    await page.screenshot({ path: path.join(outDir, 'm9-real-video.png'), fullPage: true });
  }
  expect(!logs.some((l) => l.startsWith('[pageerror]')), 'no uncaught page errors');
} finally {
  const errs = logs.filter((l) => /pageerror|\[error\]/.test(l));
  if (errs.length) console.log(errs.join('\n'));
  await close();
}
process.exit(failures ? 1 : 0);
