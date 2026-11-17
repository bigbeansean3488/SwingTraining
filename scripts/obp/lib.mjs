// Shared helpers for the OpenBiomechanics Project (OBP) scripts.
// Input data is not committed; see docs/REFERENCE_DATA.md.
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const dataDir = resolve(root, 'data/obp');

const PX_PER_M = 400;
const WIDTH = 1600;
const HEIGHT = 1000;

// MediaPipe indices (src/analysis/landmarks.ts).
export const L = { SH: 11, EL: 13, WR: 15, HIP: 23, KN: 25, AN: 27 };
export const R = { SH: 12, EL: 14, WR: 16, HIP: 24, KN: 26, AN: 28 };

export function readCsv(path) {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h, c[i]]));
  });
}

/** Streams landmarks.csv and yields one { key, head, rows } per trial. */
export async function* trials(path, keyCol) {
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
    rows.push(c.map((v) => (v === '' ? NaN : Number(v))));
  }
  if (cur) yield { key: cur, head, rows };
}

/** Deterministic Gaussian noise source. */
export function gaussian(seed) {
  let s = seed >>> 0;
  const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 1) / (2 ** 32 + 1);
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/**
 * Builds a PoseSequence from 3D joint centers. `joints` maps a MediaPipe index
 * to a column prefix (`<prefix>_x/_y/_z`). The image plane is spanned by the
 * horizontal motion direction (image right) and the vertical axis (z up).
 * Options: fps (target frame rate), noisePx (Gaussian pixel noise on a
 * 1600x1000 frame), seed.
 */
export function toSequence(head, rows, joints, forwardFrom, eventCols, opts = {}) {
  const { fps = 120, noisePx = 0, seed = 1 } = opts;
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
  const step = Math.max(1, Math.round(srcFps / fps));
  // Centre the motion horizontally.
  const xs = rows.map((r) => r[idx[lead][0]] * fx + r[idx[lead][1]] * fy).filter(Number.isFinite);
  const x0 = (Math.min(...xs) + Math.max(...xs)) / 2;
  const noise = gaussian(seed);
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
        x: (WIDTH / 2 + h * PX_PER_M + noisePx * noise()) / WIDTH,
        y: (HEIGHT - 50 - r[ix[2]] * PX_PER_M + noisePx * noise()) / HEIGHT,
        v: 0.99,
      };
    }
    frames.push({ t: r[tCol], lm });
  }
  return { seq: { width: WIDTH, height: HEIGHT, frames }, events, srcFps, forward: [fx, fy] };
}

/** Joint mapping for an OBP hitting trial. */
export function hittingJoints(rightHanded) {
  return {
    joints: {
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
    },
    // Right-handed hitter: lead (front) leg is the left one.
    forwardFrom: rightHanded ? [R.AN, L.AN] : [L.AN, R.AN],
  };
}

/** Starts a Vite SSR server so the TypeScript engine can be loaded from Node. */
export async function engineServer() {
  return createServer({
    root,
    configFile: false,
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
}

/** Joint mapping for an OBP pitching trial (throwing side from p_throws). */
export function pitchingJoints(rightHanded) {
  const T = rightHanded ? R : L; // throwing side
  const G = rightHanded ? L : R; // glove side (lead leg)
  return {
    joints: {
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
    },
    forwardFrom: [T.AN, G.AN],
  };
}
