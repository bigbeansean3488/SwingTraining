// Runs the app's own analysis engine on the OpenBiomechanics Project (OBP)
// motion-capture data, projected to an ideal side view, so that reference
// distributions use exactly the same metric formulas as the phone analysis.
//
// Input (not committed, see docs/REFERENCE_DATA.md): data/obp/
// Output (not committed): data/obp/out/{pitching,hitting}_trials.json
//
// Usage: node scripts/obp/build-trials.mjs [--fps 120]
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = resolve(root, 'data/obp');
const outDir = resolve(dataDir, 'out');
const argFps = process.argv.indexOf('--fps');
const TARGET_FPS = argFps > 0 ? Number(process.argv[argFps + 1]) : 120;
const PX_PER_M = 400;
const WIDTH = 1600;
const HEIGHT = 1000;

// MediaPipe indices (src/analysis/landmarks.ts).
const L = { SH: 11, EL: 13, WR: 15, HIP: 23, KN: 25, AN: 27 };
const R = { SH: 12, EL: 14, WR: 16, HIP: 24, KN: 26, AN: 28 };

function readCsv(path) {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, c[i]]));
  });
}

/** Streams landmarks.csv and yields one { key, head, rows } per trial. */
async function* trials(path, keyCol) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let head = null;
  let cur = null;
  let rows = [];
  for await (const line of rl) {
    if (!head) {
      head = line.split(',');
      continue;
    }
    const c = line.split(',');
    const key = c[head.indexOf(keyCol)];
    if (key !== cur) {
      if (cur) yield { key: cur, head, rows };
      cur = key;
      rows = [];
    }
    rows.push(c.map(Number));
  }
  if (cur) yield { key: cur, head, rows };
}

/**
 * Builds a PoseSequence from 3D joint centers. `joints` maps a MediaPipe index
 * to a column prefix (`<prefix>_x/_y/_z`). The image plane is spanned by the
 * horizontal motion direction (image right) and the vertical axis (z up).
 */
function toSequence(head, rows, joints, forwardFrom, eventCols) {
  const col = (name) => head.indexOf(name);
  const tCol = col('time');
  const idx = Object.fromEntries(
    Object.entries(joints).map(([k, p]) => [k, [col(`${p}_x`), col(`${p}_y`), col(`${p}_z`)]]),
  );
  for (const [k, ix] of Object.entries(idx)) {
    if (ix.some((i) => i < 0)) throw new Error(`missing column for ${k}: ${joints[k]}`);
  }
  const events = Object.fromEntries(
    Object.entries(eventCols).map(([name, c]) => [name, rows[0][col(c)]]),
  );
  // Forward = horizontal direction from rear to lead ankle at foot plant.
  const tPlant = events.plant;
  const iPlant = Math.max(
    0,
    rows.findIndex((r) => r[tCol] >= tPlant),
  );
  const [rear, lead] = forwardFrom;
  const a = idx[rear];
  const b = idx[lead];
  const fr = rows[iPlant];
  let fx = fr[b[0]] - fr[a[0]];
  let fy = fr[b[1]] - fr[a[1]];
  const fn = Math.hypot(fx, fy);
  fx /= fn;
  fy /= fn;

  const srcFps = 1 / (rows[1][tCol] - rows[0][tCol]);
  const step = Math.max(1, Math.round(srcFps / TARGET_FPS));
  // Centre the motion horizontally.
  const xs = rows.map((r) => r[idx[lead][0]] * fx + r[idx[lead][1]] * fy);
  const x0 = (Math.min(...xs) + Math.max(...xs)) / 2;
  const frames = [];
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i];
    if (Object.values(idx).some((ix) => ix.some((j) => !Number.isFinite(r[j])))) {
      frames.push({ t: r[tCol], lm: null });
      continue;
    }
    const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }));
    for (const [k, ix] of Object.entries(idx)) {
      const h = r[ix[0]] * fx + r[ix[1]] * fy - x0;
      lm[Number(k)] = {
        x: (WIDTH / 2 + h * PX_PER_M) / WIDTH,
        y: (HEIGHT - 50 - r[ix[2]] * PX_PER_M) / HEIGHT,
        v: 0.99,
      };
    }
    frames.push({ t: r[tCol], lm });
  }
  return { seq: { width: WIDTH, height: HEIGHT, frames }, events, srcFps };
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
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
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
      const rightHanded = meta.hitter_side === 'R';
      const joints = {
        [L.SH]: 'lsjc',
        [L.EL]: 'lejc',
        [L.WR]: 'lwjc',
        [L.HIP]: 'left_hip',
        [L.KN]: 'lkjc',
        [L.AN]: 'lajc',
        [R.SH]: 'rsjc',
        [R.EL]: 'rejc',
        [R.WR]: 'rwjc',
        [R.HIP]: 'right_hip',
        [R.KN]: 'rkjc',
        [R.AN]: 'rajc',
      };
      // Right-handed hitter: lead (front) leg is the left one.
      const rearAn = rightHanded ? R.AN : L.AN;
      const leadAn = rightHanded ? L.AN : R.AN;
      const { seq, events } = toSequence(head, rows, joints, [rearAn, leadAn], {
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
