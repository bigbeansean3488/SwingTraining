// User-facing wording for a swing result. Pure.
// Describes differences from the player's own recent swings only — no
// coaching claims ("your hip rotation is wrong" etc.) and no quality claims.
// Wording cut-offs (|z| < 1 "similar", < 2 "slightly", else plain) are display
// conventions, not validated thresholds (docs/metric-definitions.md §7).

const plural = (n) => (n === 1 ? 'swing' : 'swings');

function byZ(z, { similar, slightlyUp, slightlyDown, up, down }) {
  if (z === null || z === undefined || !Number.isFinite(z)) return null;
  const a = Math.abs(z);
  if (a < 1) return similar;
  if (a < 2) return z > 0 ? slightlyUp : slightlyDown;
  return z > 0 ? up : down;
}

export function headText(c) {
  if (!c) return 'Not available';
  // Rank-based statement when it holds for every baseline swing.
  if (c.rank.of >= 3 && c.rank.greater === c.rank.of && c.z <= -1) return `Steadier than your last ${c.rank.of} ${plural(c.rank.of)}`;
  if (c.rank.of >= 3 && c.rank.smaller === c.rank.of && c.z >= 1) return `More head movement than your last ${c.rank.of} ${plural(c.rank.of)}`;
  return byZ(c.z, {
    similar: 'Similar to your recent swings',
    slightlyUp: 'Slightly more head movement than usual',
    slightlyDown: 'Slightly steadier than usual',
    up: 'More head movement than usual',
    down: 'Steadier than usual',
  });
}

export function strideText(c, metric) {
  if (metric?.diagnostics?.reason?.startsWith('no stride')) return 'No stride detected';
  if (!c) return 'Not available';
  return byZ(c.z, {
    similar: 'Similar to your baseline',
    slightlyUp: 'Slightly longer than your baseline',
    slightlyDown: 'Slightly shorter than your baseline',
    up: 'Longer than your baseline',
    down: 'Shorter than your baseline',
  });
}

export function handPathText(c) {
  if (!c) return 'Not available';
  if (c.deviation < 1.5) return 'Similar to your recent swings';
  if (c.deviation < 3) return 'Somewhat different from your recent swings';
  return 'Different from your recent swings';
}

export function timingText(cmp) {
  const t = cmp?.components?.timing?.startToPeak;
  if (!t) return 'Not available';
  return byZ(t.z, {
    similar: 'Similar tempo to your recent swings',
    slightlyUp: 'Slightly slower to peak hand speed than usual',
    slightlyDown: 'Slightly quicker to peak hand speed than usual',
    up: 'Slower to peak hand speed than usual',
    down: 'Quicker to peak hand speed than usual',
  });
}

export function scoreBand(score) {
  if (score === null || score === undefined) return 'none';
  if (score >= 80) return 'high';
  if (score >= 60) return 'mid';
  return 'low';
}

/**
 * Everything the result card shows, as plain data.
 * @param swing swing record (src/app/session.js)
 */
export function describeSwing(swing) {
  const a = swing.analysis;
  if (!a.usable) {
    return {
      kind: 'rejected',
      title: `Swing #${swing.number}`,
      headline: 'Unable to reliably analyze this swing.',
      quality: a.qc?.level ?? 'poor',
      // The pipeline's own reason first (e.g. "swing starts before the
      // analyzed window"), then any QC reasons.
      reasons: [...(a.reason && a.reason !== 'Unable to reliably analyze this swing.' ? [a.reason] : []), ...(a.qc?.reasons ?? [])],
      advice: a.qc?.advice ?? [],
    };
  }
  const cmp = swing.comparison;
  const lowConf = a.qc.level === 'fair';
  const suffix = lowConf ? ' (lower confidence)' : '';
  if (!cmp?.ok) {
    return {
      kind: 'baseline',
      title: `Swing #${swing.number}`,
      headline: 'First valid swing — building your baseline.',
      quality: a.qc.level,
      reasons: a.qc.reasons,
      advice: a.qc.advice,
      lines: [],
    };
  }
  const n = cmp.baselineCount;
  return {
    kind: 'compared',
    title: `Swing #${swing.number}`,
    score: swing.consistency?.score ?? null,
    band: scoreBand(swing.consistency?.score),
    baselineNote: `compared with your last ${n} valid ${plural(n)}`,
    quality: a.qc.level,
    reasons: a.qc.reasons,
    advice: a.qc.advice,
    lines: [
      { label: 'Head', text: headText(cmp.components.head) + suffix },
      { label: 'Stride', text: strideText(cmp.components.stride, a.metrics.stride) + suffix },
      { label: 'Hand path', text: handPathText(cmp.components.wristPath) + suffix },
    ],
    timing: timingText(cmp),
  };
}
