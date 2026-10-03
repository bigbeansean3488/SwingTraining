// Visualize one swing analysis: speed signals + detected events (+ truth for
// synthetic input) and the normalized hand/head paths.
// Usage: node tools/plot-analysis.mjs <out.png> (<pose.json> | '{"synthetic":{...params}}')
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { generateSwing } from '../src/synthetic/swing.js';
import { normalizeSwing } from '../src/analysis/normalize.js';
import { detectEvents } from '../src/analysis/temporal.js';
import { analyzeSwing } from '../src/analysis/pipeline.js';

const [out, src] = process.argv.slice(2);
const seq = src.trim().startsWith('{') ? generateSwing(JSON.parse(src).synthetic) : JSON.parse(fs.readFileSync(src, 'utf8'));
const norm = normalizeSwing(seq);
const det = detectEvents(norm);
const analysis = analyzeSwing(seq);

const W = 900; const H = 360; const pad = 40;
const t0 = norm.times[0]; const t1 = norm.times.at(-1);
const vmax = Math.max(...det.signals.hand.filter((v) => v !== null), 1);
const X = (t) => pad + ((t - t0) / (t1 - t0)) * (W - 2 * pad);
const Y = (v) => H - pad - (v / vmax) * (H - 2 * pad);
// Break the line at missing samples instead of bridging them.
const pathD = (pts) => pts.map((p, k) => (p ? `${k && pts[k - 1] ? 'L' : 'M'}${p[0]},${p[1]}` : '')).join('');
const line = (s, color) => `<path fill="none" stroke="${color}" stroke-width="2" d="${pathD(s.map((v, k) => (v === null ? null : [X(norm.times[k]), Y(v)])))}"/>`;
let svg = `<rect width="${W}" height="${H}" fill="#111418"/>`;
svg += line(det.signals.hand, '#4fb3ff') + line(det.signals.ankle, '#f0b429');
if (det.thresholds?.theta) svg += `<line x1="${pad}" x2="${W - pad}" y1="${Y(det.thresholds.theta)}" y2="${Y(det.thresholds.theta)}" stroke="#8a96a3" stroke-dasharray="4 4"/>`;
const mark = (t, color, label, y) => (t == null ? '' : `<line x1="${X(t)}" x2="${X(t)}" y1="${pad}" y2="${H - pad}" stroke="${color}" stroke-width="1.5"/><text x="${X(t) + 3}" y="${y}" fill="${color}" font-size="12">${label}</text>`);
const ev = det.events || {};
svg += mark(ev.motionStart, '#46c27a', 'start', pad + 12) + mark(ev.footPlant, '#f0b429', 'plant', pad + 26) + mark(ev.peakHandSpeed, '#4fb3ff', 'peak', pad + 40) + mark(ev.swingEnd, '#e5534b', 'end', pad + 54);
const truth = seq.truth?.events;
if (truth) for (const t of Object.values(truth)) svg += `<line x1="${X(t)}" x2="${X(t)}" y1="${H - pad}" y2="${H - pad + 10}" stroke="#fff" stroke-width="2"/>`;
svg += `<text x="${pad}" y="20" fill="#e8ecf0" font-size="14">hand speed (blue), lead-ankle speed (yellow), threshold (dashed) — T/s, max ${vmax.toFixed(1)}; white ticks = truth. status: ${analysis.status} ${analysis.reason ?? ''}</text>`;
for (let s = Math.ceil(t0 * 10) / 10; s <= t1; s += 0.1) svg += `<text x="${X(s)}" y="${H - 12}" fill="#8a96a3" font-size="10" text-anchor="middle">${s.toFixed(1)}</text>`;

// Path panel (normalized body frame, +x toward pitcher, y down).
const P = 360;
const sx = (x) => P * 0.4 + x * 55;
const sy = (y) => P * 0.42 + y * 55;
const path = (name, color) => `<path fill="none" stroke="${color}" stroke-width="2" d="${pathD(norm.points[name].x.map((x, k) => (x === null ? null : [sx(x), sy(norm.points[name].y[k])])))}"/>`;
let svg2 = `<rect width="${P}" height="${P}" fill="#111418"/><text x="10" y="20" fill="#e8ecf0" font-size="13">normalized paths (T): hands, head, lead ankle; origin = stance pelvis</text>`;
svg2 += `<circle cx="${sx(0)}" cy="${sy(0)}" r="4" fill="#8a96a3"/>`;
svg2 += path('hands', '#4fb3ff') + path('head', '#e5534b') + path('leadAnkle', '#f0b429');

const html = `<body style="margin:0;background:#111418;display:flex"><svg width="${W}" height="${H}">${svg}</svg><svg width="${P}" height="${P}">${svg2}</svg></body>`;
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', process.env.CHROME_PATH].find((p) => p && fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: W + P, height: H });
await page.setContent(html);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out, '| events', JSON.stringify(ev), '| status', analysis.status);
