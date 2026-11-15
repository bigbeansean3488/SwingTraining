import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoseSequence } from '../src/analysis/types';

export interface FixtureParams {
  kind: 'batting' | 'pitching';
  fps: number;
  forward?: 1 | -1;
  noisePx?: number;
  stride?: number;
  tempo?: number;
}

/** Load a compact keypoint fixture from tests/fixtures. */
export function loadFixture(name: string): { seq: PoseSequence; params: FixtureParams } {
  const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8')) as {
    params: FixtureParams;
    width: number;
    height: number;
    frames: [number, number[] | null][];
  };
  return {
    params: raw.params,
    seq: {
      width: raw.width,
      height: raw.height,
      frames: raw.frames.map(([t, flat]) => ({
        t,
        lm: flat
          ? Array.from({ length: flat.length / 3 }, (_, i) => ({
              x: flat[3 * i]!,
              y: flat[3 * i + 1]!,
              v: flat[3 * i + 2]!,
            }))
          : null,
      })),
    },
  };
}
