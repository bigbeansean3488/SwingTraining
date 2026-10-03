// Field-validation runner: analyze a folder of real swing videos in one
// session (in manifest order) through the real app in headless Chrome and
// write per-swing results + a normal-vs-perturbed summary.
//
// Usage: node tools/evaluate-field.mjs <manifest.csv> <outDir> [model=full]
//   manifest columns: file,condition,start,end,lighting,distance_m,note[,expected_swings]
//   - file is relative to the manifest's folder
//   - condition: normal | longStride | shortStride | head | timing | other
//   - start/end (s) optional: analyze exactly that window as one swing.
//     Clips longer than 10 s without start/end are treated as a practice
//     recording: every swing is found automatically and each one becomes a
//     row (the condition applies to all of them). Set expected_swings to the
//     true number of swings to check segmentation.
// See docs/field-validation.md.
import fs from 'node:fs';
import path from 'node:path';
import { openApp, startSession } from './browser.mjs';

const [manifestPath, outDir, model = 'full'] = process.argv.slice(2);
if (!manifestPath || !outDir) { console.error('usage: node tools/evaluate-field.mjs <manifest.csv> <outDir> [model]'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const cols = head.split(',').map((c) => c.trim());
  return lines.map((l) => {
    const cells = l.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, (cells[i] ?? '').trim()]));
  });
}

const baseDir = path.dirname(path.resolve(manifestPath));
const rows = parseCsv(fs.readFileSync(manifestPath, 'utf8'));
const { page, logs, close } = await openApp();
const results = [];
const segRows = [];
try {
  await startSession(page, `field ${path.basename(manifestPath)}`);
  await page.evaluate((m) => { window.__app.poseModel = m; }, model);
  for (const [i, row] of rows.entries()) {
    const file = path.join(baseDir, row.file);
    if (!fs.existsSync(file)) { console.log(`SKIP ${row.file}: not found`); continue; }
    process.stdout.write(`[${i + 1}/${rows.length}] ${row.file} (${row.condition}) … `);
    const manual = !!(row.start && row.end);
    await page.evaluate((m) => { window.__swingDebug = undefined; window.__app.multiSwing = !m; }, manual);
    const input = await page.$('#video-input');
    await input.uploadFile(file);
    await page.waitForFunction(() => window.__swingDebug?.meta || window.__swingDebug?.error, { timeout: 120000 });
    const loadErr = await page.evaluate(() => window.__swingDebug.error);
    if (loadErr) { console.log(`load error: ${loadErr}`); results.push({ ...row, error: loadErr }); continue; }
    const needsRange = await page.$eval('#range-block', (e) => !e.hidden);
    if (needsRange) {
      await page.evaluate((a, b) => { document.getElementById('range-start').value = a; document.getElementById('range-end').value = b; document.getElementById('analyze-btn').click(); }, row.start, row.end);
    }
    await page.waitForFunction(() => window.__swingDebug?.recordId || window.__swingDebug?.batchDone || window.__swingDebug?.poseError, { timeout: 120 * 60000, polling: 1000 });
    const out = await page.evaluate(() => {
      const d = window.__swingDebug;
      const ids = d.recordIds ?? (d.recordId ? [d.recordId] : []);
      const recs = ids.map((id) => {
        const s = window.__app.swings.find((x) => x.id === id);
        const m = s.analysis.metrics;
        return {
          number: s.number,
          window: s.video.window ? s.video.window.map((v) => v.toFixed(2)).join('-') : '',
          fps: s.video.fps,
          processingS: s.video.processingMs / 1000,
          status: s.analysis.status,
          reason: s.analysis.reason,
          qc: s.poseQuality?.level,
          qcReasons: (s.poseQuality?.reasons || []).join('; '),
          consistency: s.consistency?.score ?? null,
          head: m?.headStability.value ?? null,
          headAnchored: m?.headStability.diagnostics.maxDisplacementAnchored ?? null,
          stride: m?.stride.value ?? null,
          startToPeak: m?.timing.value.startToPeak ?? null,
          plantToPeak: m?.timing.value.plantToPeak ?? null,
          devHead: s.deviations?.head ?? null,
          devStride: s.deviations?.stride ?? null,
          devTiming: s.deviations?.timing ?? null,
          devWristPath: s.deviations?.wristPath ?? null,
          devPose: s.deviations?.pose ?? null,
          swing: s,
        };
      });
      return { error: d.poseError ?? null, recs, segmentation: d.segmentation ?? null, scan: d.scan ?? null };
    });
    if (out.segmentation) {
      const found = out.segmentation.swings.length;
      const expected = row.expected_swings ? Number(row.expected_swings) : null;
      segRows.push({ file: row.file, expected, found, peaks: out.segmentation.swings.map((x) => x.peak) });
      console.log(`found ${found} swing(s)${expected !== null ? ` (expected ${expected})` : ''}; scan ${out.scan ? `${out.scan.frames} frames in ${(out.scan.processingMs / 1000).toFixed(0)} s` : '—'}`);
    }
    if (out.error) { console.log(`error: ${out.error}`); results.push({ ...row, error: out.error }); continue; }
    if (!out.recs.length) results.push({ ...row, error: 'no swing found' });
    for (const rec of out.recs) {
      console.log(`  #${rec.number} ${rec.window} ${rec.status} qc=${rec.qc} consistency=${rec.consistency ?? '—'}`);
      results.push({ ...row, ...rec });
    }
  }
} finally {
  await close();
}

// ---- outputs
const cols = ['number', 'file', 'window', 'condition', 'lighting', 'distance_m', 'fps', 'processingS', 'status', 'qc', 'reason', 'qcReasons', 'consistency', 'head', 'headAnchored', 'stride', 'startToPeak', 'plantToPeak', 'devHead', 'devStride', 'devTiming', 'devWristPath', 'devPose', 'error'];
const csvCell = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
fs.writeFileSync(path.join(outDir, 'results.csv'), [cols.join(','), ...results.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n'));
fs.writeFileSync(path.join(outDir, 'swings.json'), JSON.stringify(results.map((r) => r.swing).filter(Boolean)));

// Normal-vs-perturbed summary: does each deliberate change show up in its
// own component more than normal swing-to-swing variation does?
const target = { longStride: 'devStride', shortStride: 'devStride', head: 'devHead', timing: 'devTiming' };
const med = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const valid = results.filter((r) => r.status === 'ok');
const lines = [];
lines.push(`Swings: ${results.length}; analyzable: ${valid.length}; rejected: ${results.filter((r) => r.status === 'rejected').length}; errors: ${results.filter((r) => r.error).length}`);
for (const [cond, key] of Object.entries(target)) {
  const normal = valid.filter((r) => r.condition === 'normal').map((r) => r[key]);
  const pert = valid.filter((r) => r.condition === cond).map((r) => r[key]);
  if (!pert.length) continue;
  const nMax = Math.max(...normal.filter((x) => x !== null), 0);
  lines.push(`${cond}: ${key} perturbed median ${med(pert)?.toFixed(2)} (n=${pert.length}) vs normal median ${med(normal)?.toFixed(2)} max ${nMax.toFixed(2)} (n=${normal.length}); perturbed above every normal swing: ${pert.filter((x) => x > nMax).length}/${pert.length}`);
}
const scoreN = valid.filter((r) => r.condition === 'normal' && r.consistency !== null).map((r) => r.consistency);
const scoreP = valid.filter((r) => r.condition !== 'normal' && r.consistency !== null).map((r) => r.consistency);
lines.push(`consistency: normal median ${med(scoreN)} (n=${scoreN.length}); perturbed median ${med(scoreP)} (n=${scoreP.length})`);
for (const r of segRows) lines.push(`segmentation ${r.file}: found ${r.found}${r.expected !== null ? ` / expected ${r.expected}` : ''} at ${r.peaks.join(', ')} s`);
fs.writeFileSync(path.join(outDir, 'summary.txt'), `${lines.join('\n')}\n`);
console.log(`\n${lines.join('\n')}\nwrote ${outDir}/results.csv, swings.json, summary.txt`);
const pageErrors = logs.filter((l) => l.startsWith('[pageerror]'));
if (pageErrors.length) console.log(pageErrors.join('\n'));
