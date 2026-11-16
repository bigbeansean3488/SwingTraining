// Pitching analysis (side camera: perpendicular to the throwing direction,
// facing the pitcher's front). See docs/METRICS.md §3 for definitions.
import {
  ENGINE_VERSION,
  LEFT,
  confidenceAt,
  cutoffs,
  firstBelowAfter,
  metric,
  ms,
  normSpeed,
  pitchingLegs,
  pitchingStride,
  sidesAt,
} from './common';
import { angleAt, leanFromVertical } from './geometry';
import { LM } from './landmarks';
import { assessClip, windowValidFraction } from './quality';
import { argmax, argmin, isNum } from './signal';
import { buildTracks, indexAt } from './tracks';
import type { AnalysisOptions, AnalysisResult, EventTimes, Metrics, PoseSequence } from './types';

export const PITCHING_EVENTS = ['liftTop', 'plant', 'release', 'finish'] as const;

export function analyzePitching(seq: PoseSequence, opts: AnalysisOptions = {}): AnalysisResult {
  const quality = assessClip(seq);
  const base = (fc = { position: 0, speed: 0 }): AnalysisResult => ({
    kind: 'pitching',
    engineVersion: ENGINE_VERSION,
    quality,
    events: {},
    metrics: {},
    forward: 0,
    filter: { positionCutoffHz: fc.position, speedCutoffHz: fc.speed, order: 4 },
  });
  if (!quality.ok) return { ...base(), failure: quality.issues[0] };

  const fc = cutoffs(quality.fps, opts.positionCutoffHz, opts.speedCutoffHz);
  const tr = buildTracks(seq, fc.position, fc.speed);
  if (!isNum(tr.torso) || tr.torso < 20) return { ...base(fc), failure: 'person_too_small' };

  // Stride leg from the knee lift before release, not the follow-through.
  const legs = pitchingLegs(tr);
  const { lead, rear, forward, throwSide, glove, wrist } = legs;
  const ankle = normSpeed(tr, lead.ankle);

  // --- Events ---------------------------------------------------------------
  let iR = argmax(wrist);
  const iA = argmax(ankle, 0, iR);
  let iP = iA >= 0 ? firstBelowAfter(ankle, iA, Math.max(0.2 * ankle[iA]!, 0.5), iR) : -1;
  let iT = iP > 0 ? argmin(tr.pos(lead.knee).y, 0, iP) : -1;
  let iF = iR >= 0 ? firstBelowAfter(wrist, iR, 0.25 * wrist[iR]!) : -1;
  const warnings = [...quality.warnings];
  if (iF < 0) {
    iF = tr.n - 1;
    warnings.push('finish_not_in_clip');
  }
  if (iT === 0) warnings.push('lift_at_clip_start');

  const manual = opts.manualEvents ?? {};
  const pick = (name: string, i: number) => (isNum(manual[name]) ? indexAt(tr, manual[name]!) : i);
  iT = pick('liftTop', iT);
  iP = pick('plant', iP);
  iR = pick('release', iR);
  iF = pick('finish', iF);

  const reportQuality = { ...quality, warnings };
  if ([iT, iP, iR, iF].some((i) => i < 0) || !(iT < iP && iP <= iR && iR < iF)) {
    return { ...base(fc), quality: reportQuality, forward, failure: 'events_not_found' };
  }
  const t = tr.t;
  if (t[iR]! - t[iP]! > 1.0) {
    return { ...base(fc), quality: reportQuality, forward, failure: 'timing_implausible' };
  }
  const winFrac = windowValidFraction(seq, quality.frameConfidence, t[iT]!, t[iF]!);
  if (winFrac < 0.8) {
    return {
      ...base(fc),
      quality: { ...reportQuality, ok: false, issues: ['tracking_window'], validFraction: winFrac },
      forward,
      failure: 'tracking_window',
    };
  }

  const events: EventTimes = { liftTop: t[iT]!, plant: t[iP]!, release: t[iR]!, finish: t[iF]! };

  // --- Metrics --------------------------------------------------------------
  const T = tr.torso;
  const m: Metrics = {};
  const put = (key: string, r: ReturnType<typeof metric>) => {
    if (r) m[key] = r;
  };
  const phaseConf = confidenceAt(tr, [lead.knee, lead.ankle, throwSide.wrist], [iT, iP, iR, iF]);
  put('phase_lift_to_plant_ms', metric(ms(t[iP]! - t[iT]!), 'ms', phaseConf));
  put('phase_plant_to_release_ms', metric(ms(t[iR]! - t[iP]!), 'ms', phaseConf));
  put('phase_release_to_finish_ms', metric(ms(t[iF]! - t[iR]!), 'ms', phaseConf));
  put('phase_lift_to_release_ms', metric(ms(t[iR]! - t[iT]!), 'ms', phaseConf));

  const stride = pitchingStride(tr, legs, iP);
  if (stride.value === null) warnings.push('stride_implausible');
  else {
    put(
      'stride_length',
      metric(stride.value, 'torso', confidenceAt(tr, [lead.ankle, rear.ankle], [iP]), {
        diagnostics: {
          torsoPx: Math.round(T),
          from: 'rear ankle at plant',
          raw: Math.round(stride.raw * 1000) / 1000,
          labelSwapAtPlant: stride.swapped,
        },
      }),
    );
  }

  const knee = (i: number) => {
    const s = sidesAt(tr, legs, i).lead;
    return angleAt(tr.at(s.hip, i), tr.at(s.knee, i), tr.at(s.ankle, i));
  };
  put(
    'lead_knee_plant',
    metric(knee(iP), 'deg', confidenceAt(tr, [lead.hip, lead.knee, lead.ankle], [iP])),
  );
  put(
    'lead_knee_release',
    metric(knee(iR), 'deg', confidenceAt(tr, [lead.hip, lead.knee, lead.ankle], [iR])),
  );

  const trunk = leanFromVertical(
    tr.mid(LM.L_HIP, LM.R_HIP, iR),
    tr.mid(LM.L_SHOULDER, LM.R_SHOULDER, iR),
    forward,
  );
  put(
    'trunk_forward_release',
    metric(
      trunk,
      'deg',
      confidenceAt(tr, [LM.L_HIP, LM.R_HIP, LM.L_SHOULDER, LM.R_SHOULDER], [iR]),
    ),
  );

  // Elbow height relative to the line through both shoulders (positive = above).
  const sA = tr.at(glove.shoulder, iP);
  const sB = tr.at(throwSide.shoulder, iP);
  const e = tr.at(throwSide.elbow, iP);
  if (Math.abs(sB.x - sA.x) > 0.05 * T) {
    const yLine = sA.y + ((sB.y - sA.y) * (e.x - sA.x)) / (sB.x - sA.x);
    put(
      'elbow_height_plant',
      metric(
        (yLine - e.y) / T,
        'torso',
        confidenceAt(tr, [glove.shoulder, throwSide.shoulder, throwSide.elbow], [iP]),
        {
          diagnostics: { throwingArm: throwSide === LEFT ? 'L' : 'R' },
        },
      ),
    );
  }

  return {
    kind: 'pitching',
    engineVersion: ENGINE_VERSION,
    quality: { ...reportQuality, validFraction: winFrac },
    events,
    metrics: m,
    forward,
    filter: { positionCutoffHz: fc.position, speedCutoffHz: fc.speed, order: 4 },
  };
}
