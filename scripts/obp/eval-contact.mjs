// Compares candidate rules for the batting contact instant against the OBP
// lab contact time (bat-ball contact from the force/bat data), at several
// frame rates and noise levels. Prints the error distribution per rule.
//
// Usage: node scripts/obp/eval-contact.mjs [--every 1]
import { resolve } from 'node:path';
import { dataDir, engineServer, hittingJoints, readCsv, toSequence, trials } from './lib.mjs';

const every = process.argv.includes('--every')
  ? Number(process.argv[process.argv.indexOf('--every') + 1])
  : 1;
const CONDITIONS = [
  { fps: 240, noisePx: 0 },
  { fps: 120, noisePx: 0 },
  { fps: 120, noisePx: 3 },
  { fps: 60, noisePx: 3 },
  { fps: 30, noisePx: 3 },
];

const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  const h = (s.length - 1) * p;
  return s[Math.floor(h)] + (s[Math.ceil(h)] - s[Math.floor(h)]) * (h - Math.floor(h));
};
const fmt = (a) =>
  a.length
    ? `n=${a.length} med ${q(a, 0.5).toFixed(0)} [p10 ${q(a, 0.1).toFixed(0)}, p90 ${q(a, 0.9).toFixed(0)}] |err|p90 ${q(
        a.map(Math.abs),
        0.9,
      ).toFixed(0)}`
    : 'n=0';

const server = await engineServer();
try {
  const common = await server.ssrLoadModule('/src/analysis/common.ts');
  const tracks = await server.ssrLoadModule('/src/analysis/tracks.ts');
  const signal = await server.ssrLoadModule('/src/analysis/signal.ts');
  const geom = await server.ssrLoadModule('/src/analysis/geometry.ts');
  const qmod = await server.ssrLoadModule('/src/analysis/quality.ts');
  const { analyze } = await server.ssrLoadModule('/src/analysis/index.ts');
  // Engine contact frame vs lab contact, with frames shifted against the
  // events so they do not line up with contact.
  const frameStats = CONDITIONS.map(() => ({ before: 0, n: 0, err: [] }));

  const meta = new Map(
    readCsv(resolve(dataDir, 'baseball_hitting_data_metadata.csv')).map((r) => [
      r.session_swing,
      r,
    ]),
  );
  const results = CONDITIONS.map(() => ({}));
  const features = [];
  let k = 0;
  for await (const { key, head, rows } of trials(
    resolve(dataDir, 'hitting/landmarks.csv'),
    'session_swing',
  )) {
    if (k++ % every) continue;
    const m = meta.get(key);
    if (!m) continue;
    const { joints, forwardFrom } = hittingJoints(m.hitter_side === 'R');
    CONDITIONS.forEach((cond, ci) => {
      const shift = (k * 7) % Math.max(1, Math.round(360 / cond.fps));
      const shifted = toSequence(
        head,
        rows.slice(shift),
        joints,
        forwardFrom,
        { plant: 'fp_10_time', contact: 'contact_time' },
        { ...cond, seed: k },
      );
      const ra = analyze('batting', shifted.seq);
      if (Number.isFinite(shifted.events.contact) && Number.isFinite(ra.events.contact)) {
        const fsx = frameStats[ci];
        fsx.n++;
        if (ra.events.contact < shifted.events.contact - 1e-9) fsx.before++;
        fsx.err.push((ra.events.contact - shifted.events.contact) * 1000);
      }
      const { seq, events } = toSequence(
        head,
        rows,
        joints,
        forwardFrom,
        { plant: 'fp_10_time', contact: 'contact_time' },
        { ...cond, seed: k },
      );
      if (!Number.isFinite(events.contact)) return;
      const qa = qmod.assessClip(seq);
      const fc = common.cutoffs(qa.fps);
      const tr = tracks.buildTracks(seq, fc.position, fc.speed);
      const legs = common.battingLegs(tr);
      const fwd = legs.forward;
      const hands = common.handSpeed(tr);
      const iPk = signal.argmax(hands);
      if (iPk < 0) return;
      const tTrue = events.contact;
      const t = tr.t;
      const add = (name, i) => {
        if (i == null || i < 0) return;
        (results[ci][name] ??= []).push((t[i] - tTrue) * 1000);
      };
      const addT = (name, tt) => (results[ci][name] ??= []).push((tt - tTrue) * 1000);
      add('peak', iPk);
      for (const off of [0.05, 0.06, 0.065, 0.07]) addT(`peak+${off * 1000}ms`, t[iPk] + off);
      for (const kk of [0.9, 0.8, 0.7, 0.6, 0.5])
        add(`below ${kk} peak`, common.firstBelowAfter(hands, iPk, kk * hands[iPk]));
      // Hand midpoint forward position / velocity.
      const lw = tr.fast(legs.lead.wrist);
      const rw = tr.fast(legs.rear.wrist);
      const hx = lw.x.map((v, i) => ((v + rw.x[i]) / 2) * fwd);
      const hy = lw.y.map((v, i) => (v + rw.y[i]) / 2);
      const vx = signal.derivative(hx, tr.fs);
      const lim = Math.min(tr.n - 1, iPk + Math.round(0.35 * tr.fs));
      add('hands fwd max', signal.argmax(hx, iPk, lim));
      const iVx = signal.argmax(vx, Math.max(0, iPk - Math.round(0.1 * tr.fs)), lim);
      add('hands fwd vel peak', iVx);
      for (const kk of [0.5, 0.3, 0])
        add(`fwd vel below ${kk}`, common.firstBelowAfter(vx, iVx, kk * vx[iVx], lim));
      // Lead elbow extension.
      const elbow = Array.from({ length: tr.n }, (_, i) =>
        geom.angleAt(
          tr.at(legs.lead.shoulder, i),
          tr.at(legs.lead.elbow, i),
          tr.at(legs.lead.wrist, i),
        ),
      );
      add('lead elbow max', signal.argmax(elbow, iPk, lim));
      if (ci === 1) {
        const iT = tracks.indexAt(tr, tTrue);
        const hip = tr.mid(23, 24, iT);
        const leadHip = tr.at(legs.lead.hip, iT);
        features.push({
          dtPeak: (tTrue - t[iPk]) * 1000,
          ratio: hands[iT] / hands[iPk],
          handVsHip: (hx[iT] - hip.x * fwd) / tr.torso,
          handVsLeadHip: (hx[iT] - leadHip.x * fwd) / tr.torso,
          handHeight: (tr.mid(23, 24, iT).y - hy[iT]) / tr.torso,
          elbow: elbow[iT],
          elbowMax: Math.max(...elbow.slice(iPk, lim + 1).filter(Number.isFinite)),
          vxRatio: vx[iT] / vx[iVx],
          peakSpeed: hands[iPk],
          tailS: t[tr.n - 1] - tTrue,
        });
      }
    });
  }
  CONDITIONS.forEach((c, ci) => {
    console.log(`\n== ${c.fps} fps, noise ${c.noisePx}px  (ms, + = later than lab contact)`);
    for (const [name, a] of Object.entries(results[ci])) console.log(name.padEnd(22), fmt(a));
  });
  console.log('\n== engine contact frame (analyze())');
  CONDITIONS.forEach((c, ci) => {
    const f = frameStats[ci];
    console.log(
      `${c.fps} fps noise ${c.noisePx}px: frame before lab contact ${((100 * f.before) / f.n).toFixed(0)}%,`,
      fmt(f.err),
    );
  });
  console.log('\n== features at lab contact (120 fps, no noise)');
  for (const f of Object.keys(features[0])) {
    const a = features.map((x) => x[f]).filter(Number.isFinite);
    console.log(
      f.padEnd(14),
      `med ${q(a, 0.5).toFixed(2)} p10 ${q(a, 0.1).toFixed(2)} p90 ${q(a, 0.9).toFixed(2)}`,
    );
  }
} finally {
  await server.close();
}
