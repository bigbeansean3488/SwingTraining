import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, ENGINE_VERSION } from '../analysis';
import type { PoseSequence } from '../analysis/types';
import { generatePitching } from '../../tests/synthetic';
import { packKeypoints, unpackKeypoints } from './compress';
import {
  loadBuiltinReferences,
  parseBuiltinReference,
  referenceFromAnalysis,
  type BuiltinReferenceFile,
} from './references';
import type { MotionAnalysis } from './types';

const EXAMPLE = join(__dirname, '..', 'data', 'references', 'demo-pitching-three-quarter.json');

/** The synthetic example (no real person): a three-quarter pitching motion at 120 fps. */
async function buildExample(): Promise<BuiltinReferenceFile> {
  const seq = generatePitching({
    fps: 120,
    stride: 1.5,
    tempo: 1.1,
    noisePx: 1,
    seed: 3,
  }) as PoseSequence;
  const r = analyze('pitching', seq);
  if (r.failure) throw new Error(r.failure);
  return {
    format: 'reference-motion',
    version: 1,
    id: 'builtin:demo-pitching-three-quarter',
    kind: 'pitching',
    label: '合成示範：3/4 投法（非真人）',
    style: { arm_slot: 'three_quarter', arm_action: 'short' },
    source_note:
      '由 tests/synthetic.ts 產生的合成骨架，只用來測試畫面，不是真人動作，也不是建議的動作。',
    recorded_at: null,
    fps: r.quality.fps,
    time_scale: 1,
    forward: r.forward,
    model_version: 'synthetic',
    engine_version: ENGINE_VERSION,
    events: r.events,
    metrics: r.metrics,
    quality: {
      warnings: r.quality.warnings,
      meanConfidence: r.quality.meanConfidence,
      fps: r.quality.fps,
    },
    keypoints: await packKeypoints(seq),
    source: {
      title: '合成骨架（本專案 tests/synthetic.ts）',
      url: null,
      license: '本專案授權',
      author: null,
    },
    demo: true,
  };
}

describe('built-in references', () => {
  it.runIf(process.env.UPDATE_REFERENCE_EXAMPLE === '1')(
    'regenerates the example file',
    async () => {
      writeFileSync(EXAMPLE, `${JSON.stringify(await buildExample(), null, 1)}\n`);
    },
  );

  it('the bundled synthetic example is valid and matches what the engine computes', async () => {
    const raw = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as unknown;
    const f = parseBuiltinReference(raw);
    expect(f).not.toBeNull();
    expect(f!.demo).toBe(true);
    expect(f!.source.title).toContain('合成');
    const seq = await unpackKeypoints(f!.keypoints);
    const r = analyze('pitching', seq);
    expect(r.failure).toBeUndefined();
    for (const [k, t] of Object.entries(f!.events)) expect(r.events[k]).toBeCloseTo(t, 2);
    if (f!.engine_version.split('.')[0] === ENGINE_VERSION.split('.')[0])
      expect(r.metrics.stride_length!.value).toBeCloseTo(f!.metrics.stride_length!.value, 1);
  });

  it('loader returns demo files only when asked', async () => {
    expect((await loadBuiltinReferences(true)).map((e) => e.id)).toContain(
      'builtin:demo-pitching-three-quarter',
    );
    expect((await loadBuiltinReferences(false)).some((e) => e.demo)).toBe(false);
  });

  it('rejects malformed files', async () => {
    const good = await buildExample();
    expect(parseBuiltinReference(good)).not.toBeNull();
    expect(parseBuiltinReference({ ...good, id: 'not-builtin' })).toBeNull();
    expect(parseBuiltinReference({ ...good, kind: 'running' })).toBeNull();
    expect(parseBuiltinReference({ ...good, style: { arm_slot: 'weird' } })).toBeNull();
    expect(parseBuiltinReference({ ...good, keypoints: 'xyz' })).toBeNull();
    expect(parseBuiltinReference({ ...good, source: { title: 'x' } })).toBeNull();
    expect(parseBuiltinReference({ ...good, events: { plant: 'soon' } })).toBeNull();
    expect(parseBuiltinReference(null)).toBeNull();
  });
});

describe('referenceFromAnalysis', () => {
  it('copies keypoints and results but never the video or keyframes', () => {
    const a = {
      id: 'a1',
      player_id: 'p1',
      kind: 'pitching',
      recorded_at: '2026-11-17T00:00:00Z',
      capture: { timeScale: 0.125 },
      fps: 30,
      model_version: 'm',
      engine_version: '1.1.0',
      events: { plant: 1 },
      metrics: { stride_length: { value: 1, unit: 'torso', confidence: 1 } },
      quality: {
        ok: true,
        issues: [],
        warnings: ['fps_low'],
        validFraction: 1,
        meanConfidence: 0.9,
        fps: 30,
      },
      forward: -1,
      keypoints: 'gz:abc',
      keyframes: [{ event: 'plant', blob_key: 'k', path: null }],
      video_blob_key: 'video:1',
    } as unknown as MotionAnalysis;
    const r = referenceFromAnalysis(a, {
      label: '示範',
      style: { arm_slot: 'sidearm' },
      source_note: null,
      team_id: 't1',
    });
    expect(r).toMatchObject({
      team_id: 't1',
      player_id: 'p1',
      source_analysis_id: 'a1',
      time_scale: 0.125,
      forward: -1,
      keypoints: 'gz:abc',
      quality: { warnings: ['fps_low'] },
    });
    expect(r).not.toHaveProperty('video_blob_key');
    expect(r).not.toHaveProperty('keyframes');
  });
});
