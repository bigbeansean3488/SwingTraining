// Compares candidate rules for the pitching release instant against the OBP
// lab ball-release time (BR_time), at several frame rates and noise levels.
//
// Usage: node scripts/obp/eval-release.mjs [--every 2]
import { resolve } from 'node:path';
import { dataDir, engineServer, pitchingJoints, readCsv, toSequence, trials } from './lib.mjs';

const every = process.argv.includes('--every')
  ? Number(process.argv[process.argv.indexOf('--every') + 1])
  : 1;
const CONDITIONS = [
  { fps: 240, noisePx: 0 },
  { fps: 120, noisePx: 3 },
  { fps: 60, noisePx: 3 },
  { fps: 30, noisePx: 3 },
  { fps: 24, noisePx: 3 },
];

const q = (a, p) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  const h = (s.length - 1) * p;
  return s[Math.floor(h)] + (s[Math.ceil(h)] - s[Math.floor(h)]) * (h - Math.floor(h));
};
const fmt = (a) =>
  `n=${a.filter(Number.isFinite).length} med ${q(a, 0.5).toFixed(0)} [p10 ${q(a, 0.1).toFixed(0)}, p90 ${q(a, 0.9).toFixed(0)}] |err|p90 ${q(a.map(Math.abs), 0.9).toFixed(0)}`;

const server = await engineServer();
try {
  const common = await server.ssrLoadModule('/src/analysis/common.ts');
  const tracks = await server.ssrLoadModule('/src/analysis/tracks.ts');
  const signal = await server.ssrLoadModule('/src/analysis/signal.ts');
  const geom = await server.ssrLoadModule('/src/analysis/geometry.ts');
  const qmod = await server.ssrLoadModule('/src/analysis/quality.ts');
  const poi = new Map(
    readCsv(resolve(dataDir, 'baseball_pitching_data_poi_poi_metrics.csv')).map((r) => [
      r.session_pitch,
      r,
    ]),
  );
  const results = CONDITIONS.map(() => ({}));
  let k = 0;
  for await (const { key, head, rows } of trials(
    resolve(dataDir, 'pitching/landmarks.csv'),
    'session_pitch',
  )) {
    if (k++ % every) continue;
    const p = poi.get(key);
    if (!p) continue;
    const { joints, forwardFrom } = pitchingJoints(p.p_throws === 'R');
    CONDITIONS.forEach((cond, ci) => {
      const { seq, events } = toSequence(
        head,
        rows,
        joints,
        forwardFrom,
        { plant: 'fp_10_time', release: 'BR_time', mer: 'MER_time' },
        { ...cond, seed: k },
      );
      if (!Number.isFinite(events.release)) return;
      const qa = qmod.assessClip(seq);
      const fc = common.cutoffs(qa.fps);
      const tr = tracks.buildTracks(seq, fc.position, fc.speed);
      const legs = common.pitchingLegs(tr);
      const w = legs.wrist;
      const iR = signal.argmax(w);
      if (iR < 0) return;
      const t = tr.t;
      const add = (name, tt) => (results[ci][name] ??= []).push((tt - events.release) * 1000);
      const addI = (name, i) => add(name, i >= 0 ? t[i] : NaN);
      addI('wrist speed peak', iR);
      for (const off of [-0.02, -0.01, 0.01])
        add(`peak ${off > 0 ? '+' : ''}${off * 1000}ms`, t[iR] + off);
      // Parabolic sub-frame peak.
      const a = w[iR - 1];
      const b = w[iR];
      const c = w[iR + 1];
      const d = a + c - 2 * b;
      const sub = Number.isFinite(d) && d < 0 ? (0.5 * (a - c)) / d : 0;
      add('peak (sub-frame)', t[iR] + sub / tr.fs);
      for (const off of [0.01, 0.012, 0.014])
        add(`sub-frame +${off * 1000}ms`, t[iR] + sub / tr.fs + off);
      add('peak +14ms', t[iR] + 0.014);
      // Wrist forward-most position and elbow extension.
      const fwd = legs.forward;
      const wx = tr.pos(legs.throwSide.wrist).x.map((v) => v * fwd);
      const lim = Math.min(tr.n - 1, iR + Math.round(0.2 * tr.fs));
      const from = Math.max(0, iR - Math.round(0.1 * tr.fs));
      addI('wrist fwd max', signal.argmax(wx, from, lim));
      const s = legs.throwSide;
      const elbow = Array.from({ length: tr.n }, (_, i) =>
        geom.angleAt(tr.at(s.shoulder, i), tr.at(s.elbow, i), tr.at(s.wrist, i)),
      );
      addI('elbow max', signal.argmax(elbow, from, lim));
      addI('position-filtered peak', signal.argmax(common.normSpeed(tr, s.wrist, false)));
    });
  }
  CONDITIONS.forEach((c, ci) => {
    console.log(`\n== ${c.fps} fps, noise ${c.noisePx}px  (ms, + = later than lab release)`);
    for (const [name, a] of Object.entries(results[ci])) console.log(name.padEnd(24), fmt(a));
  });
} finally {
  await server.close();
}
