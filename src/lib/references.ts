// Reference motions (標竿動作, docs/DECISIONS.md D22) from two sources:
//  - team: rows of `reference_motions`, copied from a motion analysis on a device;
//  - built-in: JSON files bundled with the app in src/data/references/*.json
//    (same fields plus `source`). Each file is loaded only when needed.
import { useEffect, useState } from 'react';
import type { MotionKind } from '../analysis/types';
import { useRows } from './hooks';
import type {
  ArmAction,
  ArmSlot,
  MotionAnalysis,
  ReferenceMotion,
  ReferenceMotionData,
  ReferenceStyle,
} from './types';

export const ARM_SLOTS: ArmSlot[] = ['overhand', 'three_quarter', 'sidearm', 'submarine'];
export const ARM_ACTIONS: ArmAction[] = ['long', 'short'];

/** Where a built-in reference comes from; shown next to it. */
export interface BuiltinSource {
  title: string;
  url: string | null;
  license: string;
  author: string | null;
}

/** Format of src/data/references/*.json. */
export interface BuiltinReferenceFile extends ReferenceMotionData {
  format: 'reference-motion';
  version: 1;
  /** Stable id, e.g. "builtin:pitching-three-quarter-demo". */
  id: string;
  source: BuiltinSource;
  /** Synthetic sample for development: hidden in production builds. */
  demo?: boolean;
}

export interface ReferenceEntry extends ReferenceMotionData {
  id: string;
  origin: 'team' | 'builtin';
  player_id: string | null;
  created_by: string | null;
  team_id: string | null;
  /** Built-in only. */
  source?: BuiltinSource;
  demo?: boolean;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function parseStyle(v: unknown): ReferenceStyle | null {
  if (!isObj(v)) return null;
  const out: ReferenceStyle = {};
  if (v.arm_slot != null) {
    if (!ARM_SLOTS.includes(v.arm_slot as ArmSlot)) return null;
    out.arm_slot = v.arm_slot as ArmSlot;
  }
  if (v.arm_action != null) {
    if (!ARM_ACTIONS.includes(v.arm_action as ArmAction)) return null;
    out.arm_action = v.arm_action as ArmAction;
  }
  if (v.tag != null) {
    if (!isStr(v.tag)) return null;
    out.tag = v.tag;
  }
  return out;
}

/**
 * Validate a built-in reference file. Returns null (and the file is skipped)
 * when a required field is missing or malformed, so one bad file cannot
 * break the picker.
 */
export function parseBuiltinReference(raw: unknown): BuiltinReferenceFile | null {
  if (!isObj(raw) || raw.format !== 'reference-motion' || raw.version !== 1) return null;
  const style = parseStyle(raw.style ?? {});
  const src = raw.source;
  if (
    !isStr(raw.id) ||
    !raw.id.startsWith('builtin:') ||
    (raw.kind !== 'batting' && raw.kind !== 'pitching') ||
    !isStr(raw.label) ||
    !raw.label ||
    !style ||
    !isNumber(raw.fps) ||
    !isStr(raw.model_version) ||
    !isStr(raw.engine_version) ||
    !isObj(raw.events) ||
    !Object.values(raw.events).every(isNumber) ||
    !isObj(raw.metrics) ||
    !isStr(raw.keypoints) ||
    !/^(gz|raw):/.test(raw.keypoints) ||
    !isObj(src) ||
    !isStr(src.title) ||
    !isStr(src.license)
  )
    return null;
  const quality = isObj(raw.quality) ? raw.quality : {};
  return {
    format: 'reference-motion',
    version: 1,
    id: raw.id,
    kind: raw.kind,
    label: raw.label,
    style,
    source_note: isStr(raw.source_note) ? raw.source_note : null,
    recorded_at: isStr(raw.recorded_at) ? raw.recorded_at : null,
    fps: raw.fps,
    time_scale: isNumber(raw.time_scale) && raw.time_scale > 0 ? raw.time_scale : 1,
    forward: isNumber(raw.forward) ? Math.sign(raw.forward) : 0,
    model_version: raw.model_version,
    engine_version: raw.engine_version,
    events: raw.events as Record<string, number>,
    metrics: raw.metrics as ReferenceMotionData['metrics'],
    quality: {
      warnings: Array.isArray(quality.warnings) ? quality.warnings.filter(isStr) : [],
      ...(isNumber(quality.meanConfidence) ? { meanConfidence: quality.meanConfidence } : {}),
      ...(isNumber(quality.fps) ? { fps: quality.fps } : {}),
    },
    keypoints: raw.keypoints,
    source: {
      title: src.title,
      license: src.license,
      url: isStr(src.url) ? src.url : null,
      author: isStr(src.author) ? src.author : null,
    },
    demo: raw.demo === true,
  };
}

export function builtinToEntry(f: BuiltinReferenceFile): ReferenceEntry {
  const { format: _f, version: _v, ...rest } = f;
  return { ...rest, origin: 'builtin', player_id: null, created_by: null, team_id: null };
}

export function rowToEntry(r: ReferenceMotion): ReferenceEntry {
  return {
    id: r.id,
    origin: 'team',
    kind: r.kind,
    label: r.label,
    style: r.style ?? {},
    source_note: r.source_note,
    recorded_at: r.recorded_at,
    fps: r.fps,
    time_scale: r.time_scale || 1,
    forward: r.forward,
    model_version: r.model_version,
    engine_version: r.engine_version,
    events: r.events,
    metrics: r.metrics,
    quality: r.quality ?? { warnings: [] },
    keypoints: r.keypoints,
    player_id: r.player_id,
    created_by: r.created_by,
    team_id: r.team_id,
  };
}

// Files named demo-*.json are synthetic samples for development: they are only
// bundled in dev/test builds (the branch is removed from production builds).
const loaders = {
  ...import.meta.glob(['../data/references/*.json', '!../data/references/demo-*.json'], {
    import: 'default',
  }),
  ...(import.meta.env.DEV
    ? import.meta.glob('../data/references/demo-*.json', { import: 'default' })
    : {}),
};

let builtinCache: Promise<BuiltinReferenceFile[]> | null = null;

/** All valid built-in references (cached). Demo files only in development. */
export function loadBuiltinReferences(
  includeDemo = import.meta.env.DEV,
): Promise<ReferenceEntry[]> {
  builtinCache ??= Promise.all(
    Object.values(loaders).map((load) => load().then(parseBuiltinReference, () => null)),
  ).then((xs) => xs.filter((x): x is BuiltinReferenceFile => !!x));
  return builtinCache.then((xs) => xs.filter((x) => includeDemo || !x.demo).map(builtinToEntry));
}

/** Team references (synced) followed by built-in ones; null while loading. */
export function useReferenceEntries(kind?: MotionKind): ReferenceEntry[] | null {
  const rows = useRows('reference_motions', (r) => !kind || r.kind === kind, [kind]);
  const [builtin, setBuiltin] = useState<ReferenceEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadBuiltinReferences().then((b) => alive && setBuiltin(b));
    return () => {
      alive = false;
    };
  }, []);
  if (!rows || !builtin) return null;
  const team = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(rowToEntry);
  return [...team, ...builtin.filter((b) => !kind || b.kind === kind)];
}

/**
 * Fields of a new reference copied from an analysis: keypoints, events and
 * metrics only (never the video or keyframe images).
 */
export function referenceFromAnalysis(
  a: MotionAnalysis,
  meta: {
    label: string;
    style: ReferenceStyle;
    source_note: string | null;
    team_id: string | null;
  },
): Omit<ReferenceMotion, 'id' | 'created_at' | 'updated_at' | 'deleted_at'> {
  return {
    team_id: meta.team_id,
    player_id: a.player_id,
    source_analysis_id: a.id,
    kind: a.kind,
    label: meta.label,
    style: meta.style,
    source_note: meta.source_note,
    recorded_at: a.recorded_at,
    fps: a.fps,
    time_scale: a.capture?.timeScale || 1,
    forward: a.forward,
    model_version: a.model_version,
    engine_version: a.engine_version,
    events: a.events,
    metrics: a.metrics,
    quality: {
      warnings: a.quality.warnings,
      meanConfidence: a.quality.meanConfidence,
      fps: a.quality.fps,
    },
    keypoints: a.keypoints,
    created_by: null,
  };
}
