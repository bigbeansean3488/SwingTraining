// Render synthetic swings as SVG stick-figure strips + trajectories, then
// rasterize via headless Chrome for visual review.
// Usage: node tools/render-synthetic.mjs <out.png> ['{"strideLength":1.4}' ...]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer-core';
import { generateSwing } from '../src/synthetic/swing.js';
import { SKELETON_EDGES, LM } from '../src/pose/landmarks.js';

const [out = path.join(os.tmpdir(), 'synthetic.png'), ...variants] = process.argv.slice(2);
const configs = (variants.length ? variants : ['{}']).map((s) => JSON.parse(s));
const COLORS = ['#4fb3ff', '#f0b429', '#e5534b', '#46c27a', '#c678dd'];

function svgFor(seq, color, times) {
  const W = seq.width;
  const H = seq.height;
  let g = '';
  for (const t of times) {
    const f = seq.frames.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
    for (const [a, b] of SKELETON_EDGES) {
      const pa = f.lm[a]; const pb = f.lm[b];
      g += `<line x1="${pa[0] * W}" y1="${pa[1] * H}" x2="${pb[0] * W}" y2="${pb[1] * H}" stroke="${color}" stroke-opacity="0.5" stroke-width="4"/>`;
    }
  }
  const trail = (i) => seq.frames.map((f) => `${f.lm[i][0] * W},${f.lm[i][1] * H}`).join(' ');
  g += `<polyline points="${trail(LM.LEFT_WRIST)}" fill="none" stroke="${color}" stroke-width="5"/>`;
  g += `<polyline points="${trail(LM.NOSE)}" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="10 6"/>`;
  g += `<polyline points="${trail(LM.LEFT_ANKLE)}" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="2 6"/>`;
  return g;
}

const seqs = configs.map((c) => generateSwing(c));
const { width: W, height: H } = seqs[0];
const times = [0, 0.7, 0.9, 1.1, 1.25, 1.6];
const body = seqs.map((s, i) => svgFor(s, COLORS[i % COLORS.length], times)).join('');
const legend = configs.map((c, i) => `<text x="20" y="${60 + i * 50}" fill="${COLORS[i % COLORS.length]}" font-size="40" font-family="sans-serif">${JSON.stringify(c)}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#111418"/>${body}${legend}</svg>`;

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', process.env.CHROME_PATH].find((p) => p && fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 0.5 });
await page.setContent(`<body style="margin:0;overflow:hidden">${svg.replace('<svg ', '<svg style="display:block" ')}</body>`);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
