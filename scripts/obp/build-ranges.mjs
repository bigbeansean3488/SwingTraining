// Aggregates the per-trial engine results (scripts/obp/build-trials.mjs) into
// athlete-level reference distributions for the app.
//
// Output (committed, CC BY-NC-SA 4.0 like its source):
//   src/analysis/research/obp-ranges.json
//
// Usage: node scripts/obp/build-ranges.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const inDir = resolve(root, 'data/obp/out');
const outFile = resolve(root, 'src/analysis/research/obp-ranges.json');

/**
 * Metrics left out: depend on where the lab clip starts or ends (stance, finish),
 * or are experimental.
 */
const EXCLUDE = new Set([
  'phase_stance_ms',
  'phase_release_to_finish_ms',
  'phase_follow_ms',
  'seq_pelvis_lead_ms',
]);
/** False discovery rate for the metric-outcome association tests (Benjamini-Hochberg). */
const FDR = 0.05;
/** Minimum athletes for a group range to be published. */
const MIN_GROUP = 15;
const PERMUTATIONS = 5000;

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sorted = (a) => [...a].sort((x, y) => x - y);
/** Linear-interpolated quantile (type 7). */
function quantile(s, p) {
  const h = (s.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
function pearson(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let c = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    c += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return c / Math.sqrt(va * vb);
}
/** Deterministic PRNG so the published file is reproducible. */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
/** Spearman rho with a two-sided permutation p-value. */
function spearman(x, y, seed = 1) {
  const rx = ranks(x);
  const ry = ranks(y);
  const rho = pearson(rx, ry);
  const rand = rng(seed);
  const perm = [...ry];
  let extreme = 0;
  for (let k = 0; k < PERMUTATIONS; k++) {
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    if (Math.abs(pearson(rx, perm)) >= Math.abs(rho) - 1e-12) extreme++;
  }
  return { rho, p: (extreme + 1) / (PERMUTATIONS + 1) };
}
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

function build(kind, file, outcomeKey, outcomeLabel) {
  const { engine, fps, trials } = JSON.parse(readFileSync(resolve(inDir, file), 'utf8'));
  const ok = trials.filter((t) => !t.autoFailure);
  const byUser = new Map();
  for (const t of ok) {
    if (!byUser.has(t.user)) byUser.set(t.user, []);
    byUser.get(t.user).push(t);
  }
  const athletes = [...byUser.values()].map((ts) => {
    const metrics = {};
    const keys = new Set(ts.flatMap((t) => Object.keys(t.autoMetrics)));
    for (const k of keys) {
      if (EXCLUDE.has(k)) continue;
      const v = ts.map((t) => t.autoMetrics[k]).filter(Number.isFinite);
      if (v.length) metrics[k] = mean(v);
    }
    const outcome = mean(ts.map((t) => t[outcomeKey]).filter(Number.isFinite));
    const level = ts[0].level;
    const armSlot = kind === 'pitching' ? mean(ts.map((t) => t.armSlot)) : null;
    return { metrics, outcome, level, armSlot, trials: ts.length };
  });

  const outcomes = sorted(athletes.map((a) => a.outcome).filter(Number.isFinite));
  const highCut = quantile(outcomes, 2 / 3);
  const isPro = (a) => a.level === 'milb' || a.level === 'independent';
  const slotGroup = (a) =>
    a.armSlot == null ? null : a.armSlot >= 50 ? 'high' : a.armSlot >= 30 ? 'three_quarter' : 'low';
  const levels = {};
  for (const a of athletes) levels[a.level] = (levels[a.level] ?? 0) + 1;

  const metricKeys = [...new Set(athletes.flatMap((a) => Object.keys(a.metrics)))].sort();
  const metrics = {};
  const range = (vals) => {
    if (vals.length < MIN_GROUP) return null;
    const s = sorted(vals);
    return {
      n: s.length,
      p25: round(quantile(s, 0.25)),
      p50: round(quantile(s, 0.5)),
      p75: round(quantile(s, 0.75)),
    };
  };
  for (const k of metricKeys) {
    const with_ = athletes.filter((a) => Number.isFinite(a.metrics[k]));
    const vals = with_.map((a) => a.metrics[k]);
    const s = sorted(vals);
    const paired = with_.filter((a) => Number.isFinite(a.outcome));
    const assoc = spearman(
      paired.map((a) => a.metrics[k]),
      paired.map((a) => a.outcome),
      k.length * 7919,
    );
    const groups = {
      pro: range(with_.filter(isPro).map((a) => a.metrics[k])),
      college: range(with_.filter((a) => a.level === 'college').map((a) => a.metrics[k])),
    };
    if (kind === 'pitching') {
      for (const g of ['high', 'three_quarter', 'low']) {
        groups[`armSlot_${g}`] = range(
          with_.filter((a) => slotGroup(a) === g).map((a) => a.metrics[k]),
        );
      }
    }
    metrics[k] = {
      n: s.length,
      // 21 quantiles (every 5%) for percentile lookup by interpolation.
      q: Array.from({ length: 21 }, (_, i) => round(quantile(s, i / 20))),
      common: [round(quantile(s, 0.25)), round(quantile(s, 0.75))],
      usual: [round(quantile(s, 0.1)), round(quantile(s, 0.9))],
      outcome: { rho: round(assoc.rho, 2), p: round(assoc.p, 4) },
      highOutcome: range(paired.filter((a) => a.outcome >= highCut).map((a) => a.metrics[k])),
      groups: Object.fromEntries(Object.entries(groups).filter(([, v]) => v)),
    };
  }
  // Benjamini-Hochberg: the high-outcome range is published only for metrics
  // whose association with the outcome survives the FDR across this kind.
  const ps = Object.entries(metrics)
    .map(([k, m]) => [k, m.outcome.p])
    .sort((a, b) => a[1] - b[1]);
  let pass = 0;
  ps.forEach(([, p], i) => {
    if (p <= ((i + 1) / ps.length) * FDR) pass = i + 1;
  });
  const significant = new Set(ps.slice(0, pass).map(([k]) => k));
  for (const [k, m] of Object.entries(metrics)) {
    m.outcome.significant = significant.has(k);
    if (!m.outcome.significant) m.highOutcome = null;
  }
  return {
    engineVersion: engine,
    analyzedFps: fps,
    athletes: athletes.length,
    trials: ok.length,
    trialsFailed: trials.length - ok.length,
    levels,
    outcome: { key: outcomeKey, label: outcomeLabel, highCut: round(highCut, 1), fdr: FDR },
    metrics,
  };
}

const out = {
  source: {
    name: 'The OpenBiomechanics Project (OBP)',
    author: 'Driveline Baseball Research and Development',
    url: 'https://github.com/drivelineresearch/openbiomechanics',
    license: 'CC BY-NC-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    changes:
      "3D joint centres projected to an ideal side view; metrics computed with this app's analysis engine (automatic event detection); averaged per athlete.",
  },
  generated: new Date().toISOString().slice(0, 10),
  pitching: build('pitching', 'pitching_trials.json', 'speedMph', 'pitch_speed_mph'),
  batting: build('batting', 'hitting_trials.json', 'exitVelo', 'exit_velo_mph'),
};
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n');
for (const kind of ['pitching', 'batting']) {
  const r = out[kind];
  console.log(`== ${kind}: ${r.athletes} athletes, ${r.trials} trials`, r.levels);
  for (const [k, m] of Object.entries(r.metrics)) {
    console.log(
      k.padEnd(28),
      `n=${m.n}`,
      `common ${m.common.join('~')}`,
      `rho ${m.outcome.rho} p ${m.outcome.p}`,
      m.highOutcome ? `high ${m.highOutcome.p25}~${m.highOutcome.p75}` : '',
      Object.keys(m.groups).join(','),
    );
  }
}
