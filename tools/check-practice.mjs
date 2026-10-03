// End-to-end check of the practice-first UI in headless Chrome (mobile viewport).
// Usage: node tools/check-practice.mjs [outDir] [video start end]
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openApp } from './browser.mjs';

const [outDir = os.tmpdir(), videoPath, vStart = '0', vEnd = '5'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const { page, logs, close } = await openApp();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.reload({ waitUntil: 'load' });

let failures = 0;
const expect = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const ready = () => page.waitForFunction(() => window.__appReady === true, { timeout: 30000 });
const swings = () => page.evaluate(() => window.__app.swings.map((s) => ({ id: s.id, number: s.number, valid: s.valid, contact: s.contact, exclude: s.excludeFromBaseline, baselineIds: s.comparison?.baselineIds ?? null })));
const visible = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
const text = (sel) => page.$eval(sel, (e) => e.innerText);
async function click(sel) {
  await page.evaluate((q) => { const e = document.querySelector(q); if (!e) throw new Error(`no element ${q}`); e.click(); }, sel);
  await new Promise((r) => setTimeout(r, 120));
}
async function shot(name) { await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }); }
async function noOverflow(label) {
  for (const width of [375, 390, 430]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 150));
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(o.sw <= o.iw, `${label} @${width}px: no horizontal overflow (${o.sw} ≤ ${o.iw})`);
    if (width === 375) await shot(`ui-${label}-375`);
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
}
async function addDemo(kind) {
  const n = (await swings()).length;
  await click('.tab[data-tab="settings"]');
  await click(`[data-demo="${kind}"]`);
  await page.waitForFunction((k) => window.__app.swings.length === k && !document.getElementById('view-practice').hidden && document.querySelector('#practice-result h2')?.textContent.startsWith(`Swing #${k}`), { timeout: 30000 }, n + 1);
}
const SIMPLIFIED = /[稳动击轨这较时节头没与开]/;
const dialogClick = (label) => page.evaluate((l) => [...document.querySelectorAll('#dialog [data-i]')].find((b) => b.textContent === l).click(), label);

try {
  await ready();
  // ---------------- Setup
  expect(await visible('#view-setup'), 'Setup shown on first visit');
  expect(!(await visible('[data-demo]')) && !(await visible('#model-variant')), 'no developer controls on Setup');
  const setupText = await text('#view-setup');
  expect(/今天誰要練？/.test(setupText) && /打擊側/.test(setupText) && /今天想看什麼？/.test(setupText), 'Setup asks player, batting side, focus');
  expect(/Guest 訪客/.test(setupText), 'Guest shortcut available');
  expect((await page.$$('#view-setup .btn-primary')).length === 1 && /開始訓練/.test(await text('#start-session')), 'one primary action: 開始訓練');
  const startH = await page.$eval('#start-session', (e) => e.getBoundingClientRect().height);
  expect(startH >= 56, `開始訓練 is large (${startH}px)`);
  await noOverflow('setup');
  await page.type('#player-name', 'Sean');
  await click('[data-action="pickSide"][data-side="R"]');
  await click('[data-action="pickFocus"][data-focus="stride"]');
  await click('#start-session');
  await page.waitForFunction(() => !!window.__app.session);
  expect(await page.evaluate(() => window.__app.session.focus === 'stride' && window.__app.session.playerName === 'Sean' && window.__app.session.battingSide === 'R'), 'session created with player, side, focus');

  // ---------------- Practice (empty)
  expect(await visible('#next-btn') && /＋ 下一棒/.test(await text('#next-btn')), 'dominant ＋ 下一棒 action visible');
  const nb = await page.$eval('#next-btn', (e) => { const r = e.getBoundingClientRect(); return { h: r.height, bottom: r.bottom, vh: innerHeight }; });
  expect(nb.h >= 60 && nb.bottom > nb.vh * 0.75, `＋ 下一棒 large and near the bottom (${nb.h}px, bottom ${Math.round(nb.bottom)}/${nb.vh})`);
  expect(!(await visible('#range-block')) && !(await visible('#range-start')), 'no From/To trim controls by default');
  expect(!(await visible('[data-demo]')), 'no synthetic controls during practice');
  await shot('ui-practice-empty');

  // ---------------- Developer Tools (debug) → synthetic swings
  await click('.tab[data-tab="settings"]');
  expect(!(await visible('[data-demo]')), 'Developer Tools hidden until enabled');
  await click('#debug-toggle');
  expect(await visible('[data-demo]') && await visible('#model-variant') && await visible('#env-status'), 'Developer Tools show synthetic swings, Pose model, environment');
  await shot('ui-settings-dev');
  for (const k of ['normal', 'normal', 'normal', 'longStride']) await addDemo(k);
  let res = await text('#practice-result');
  expect(/今日重點/.test(res) && /Stride Consistency/.test(res), 'result leads with 今日重點 = Training Focus');
  expect(/這一棒的 Stride 比最近 Baseline 明顯較長/.test(res), 'focus feedback describes the measurable difference');
  const sizes = await page.evaluate(() => ({ focus: parseFloat(getComputedStyle(document.querySelector('.focus-score')).fontSize), secondary: Math.max(...[...document.querySelectorAll('.metric-score')].map((e) => parseFloat(getComputedStyle(e).fontSize))) }));
  expect(sizes.focus >= 2.5 * sizes.secondary, `focus score dominates (${sizes.focus}px vs ${sizes.secondary}px)`);
  expect((await page.$$('#practice-result .metric-row')).length === 3, '3 secondary metrics');
  const top = await page.$eval('#practice-result', (e) => e.getBoundingClientRect().top);
  expect(top < 200, `newest result at the top of the screen (top=${Math.round(top)})`);
  expect(/✓ Tracking 良好/.test(res), 'QC shown as icon + text');
  await shot('ui-practice-result');
  await noOverflow('practice-result');

  // QC failure
  await addDemo('badTracking');
  res = await text('#practice-result');
  expect(/這一棒 Tracking 不穩定/.test(res) && /不會加入 Baseline/.test(res), 'failed QC states it will not enter the Baseline');
  expect(!(await page.$('#practice-result .focus-score')), 'no score shown for a failed measurement');
  expect(/查看原因/.test(res), '查看原因 available');
  await shot('ui-practice-rejected');
  await addDemo('head');
  let s = await swings();
  expect(!s[5].baselineIds.includes(s[4].id), 'rejected swing not in later Baseline');

  // Contact with one tap
  await click('#practice-result [data-action="contact"][data-label="good"]');
  await page.waitForFunction(() => window.__app.swings[5].contact === 'good', { timeout: 5000 }).catch(() => {});
  s = await swings();
  expect(s[5].contact === 'good', 'Contact Quality labeled with one tap');
  expect(await page.$eval('#practice-result .c-good', (e) => e.getAttribute('aria-pressed') === 'true'), 'selected contact shows state (aria-pressed + ✓)');

  // Recent 5
  expect((await page.$$('#practice-recent .recent-col')).length === 5, 'recent strip shows last 5 swings');
  expect(/最近 5 棒/.test(await text('#practice-recent')), 'recent strip titled 最近 5 棒');

  // Detail sheet via recent strip
  await click(`#practice-recent [data-id="${s[3].id}"]`);
  expect(await visible('#sheet') && /Swing #4/.test(await text('#sheet')), 'tap recent swing opens its detail');
  expect(!(await visible('#next-btn')), 'action bar hidden while detail is open');
  await shot('ui-detail');
  await click('#sheet [data-action="exclude"]');
  await page.waitForFunction(() => window.__app.swings[3].excludeFromBaseline === true, { timeout: 5000 }).catch(() => {});
  await click('#sheet [data-action="closeSheet"]');
  s = await swings();
  expect(s[3].exclude && !s[5].baselineIds.includes(s[3].id), 'exclude from Baseline recomputes later comparisons');

  // ---------------- Refresh persistence
  await page.reload({ waitUntil: 'load' });
  await ready();
  const after = await swings();
  expect(after.length === 6 && after[5].contact === 'good' && after[3].exclude, 'session, labels and exclusions survive refresh');
  expect(await visible('#view-practice') && /Sean/.test(await text('#session-menu-btn')), 'practice view restored after refresh');

  // ---------------- Review
  await click('.tab[data-tab="review"]');
  const rv = await text('#view-review');
  expect(/今日 Session/.test(rv) && /Swings/.test(rv) && /Good Contact/.test(rv) && /Best Consistency/.test(rv), 'Review shows overview tiles');
  expect(/1 \/ 1/.test(rv), 'Good Contact count');
  await shot('ui-review');
  await noOverflow('review');

  const allText = await page.evaluate(() => document.body.innerText);
  expect(!SIMPLIFIED.test(allText), 'no Simplified Chinese characters in UI text');

  // ---------------- Session menu + explicit end
  await click('.tab[data-tab="train"]');
  await click('#session-menu-btn');
  const menu = await text('#dialog');
  expect(/匯出資料/.test(menu) && /結束 Session/.test(menu) && /重新命名/.test(menu), 'session menu has export / rename / end');
  await dialogClick('結束 Session');
  await page.waitForFunction(() => /結束目前 Session？/.test(document.getElementById('dialog').innerText), { timeout: 3000 });
  expect(/已儲存在此裝置/.test(await text('#dialog')), 'end-session confirmation explains data is saved');
  await dialogClick('取消');
  expect(await page.evaluate(() => !!window.__app.session), 'cancel keeps the session');
  await click('#session-menu-btn');
  await dialogClick('結束 Session');
  await page.waitForFunction(() => /結束目前 Session？/.test(document.getElementById('dialog').innerText), { timeout: 3000 });
  await dialogClick('結束並建立新 Session');
  await page.waitForFunction(() => !window.__app.session && !document.getElementById('view-setup').hidden, { timeout: 3000 });
  expect(await page.$eval('#view-setup [data-name="Sean"]', (e) => e.classList.contains('on')), 'player shortcut pre-selected for the next session');

  // ---------------- Real video (optional)
  if (videoPath) {
    await page.type('#player-name', 'Video');
    await click('#start-session');
    await page.waitForFunction(() => !!window.__app.session);
    await page.evaluate(() => { window.__swingDebug = undefined; });
    const input = await page.$('#video-input');
    await input.uploadFile(videoPath);
    await page.waitForFunction(() => window.__swingDebug?.meta || window.__swingDebug?.error, { timeout: 60000 });
    if (await visible('#range-block')) {
      expect(/影片較長，請選擇要分析的 Swing/.test(await text('#practice-status')), 'long clip: simple chooser shown');
      const btn = await page.$eval('#analyze-here', (e) => { const r = e.getBoundingClientRect(); return { bottom: r.bottom, vh: innerHeight }; });
      expect(!(await visible('#next-btn')) && btn.bottom <= btn.vh, `long clip: 分析這個位置 is the visible primary action (bottom ${Math.round(btn.bottom)}/${btn.vh})`);
      await shot('ui-long-clip');
      await page.evaluate((a, b) => { document.getElementById('range-start').value = a; document.getElementById('range-end').value = b; document.getElementById('analyze-btn').click(); }, vStart, vEnd);
    }
    await page.waitForFunction(() => window.__app.status?.stage === 'track', { timeout: 60000 }).catch(() => {});
    if (await page.evaluate(() => window.__app.status?.stage === 'track')) {
      expect(/正在分析這一棒/.test(await text('#practice-status')) && /Pose Tracking/.test(await text('#practice-status')), 'analysis shows real stages');
      await shot('ui-analyzing');
    }
    await page.waitForFunction(() => window.__swingDebug?.recordId || window.__swingDebug?.poseError, { timeout: 20 * 60000, polling: 1000 });
    const dbg = await page.evaluate(() => ({ err: window.__swingDebug.poseError, status: window.__swingDebug.analysis?.status }));
    console.log('real video:', JSON.stringify(dbg));
    expect(!dbg.err, 'real video analyzed');
    expect(/Swing #1/.test(await text('#practice-result')), 'real-video result shown as newest swing');
    await shot('ui-real-video');
  }
  const pageErrors = logs.filter((l) => l.startsWith('[pageerror]'));
  expect(!pageErrors.length, `no uncaught page errors${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`);
  const consoleErrors = logs.filter((l) => l.startsWith('[error]'));
  expect(!consoleErrors.length, `no console errors${consoleErrors.length ? `: ${consoleErrors.join(' | ')}` : ''}`);
} finally {
  await close();
}
process.exit(failures ? 1 : 0);
