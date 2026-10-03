// Session + swing records and session-level logic. Pure (no DOM, no storage).
//
// Session { id, createdAt, playerName, battingSide: 'R'|'L'|null, note }
// Swing   { id, sessionId, number, createdAt, video, poseQuality, landmarks,
//           analysis, comparison, consistencyInputs, consistency,
//           contact: 'good'|'medium'|'poor'|null, valid, excludeFromBaseline, note }
import { reduceSequence } from '../pose/landmarks.js';
import { compareToBaseline, componentDeviations } from '../analysis/comparison.js';
import { consistencyInputs, scoreFromInputs } from '../analysis/consistency.js';

export const CONTACT_LABELS = Object.freeze(['good', 'medium', 'poor']);

export function newId(prefix, now = Date.now(), rand = Math.random) {
  return `${prefix}-${now.toString(36)}-${Math.floor(rand() * 1e8).toString(36)}`;
}

export function createSession({ playerName = '', battingSide = null, note = '' } = {}, now = Date.now()) {
  if (battingSide !== null && battingSide !== 'R' && battingSide !== 'L') throw new Error('battingSide must be R, L or null');
  return { id: newId('session', now), createdAt: now, playerName: playerName.trim(), battingSide, note };
}

/** Compact QC summary stored with the swing. */
function qcSummary(qc) {
  if (!qc) return null;
  return { level: qc.level, usable: qc.usable, reasons: qc.reasons, advice: qc.advice, frames: qc.frames };
}

/**
 * Build a swing record from an analysis. `previous` = earlier swings of the
 * session (oldest → newest) used for the comparison.
 */
export function createSwingRecord({ session, seq, analysis, video = null, previous = [], now = Date.now() }) {
  const number = previous.length ? Math.max(...previous.map((s) => s.number)) + 1 : 1;
  const record = {
    id: newId('swing', now),
    sessionId: session.id,
    number,
    createdAt: now,
    video,
    poseQuality: qcSummary(analysis.qc),
    landmarks: seq ? reduceSequence(seq) : null,
    analysis,
    contact: null,
    valid: !!analysis.usable,
    excludeFromBaseline: false,
    note: '',
  };
  return withComparison(record, previous);
}

/** (Re)compute comparison + consistency for a swing against earlier swings. */
export function withComparison(record, previous) {
  const cmp = record.analysis.usable ? compareToBaseline(record, previous) : null;
  const inputs = consistencyInputs(cmp);
  return {
    ...record,
    comparison: cmp,
    deviations: Object.fromEntries(componentDeviations(cmp)),
    consistencyInputs: inputs,
    consistency: record.analysis.usable ? scoreFromInputs(inputs) : null,
  };
}

/**
 * Recompute comparisons for a whole session in order (e.g. after a swing is
 * excluded or deleted). Deterministic.
 */
export function recomputeSession(swings) {
  const sorted = [...swings].sort((a, b) => a.number - b.number);
  const out = [];
  for (const s of sorted) out.push(withComparison(s, out));
  return out;
}

export function setContactLabel(swing, label) {
  if (label !== null && !CONTACT_LABELS.includes(label)) throw new Error(`invalid contact label: ${label}`);
  return { ...swing, contact: label };
}

/** Scalar metrics of a swing for tables/exports (null when not analyzable). */
export function swingRow(s) {
  const m = s.analysis?.metrics;
  return {
    number: s.number,
    valid: s.valid,
    contact: s.contact,
    consistency: s.consistency?.score ?? null,
    head: m?.headStability.value ?? null,
    stride: m?.stride.value ?? null,
    startToPeak: m?.timing.value.startToPeak ?? null,
    wristPathDev: s.deviations?.wristPath ?? null,
    qc: s.poseQuality?.level ?? null,
  };
}

/**
 * Motion metrics grouped by contact label (manual outcome annotation).
 * Descriptive only — no inference or prediction.
 */
export function labelSummary(swings) {
  const groups = {};
  for (const label of [...CONTACT_LABELS, 'unlabeled']) groups[label] = [];
  for (const s of swings) {
    if (!s.valid) continue;
    groups[s.contact ?? 'unlabeled'].push(swingRow(s));
  }
  const avg = (rows, k) => {
    const v = rows.map((r) => r[k]).filter((x) => x !== null && x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return Object.fromEntries(Object.entries(groups).map(([label, rows]) => [label, {
    count: rows.length,
    consistency: avg(rows, 'consistency'),
    head: avg(rows, 'head'),
    stride: avg(rows, 'stride'),
    startToPeak: avg(rows, 'startToPeak'),
  }]));
}

/** Export a session as plain JSON (for analysis outside the app). */
export function exportSession(session, swings) {
  return {
    format: 'swingtraining-session',
    version: 1,
    exportedAt: new Date().toISOString(),
    session,
    swings: swings.map((s) => ({ ...s, row: swingRow(s) })),
  };
}
