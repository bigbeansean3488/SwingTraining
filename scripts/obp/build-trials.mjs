// Runs the app's own analysis engine on the OpenBiomechanics Project (OBP)
// motion-capture data, projected to an ideal side view, so that reference
// distributions use exactly the same metric formulas as the phone analysis.
//
// Input (not committed, see docs/REFERENCE_DATA.md): data/obp/
// Output (not committed): data/obp/out/{pitching,hitting}_trials.json
//
// Usage: node scripts/obp/build-trials.mjs [--fps 120]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  L,
  R,
  dataDir,
  engineServer,
  hittingJoints,
  readCsv,
  toSequence as toSeq,
  trials,
} from './lib.mjs';

const outDir = resolve(dataDir, 'out');
const argFps = process.argv.indexOf('--fps');
const TARGET_FPS = argFps > 0 ? Number(process.argv[argFps + 1]) : 120;
const toSequence = (head, rows, joints, forwardFrom, eventCols) =>
  toSeq(head, rows, joints, forwardFrom, eventCols, { fps: TARGET_FPS });

/**
 * Bat finish from the lab bat marker: after the bat-speed peak (contact), the
 * first time the sweet-spot speed falls below 20% of that peak. Null if the
 * clip ends first. Used only to check the hand-based finish rule.
 */
function batFinish(head, rows) {
  const c = (n) => head.indexOf(n);
  const [ti, sx, sy, sz] = [c('time'), c('sweet_spot_x'), c('sweet_spot_y'), c('sweet_spot_z')];
  if ([sx, sy, sz].some((i) => i < 0)) return null;
  const v = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const s = Math.hypot(b[sx] - a[sx], b[sy] - a[sy], b[sz] - a[sz]) / (b[ti] - a[ti]);
    v.push({ t: b[ti], s: Number.isFinite(s) ? s : 0 });
  }
  let iPk = 0;
  for (let i = 1; i < v.length; i++) if (v[i].s > v[iPk].s) iPk = i;
  const j = v.findIndex((x, i) => i > iPk && x.s < 0.2 * v[iPk].s);
  return j > 0 ? v[j].t : null;
}

function torso3d(head, rows, sh, hip) {
  // Median 3D torso length (mid-shoulder to mid-hip), metres.
  const c = (p) => [head.indexOf(`${p}_x`), head.indexOf(`${p}_y`), head.indexOf(`${p}_z`)];
  const [s1, s2, h1, h2] = [c(sh[0]), c(sh[1]), c(hip[0]), c(hip[1])];
  const v = rows
    .map((r) => {
      const d = [0, 1, 2].map((k) => (r[s1[k]] + r[s2[k]]) / 2 - (r[h1[k]] + r[h2[k]]) / 2);
      return Math.hypot(...d);
    })
    .filter(Number.isFinite)
    .sort((x, y) => x - y);
  return v[Math.floor(v.length / 2)];
}

const pick = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.value]));

async function main() {
  mkdirSync(outDir, { recursive: true });
  const server = await engineServer();
  try {
    const { analyze, ENGINE_VERSION } = await server.ssrLoadModule('/src/analysis/index.ts');

    // ---- pitching
    const pMeta = new Map(
      readCsv(resolve(dataDir, 'baseball_pitching_data_metadata.csv')).map((r) => [
        r.session_pitch,
        r,
      ]),
    );
    const pPoi = new Map(
      readCsv(resolve(dataDir, 'baseball_pitching_data_poi_poi_metrics.csv')).map((r) => [
        r.session_pitch,
        r,
      ]),
    );
    const pitching = [];
    for await (const { key, head, rows } of trials(
      resolve(dataDir, 'pitching/landmarks.csv'),
      'session_pitch',
    )) {
      const meta = pMeta.get(key);
      const poi = pPoi.get(key);
      if (!meta || !poi) continue;
      const right = poi.p_throws === 'R';
      const T = right ? R : L; // throwing side
      const G = right ? L : R; // glove side (lead leg)
      const joints = {
        [T.SH]: 'shoulder_jc',
        [T.EL]: 'elbow_jc',
        [T.WR]: 'wrist_jc',
        [G.SH]: 'glove_shoulder_jc',
        [G.EL]: 'glove_elbow_jc',
        [G.WR]: 'glove_wrist_jc',
        [T.HIP]: 'rear_hip',
        [T.KN]: 'rear_knee_jc',
        [T.AN]: 'rear_ankle_jc',
        [G.HIP]: 'lead_hip',
        [G.KN]: 'lead_knee_jc',
        [G.AN]: 'lead_ankle_jc',
      };
      const { seq, events } = toSequence(head, rows, joints, [T.AN, G.AN], {
        liftTop: 'pkh_time',
        plant: 'fp_10_time',
        release: 'BR_time',
      });
      const auto = analyze('pitching', seq);
      const manual = analyze('pitching', seq, { manualEvents: events });
      pitching.push({
        key,
        user: meta.user,
        level: meta.playing_level,
        heightM: Number(meta.session_height_m),
        speedMph: Number(meta.pitch_speed_mph),
        throws: poi.p_throws,
        armSlot: Number(poi.arm_slot),
        obpStride: Number(poi.stride_length),
        torso3dM: torso3d(
          head,
          rows,
          ['shoulder_jc', 'glove_shoulder_jc'],
          ['rear_hip', 'lead_hip'],
        ),
        obpEvents: events,
        autoEvents: auto.events,
        autoFailure: auto.failure ?? null,
        failure: manual.failure ?? null,
        warnings: manual.quality.warnings,
        metrics: pick(manual.metrics),
        autoMetrics: pick(auto.metrics),
      });
    }
    writeFileSync(
      resolve(outDir, 'pitching_trials.json'),
      JSON.stringify({ engine: ENGINE_VERSION, fps: TARGET_FPS, trials: pitching }),
    );
    console.log(`pitching: ${pitching.length} trials`);

    // ---- hitting
    const hMeta = new Map(
      readCsv(resolve(dataDir, 'baseball_hitting_data_metadata.csv')).map((r) => [
        r.session_swing,
        r,
      ]),
    );
    const hPoi = new Map(
      readCsv(resolve(dataDir, 'baseball_hitting_data_poi_poi_metrics.csv')).map((r) => [
        r.session_swing,
        r,
      ]),
    );
    const hitting = [];
    for await (const { key, head, rows } of trials(
      resolve(dataDir, 'hitting/landmarks.csv'),
      'session_swing',
    )) {
      const meta = hMeta.get(key);
      if (!meta) continue;
      const { joints, forwardFrom } = hittingJoints(meta.hitter_side === 'R');
      const { seq, events } = toSequence(head, rows, joints, forwardFrom, {
        plant: 'fp_10_time',
        contact: 'contact_time',
      });
      const auto = analyze('batting', seq);
      const manual = analyze('batting', seq, { manualEvents: events });
      const poi = hPoi.get(key);
      hitting.push({
        key,
        user: meta.user,
        level: meta.highest_playing_level,
        heightM: Number(meta.session_height_in) * 0.0254,
        side: meta.hitter_side,
        exitVelo: Number(meta.exit_velo_mph_x),
        batSpeed: Number(meta.bat_speed_mph_max_x),
        torso3dM: torso3d(head, rows, ['lsjc', 'rsjc'], ['left_hip', 'right_hip']),
        obpEvents: events,
        batFinish: batFinish(head, rows),
        autoEvents: auto.events,
        autoFailure: auto.failure ?? null,
        failure: manual.failure ?? null,
        warnings: manual.quality.warnings,
        metrics: pick(manual.metrics),
        autoMetrics: pick(auto.metrics),
        hasPoi: Boolean(poi),
      });
    }
    writeFileSync(
      resolve(outDir, 'hitting_trials.json'),
      JSON.stringify({ engine: ENGINE_VERSION, fps: TARGET_FPS, trials: hitting }),
    );
    console.log(`hitting: ${hitting.length} trials`);
  } finally {
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
