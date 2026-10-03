// User-facing wording for swing results (Traditional Chinese, Taiwan), with
// established baseball / technical terms kept in English. Pure.
//
// Describes measurable differences from the player's own recent swings only —
// no coaching diagnosis ("姿勢錯誤", "髖開太早") and no quality claims.
// Wording cut-offs (|z| < 1 相近, < 2 稍…, else 明顯…) are display
// conventions, not validated thresholds (docs/metric-definitions.md §7).
import { headStabilityScore } from '../analysis/consistency.js';
import { sessionFocus } from './session.js';

export const FOCUS = Object.freeze({
  motion: { key: 'motion', label: 'Motion Consistency', short: 'Motion' },
  head: { key: 'head', label: 'Head Stability', short: 'Head' },
  stride: { key: 'stride', label: 'Stride Consistency', short: 'Stride' },
  handPath: { key: 'handPath', label: 'Hand Path Consistency', short: 'Hand Path' },
});
export const FOCUS_ORDER = ['motion', 'head', 'stride', 'handPath'];

export const CONTACT = Object.freeze({
  good: { zh: '扎實', en: 'Good' },
  medium: { zh: '普通', en: 'Medium' },
  poor: { zh: '沒打好', en: 'Poor' },
});

export const SIDE_ZH = { R: '右打', L: '左打' };

const COMPONENT_ZH = { head: 'Head movement', stride: 'Stride', timing: '節奏（Timing）', wristPath: 'Hand Path', pose: '整體動作軌跡' };

function byZ(z, t) {
  if (z === null || z === undefined || !Number.isFinite(z)) return null;
  const a = Math.abs(z);
  if (a < 1) return t.similar;
  if (a < 2) return z > 0 ? t.slightlyUp : t.slightlyDown;
  return z > 0 ? t.up : t.down;
}

// ---------------------------------------------------------------- per metric

export function headText(c) {
  if (!c) return '無法比較';
  if (c.rank.of >= 3 && c.rank.greater === c.rank.of && c.z <= -1) return `Head movement 比最近 ${c.rank.of} 棒都少`;
  if (c.rank.of >= 3 && c.rank.smaller === c.rank.of && c.z >= 1) return `Head movement 比最近 ${c.rank.of} 棒都多`;
  return byZ(c.z, {
    similar: 'Head movement 與最近 Swing 相近',
    slightlyUp: 'Head movement 比平常稍多',
    slightlyDown: 'Head movement 比平常稍少',
    up: 'Head movement 比平常明顯較多',
    down: 'Head movement 比平常明顯較少',
  });
}

export function strideText(c, metric) {
  if (metric?.diagnostics?.reason?.startsWith('no stride')) return '這一棒沒有偵測到明顯的 Stride';
  if (!c) return '無法比較';
  return byZ(c.z, {
    similar: 'Stride 與最近 Baseline 相近',
    slightlyUp: '這一棒的 Stride 比最近 Baseline 稍長',
    slightlyDown: '這一棒的 Stride 比最近 Baseline 稍短',
    up: '這一棒的 Stride 比最近 Baseline 明顯較長',
    down: '這一棒的 Stride 比最近 Baseline 明顯較短',
  });
}

export function handPathText(c) {
  if (!c) return '無法比較';
  if (c.deviation < 1.5) return 'Hand Path 與最近 Swing 相近';
  if (c.deviation < 3) return 'Hand Path 與最近 Swing 有些不同';
  return 'Hand Path 與最近 Swing 明顯不同';
}

export function timingText(cmp) {
  const t = cmp?.components?.timing?.startToPeak;
  if (!t) return '無法比較';
  return byZ(t.z, {
    similar: '節奏與最近 Swing 相近',
    slightlyUp: '從啟動到手速最快的時間比平常稍長',
    slightlyDown: '從啟動到手速最快的時間比平常稍短',
    up: '從啟動到手速最快的時間比平常明顯較長',
    down: '從啟動到手速最快的時間比平常明顯較短',
  });
}

/** Motion: name the component that differs most, or say it is close overall. */
export function motionText(cmp) {
  if (!cmp?.ok) return '無法比較';
  const d = [
    ['head', cmp.components.head?.deviation],
    ['stride', cmp.components.stride?.deviation],
    ['timing', Math.max(cmp.components.timing.startToPeak?.deviation ?? 0, cmp.components.timing.plantToPeak?.deviation ?? 0)],
    ['wristPath', cmp.components.wristPath?.deviation],
  ].filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1]);
  if (!d.length || d[0][1] < 2) return `整體動作與最近 ${cmp.baselineCount} 棒相近`;
  return `與最近 Baseline 差異最大的是 ${COMPONENT_ZH[d[0][0]]}`;
}

// ---------------------------------------------------------------- scores

/** 0–100 display scores per focus (null when there is no baseline yet). */
export function focusScores(swing) {
  const comps = swing?.consistency?.components || [];
  const comp = (name) => {
    const c = comps.find((x) => x.name === name && x.used);
    return c ? c.score : null;
  };
  const r = (v) => (v === null || v === undefined ? null : Math.round(v));
  return {
    motion: r(swing?.consistency?.score),
    head: r(headStabilityScore(swing?.comparison)),
    stride: r(comp('stride')),
    handPath: r(comp('wristPath')),
  };
}

export function scoreBand(score) {
  if (score === null || score === undefined) return 'none';
  if (score >= 80) return 'high';
  if (score >= 60) return 'mid';
  return 'low';
}

// ---------------------------------------------------------------- QC wording

const pct = (x) => `${Math.round(x * 100)}%`;
const GROUP_ZH = { head: '頭部', shoulders: '肩膀', hips: '髖部', wrists: '手腕', ankles: '前腳／腳踝' };

/** Traditional Chinese reason for a non-passing QC check. */
export function qcReasonZh(c) {
  if (c.id === 'presence') return `只有 ${pct(c.value)} 的畫面偵測到球員`;
  if (c.id.startsWith('group_')) return `${GROUP_ZH[c.id.slice(6)]}只有 ${pct(c.value)} 的畫面能可靠追蹤`;
  if (c.id === 'gap_body') return `球員從畫面中消失 ${c.value.toFixed(2)} 秒`;
  if (c.id.startsWith('gap_')) return `${GROUP_ZH[c.id.slice(4)]}追蹤中斷 ${c.value.toFixed(2)} 秒`;
  if (c.id === 'size') return `球員在畫面中太小（約畫面高度的 ${pct(c.value)}）`;
  if (c.id === 'outOfFrame') return `${pct(c.value)} 的畫面中球員部分超出畫面`;
  if (c.id === 'jumps') return `骨架有 ${c.value} 次突然跳動`;
  if (c.id === 'frames') return `可分析的畫面太少（${c.value} 幀）`;
  return c.reason;
}

const ADVICE_ZH = {
  presence: '讓球員完整入鏡，並改善照明。',
  group_wrists: '改善照明，或調整手機位置，讓手不被身體擋住。',
  group_ankles: '讓雙腳完整入鏡，避免被遮擋。',
  group_hips: '讓全身完整入鏡。',
  group_shoulders: '讓全身完整入鏡。',
  group_head: '讓頭部完整入鏡。',
  gap: '改善照明或減少動態模糊（可改用較高 FPS 錄影）。',
  size: '把手機架近一點。',
  outOfFrame: '鏡頭拉遠，或把手機往後移。',
  jumps: '檢查照明與背景，避免有人從球員後方經過。',
  frames: '請在揮棒前約 1 秒開始錄影。',
};

export function qcAdviceZh(c) {
  if (c.id.startsWith('gap_')) return ADVICE_ZH.gap;
  return ADVICE_ZH[c.id] || '';
}

/** Pipeline (non-QC) rejection reasons. */
export function pipelineReasonZh(reason) {
  if (!reason || reason === 'Unable to reliably analyze this swing.') return null;
  if (/no swing motion/.test(reason)) return '沒有偵測到揮棒動作';
  if (/before the analyzed window/.test(reason)) return '影片一開始就已經在揮棒，請在揮棒前約 1 秒開始錄影';
  if (/Body not tracked/.test(reason)) return '無法追蹤球員身體';
  return reason;
}

/** QC badge: icon + text (never color alone). */
export function qcBadge(level) {
  if (level === 'good') return { level, icon: '✓', text: 'Tracking 良好' };
  if (level === 'fair') return { level, icon: '!', text: 'Tracking 普通，數值僅供參考' };
  return { level: 'poor', icon: '⚠', text: '這一棒 Tracking 不穩定' };
}

// ---------------------------------------------------------------- swing result

/**
 * Mean focus score over the up-to-5 most recent earlier valid swings that
 * have one; used for the "比最近 5 棒平均 +6" trend.
 */
export function recentFocusMean(previous, focus, n = 5) {
  const scores = previous.filter((s) => s.valid).map((s) => focusScores(s)[focus]).filter((v) => v !== null).slice(-n);
  if (!scores.length) return { mean: null, count: 0 };
  return { mean: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length };
}

function deltaText(delta, count) {
  if (delta === null) return '';
  if (Math.abs(delta) < 1) return `與最近 ${count} 棒平均持平`;
  return `比最近 ${count} 棒平均 ${delta > 0 ? '+' : '−'}${Math.abs(Math.round(delta))}`;
}

/**
 * Everything the result card shows, as plain data.
 * @param swing    swing record (src/app/session.js)
 * @param focus    'motion' | 'head' | 'stride' | 'handPath'
 * @param previous earlier swings of the session (oldest → newest)
 */
export function describeSwing(swing, focus = 'motion', previous = []) {
  const a = swing.analysis;
  const checks = (a.qc?.checks || []).filter((c) => c.status !== 'pass');
  const reasons = [pipelineReasonZh(a.reason), ...checks.map(qcReasonZh)].filter(Boolean);
  const advice = [...new Set(checks.map(qcAdviceZh).filter(Boolean))];
  if (!a.usable && /before the analyzed window/.test(a.reason || '')) advice.unshift('請在揮棒前約 1 秒開始錄影，並讓手機固定在腳架上。');
  const base = {
    number: swing.number,
    contact: swing.contact,
    qc: qcBadge(a.usable ? a.qc?.level : 'poor'),
    reasons,
    advice,
  };
  if (!a.usable) {
    return { ...base, kind: 'rejected', headline: '這一棒 Tracking 不穩定', note: '這一棒不會加入 Baseline。' };
  }
  const cmp = swing.comparison;
  if (!cmp?.ok) {
    return { ...base, kind: 'baseline', headline: '第一棒有效 Swing', note: '正在建立 Baseline，下一棒開始會和這一棒比較。' };
  }
  const scores = focusScores(swing);
  const texts = {
    motion: motionText(cmp),
    head: headText(cmp.components.head),
    stride: strideText(cmp.components.stride, a.metrics.stride),
    handPath: handPathText(cmp.components.wristPath),
  };
  const recent = recentFocusMean(previous, focus);
  const delta = scores[focus] !== null && recent.mean !== null ? scores[focus] - recent.mean : null;
  return {
    ...base,
    kind: 'compared',
    baselineCount: cmp.baselineCount,
    focus: { key: focus, label: FOCUS[focus].label, score: scores[focus], band: scoreBand(scores[focus]), text: texts[focus], delta, deltaText: deltaText(delta, recent.count) },
    secondary: FOCUS_ORDER.filter((k) => k !== focus).map((k) => ({ key: k, label: FOCUS[k].label, score: scores[k], band: scoreBand(scores[k]), text: texts[k] })),
    timing: timingText(cmp),
  };
}

export const focusOf = sessionFocus;
