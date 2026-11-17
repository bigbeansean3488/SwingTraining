// Which engine versions produce comparable numbers for each motion kind.
import type { MotionKind } from './types';

/**
 * Engine versions at which a kind's event detection or metric definitions
 * changed (docs/METRICS.md). Add the new version here whenever ENGINE_VERSION
 * is bumped for a change that affects that kind.
 */
export const DEFINITION_CHANGES: Record<MotionKind, readonly string[]> = {
  batting: ['1.0.0', '1.1.0', '1.2.0', '1.3.0'],
  pitching: ['1.0.0', '1.1.0'],
};

function compare(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The last definition change at or before `version` for this kind. A new
 * major version always counts as a change, listed or not.
 */
export function definitionGeneration(kind: MotionKind, version: string): string {
  let g = version;
  for (const v of DEFINITION_CHANGES[kind]) if (compare(v, version) <= 0) g = v;
  const major = version.split('.')[0];
  return g.split('.')[0] === major ? g : `${major}.0.0`;
}

/** True when two engine versions measure this kind with the same definitions. */
export function sameDefinitions(kind: MotionKind, a: string, b: string): boolean {
  return definitionGeneration(kind, a) === definitionGeneration(kind, b);
}
