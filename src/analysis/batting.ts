// Batting analysis (side camera: perpendicular to the pitcher–batter line,
// facing the batter's front). See docs/METRICS.md §2 for definitions.
import {
  ENGINE_VERSION,
  battingLegs,
  battingStride,
  confidenceAt,
  cutoffs,
  firstBelowAfter,
  handSpeed,
  medianPos,
  metric,
  ms,
  normSpeed,
  onsetBefore,
  sidesAt,
  widthClosingOnset,
} from './common';
import { angleAt, leanFromVertical } from './geometry';
import { LM } from './landmarks';
import { assessClip, windowValidFraction } from './quality';
import { argmax, isNum } from './signal';
import { buildTracks, indexAt } from './tracks';
import type { AnalysisOptions, AnalysisResult, EventTimes, Metrics, PoseSequence } from './types';

export const BATTING_EVENTS = ['stance', 'load', 'plant', 'contact', 'finish'] as const;

export function analyzeBatting(seq: PoseSequence, opts: AnalysisOptions = {}): AnalysisResult {
  const quality = assessClip(seq);
  const base = (fc = { position: 0, speed: 0 }): AnalysisResult => ({
    kind: 'batting',
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

  const legs = battingLegs(tr);
  const { lead, forward } = legs;
  const hands = handSpeed(tr);
  const ankle = normSpeed(tr, lead.ankle);

  // --- Event detection -----------------------------------------------------
  let iC = argmax(hands);
  const iA = argmax(ankle, 0, iC);
  let iP = iA >= 0 ? firstBelowAfter(ankle, iA, Math.max(0.2 * ankle[iA]!, 0.5), iC) : -1;
  let iL = iA >= 0 ? onsetBefore(ankle, iA, Math.max(0.1 * ankle[iA]!, 0.15)) : -1;
  let iF = iC >= 0 ? firstBelowAfter(hands, iC, 0.25 * hands[iC]!) : -1;
  const warnings = [...quality.warnings];
  if (iF < 0) {
    iF = tr.n - 1;
    warnings.push('finish_not_in_clip');
  }
  if (iL === 0) warnings.push('load_at_clip_start');

  const manual = opts.manualEvents ?? {};
  const pick = (name: string, i: number) => (isNum(manual[name]) ? indexAt(tr, manual[name]!) : i);
  iL = pick('load', iL);
  iP = pick('plant', iP);
  iC = pick('contact', iC);
  iF = pick('finish', iF);
  const iS = pick('stance', 0);

  const reportQuality = { ...quality, warnings };
  if ([iL, iP, iC, iF].some((i) => i < 0) || !(iS <= iL && iL < iP && iP <= iC && iC < iF)) {
    return { ...base(fc), quality: reportQuality, forward, failure: 'events_not_found' };
  }
  const t = tr.t;
  const plantToContact = t[iC]! - t[iP]!;
  if (plantToContact > 1.2) {
    return { ...base(fc), quality: reportQuality, forward, failure: 'timing_implausible' };
  }

  // Tracking must be good inside the motion window, not just on average.
  const winFrac = windowValidFraction(
    seq,
    quality.frameConfidence,
    t[Math.max(0, iL - Math.round(0.2 * tr.fs))]!,
    t[iF]!,
  );
  if (winFrac < 0.8) {
    return {
      ...base(fc),
      quality: { ...reportQuality, ok: false, issues: ['tracking_window'], validFraction: winFrac },
      forward,
      failure: 'tracking_window',
    };
  }

  const events: EventTimes = {
    stance: t[iS]!,
    load: t[iL]!,
    plant: t[iP]!,
    contact: t[iC]!,
    finish: t[iF]!,
  };

  // --- Metrics ---------------------------------------------------------------
  const T = tr.torso;
  const refA = Math.max(0, iL - Math.round(0.2 * tr.fs));
  const refB = Math.max(refA, iL);
  const m: Metrics = {};
  const put = (key: string, r: ReturnType<typeof metric>) => {
    if (r) m[key] = r;
  };
  const phaseConf = confidenceAt(tr, [lead.ankle, LM.L_WRIST, LM.R_WRIST], [iL, iP, iC, iF]);

  put(
    'phase_stance_ms',
    metric(ms(t[iL]! - t[iS]!), 'ms', phaseConf, { diagnostics: { dependsOnClipStart: true } }),
  );
  put('phase_load_ms', metric(ms(t[iP]! - t[iL]!), 'ms', phaseConf));
  put('phase_plant_to_contact_ms', metric(ms(plantToContact), 'ms', phaseConf));
  put('phase_follow_ms', metric(ms(t[iF]! - t[iC]!), 'ms', phaseConf));

  const stride = battingStride(tr, legs, refA, refB, iP);
  if (stride.value === null) warnings.push('stride_implausible');
  else {
    put(
      'stride_length',
      metric(stride.value, 'torso', confidenceAt(tr, [lead.ankle, legs.rear.ankle], [refB, iP]), {
        diagnostics: {
          torsoPx: Math.round(T),
          raw: Math.round(stride.raw * 1000) / 1000,
          labelSwapAtPlant: stride.swapped,
        },
      }),
    );
  }

  const hipRef = {
    x: (medianPos(tr, LM.L_HIP, refA, refB).x + medianPos(tr, LM.R_HIP, refA, refB).x) / 2,
  };
  const hipC = tr.mid(LM.L_HIP, LM.R_HIP, iC);
  put(
    'pelvis_shift',
    metric(
      ((hipC.x - hipRef.x) * forward) / T,
      'torso',
      confidenceAt(tr, [LM.L_HIP, LM.R_HIP], [refB, iC]),
    ),
  );

  const headRef = medianPos(tr, LM.NOSE, refA, refB);
  const headC = tr.at(LM.NOSE, iC);
  const headConf = confidenceAt(tr, [LM.NOSE], [refB, iC]);
  put('head_dx', metric(((headC.x - headRef.x) * forward) / T, 'torso', headConf));
  put('head_dy', metric((headRef.y - headC.y) / T, 'torso', headConf));

  const knee = (i: number) => {
    const s = sidesAt(tr, legs, i).lead;
    return angleAt(tr.at(s.hip, i), tr.at(s.knee, i), tr.at(s.ankle, i));
  };
  put(
    'lead_knee_plant',
    metric(knee(iP), 'deg', confidenceAt(tr, [lead.hip, lead.knee, lead.ankle], [iP])),
  );
  put(
    'lead_knee_contact',
    metric(knee(iC), 'deg', confidenceAt(tr, [lead.hip, lead.knee, lead.ankle], [iC])),
  );

  const trunk = leanFromVertical(
    tr.mid(LM.L_HIP, LM.R_HIP, iC),
    tr.mid(LM.L_SHOULDER, LM.R_SHOULDER, iC),
    forward,
  );
  put(
    'trunk_tilt_contact',
    metric(
      trunk,
      'deg',
      confidenceAt(tr, [LM.L_HIP, LM.R_HIP, LM.L_SHOULDER, LM.R_SHOULDER], [iC]),
    ),
  );

  const iPeak = argmax(hands, iP, iF);
  if (iPeak >= 0) {
    const wConf = confidenceAt(tr, [LM.L_WRIST, LM.R_WRIST], [iPeak]);
    put('wrist_peak_speed', metric(hands[iPeak]!, 'torso/s', wConf));
    put(
      'wrist_peak_time_ms',
      metric(ms(t[iPeak]! - t[iP]!), 'ms', wConf, { diagnostics: { relativeTo: 'plant' } }),
    );
  }

  const from = Math.max(0, iP - Math.round(0.25 * tr.fs));
  const pelvis = widthClosingOnset(tr, LM.L_HIP, LM.R_HIP, from, iC);
  const shoulders = widthClosingOnset(tr, LM.L_SHOULDER, LM.R_SHOULDER, from, iC);
  if (pelvis && shoulders) {
    const conf = confidenceAt(
      tr,
      [LM.L_HIP, LM.R_HIP, LM.L_SHOULDER, LM.R_SHOULDER],
      [pelvis.onset, shoulders.onset],
    );
    put(
      'seq_pelvis_lead_ms',
      metric(ms(t[shoulders.onset]! - t[pelvis.onset]!), 'ms', Math.round(conf * 50) / 100, {
        experimental: true,
        diagnostics: { pelvisOnset: t[pelvis.onset]!, shoulderOnset: t[shoulders.onset]! },
      }),
    );
  }

  return {
    kind: 'batting',
    engineVersion: ENGINE_VERSION,
    quality: { ...reportQuality, validFraction: winFrac },
    events,
    metrics: m,
    forward,
    filter: { positionCutoffHz: fc.position, speedCutoffHz: fc.speed, order: 4 },
  };
}
