// Where this value sits in the OBP research sample (D23): percentile rank,
// the sample's common range, and the range of the faster third when the
// metric is associated with pitch speed / exit velocity. No good/bad label.
import {
  percentileRank,
  REFERENCE_SOURCE,
  referenceBand,
  referenceRange,
  referenceSample,
  type ReferenceBand,
} from '../../analysis/reference';
import type { MotionKind } from '../../analysis/types';
import { formatMetric, type MetricInfo } from './metricInfo';

const WHO: Record<MotionKind, { people: string; fast: string }> = {
  pitching: { people: '投手', fast: '球速較快的三分之一投手' },
  batting: { people: '打者', fast: '擊球初速較快的三分之一打者' },
};

function bandText(band: ReferenceBand, info?: MetricInfo): string {
  const big = info?.big ?? '大';
  const small = info?.small ?? '小';
  switch (band) {
    case 'common':
      return '在常見範圍內（樣本中間的 50%）';
    case 'low':
      return `比常見範圍${small}一些`;
    case 'high':
      return `比常見範圍${big}一些`;
    case 'rare_low':
      return `比樣本裡 90% 的人都${small}，在樣本中算少見（手機不是放在正側面時也常出現）`;
    case 'rare_high':
      return `比樣本裡 90% 的人都${big}，在樣本中算少見（手機不是放在正側面時也常出現）`;
  }
}

export function ReferenceRangeView({
  kind,
  metricKey,
  value,
  unit,
  engineVersion,
  info,
}: {
  kind: MotionKind;
  metricKey: string;
  value: number;
  unit: string;
  engineVersion: string;
  info?: MetricInfo;
}) {
  const sample = referenceSample(kind, engineVersion);
  const r = referenceRange(kind, metricKey, engineVersion);
  if (!sample || !r || !Number.isFinite(value)) return null;
  const pr = percentileRank(r, value);
  const band = referenceBand(r, value);
  const pro = kind === 'pitching' ? r.groups.pro : undefined;
  const fmt = (v: number) => formatMetric({ value: v, unit });

  const lo0 = Math.min(r.q[0]!, value);
  const hi0 = Math.max(r.q[r.q.length - 1]!, value);
  const pad = (hi0 - lo0) * 0.06 || 1;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const W = 320;
  const L = 12;
  const R = W - 12;
  const sx = (v: number) => L + ((v - lo) / (hi - lo)) * (R - L);
  const y = 16;
  const H = pro ? 52 : 40;

  return (
    <div className="ref-range">
      <div className="ref-range-head">
        <span>
          研究樣本 <strong>PR {pr}</strong>
        </span>
        <span className="muted">・{bandText(band, info)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="這次在研究樣本中的位置">
        <line x1={sx(r.q[0]!)} x2={sx(r.q[20]!)} y1={y} y2={y} className="range-track" />
        <rect
          x={sx(r.usual[0])}
          y={y - 4}
          width={Math.max(2, sx(r.usual[1]) - sx(r.usual[0]))}
          height={8}
          rx={3}
          className="ref-usual"
        >
          <title>{`樣本中間 80%：${fmt(r.usual[0])}～${fmt(r.usual[1])}`}</title>
        </rect>
        <rect
          x={sx(r.common[0])}
          y={y - 7}
          width={Math.max(2, sx(r.common[1]) - sx(r.common[0]))}
          height={14}
          rx={4}
          className="ref-common"
        >
          <title>{`常見範圍（中間 50%）：${fmt(r.common[0])}～${fmt(r.common[1])}`}</title>
        </rect>
        {r.highOutcome ? (
          <rect
            x={sx(r.highOutcome.p25)}
            y={y - 10}
            width={Math.max(2, sx(r.highOutcome.p75) - sx(r.highOutcome.p25))}
            height={20}
            rx={5}
            className="ref-fast"
          >
            <title>{`${WHO[kind].fast}：${fmt(r.highOutcome.p25)}～${fmt(r.highOutcome.p75)}`}</title>
          </rect>
        ) : null}
        <circle cx={sx(value)} cy={y} r={7} className="range-now">
          <title>{`這次：${fmt(value)}`}</title>
        </circle>
        {pro ? (
          <g>
            <line x1={sx(pro.p25)} x2={sx(pro.p75)} y1={y + 22} y2={y + 22} className="ref-pro" />
            <line x1={sx(pro.p50)} x2={sx(pro.p50)} y1={y + 17} y2={y + 27} className="ref-pro" />
            <title>{`小聯盟＋獨立聯盟投手（${pro.n} 人）中間 50%：${fmt(pro.p25)}～${fmt(pro.p75)}`}</title>
          </g>
        ) : null}
        {/* Sample minimum and maximum, under the ends of the sample track. */}
        <text
          x={sx(r.q[0]!)}
          y={H - 2}
          textAnchor={sx(r.q[0]!) < L + 30 ? 'start' : 'middle'}
          className="range-axis"
        >
          {fmt(r.q[0]!)}
        </text>
        <text
          x={sx(r.q[20]!)}
          y={H - 2}
          textAnchor={sx(r.q[20]!) > R - 30 ? 'end' : 'middle'}
          className="range-axis"
        >
          {fmt(r.q[20]!)}
        </text>
      </svg>
      <div className="range-legend small">
        <span>
          <i className="swatch-ref-common" />
          常見範圍 {fmt(r.common[0])}～{fmt(r.common[1])}
        </span>
        {r.highOutcome ? (
          <span>
            <i className="swatch-ref-fast" />
            {WHO[kind].fast} {fmt(r.highOutcome.p25)}～{fmt(r.highOutcome.p75)}
          </span>
        ) : null}
        {pro ? (
          <span>
            <i className="swatch-ref-pro" />
            職業（小聯盟＋獨立聯盟，{pro.n} 人）{fmt(pro.p25)}～{fmt(pro.p75)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Explains the research sample once per page. */
export function ReferenceSampleNote({
  kind,
  engineVersion,
}: {
  kind: MotionKind;
  engineVersion: string;
}) {
  const sample = referenceSample(kind, engineVersion);
  if (!sample) return null;
  const pros = (sample.levels.milb ?? 0) + (sample.levels.independent ?? 0);
  return (
    <details className="lit">
      <summary>
        <strong>「研究樣本 PR」是什麼？</strong>
      </summary>
      <p>
        <strong>只有用正側面拍攝時，這個比較才有意義。</strong>
        手機斜著拍，跨步、角度都會變形，PR 值會偏到很高或很低。
      </p>
      <p>
        PR 63 表示：在研究樣本的 {sample.athletes} 位{WHO[kind].people}中，大約 63%
        的人數值比你小。這是位置，不是分數，數值大或小都不代表好或不好。
      </p>
      <p>
        樣本來自美國 Driveline 的實驗室動作捕捉資料（以大學選手為主，含 {pros}{' '}
        位小聯盟或獨立聯盟選手）。我們把 3D 資料投影成「正側面」後，用跟這個 App
        完全相同的公式計算，每位選手取多次的平均。
      </p>
      <p>
        「常見範圍」是樣本中間 50% 的人。只有在樣本中跟
        {kind === 'pitching' ? '球速' : '擊球初速'}
        有統計關聯的指標，才會另外標出「較快的三分之一」常落的範圍；有關聯不代表照著改就會變快。
      </p>
      <p>
        限制：實驗室資料沒有手機拍攝的誤差，你的數字會比樣本更分散；樣本以美國大學選手為主，
        跟你的年齡、體型、投打方式可能不同。這是一般性的參考，不是個人建議。
      </p>
      <p className="small muted" style={{ marginBottom: 0 }}>
        資料來源：
        <a href={REFERENCE_SOURCE.url} target="_blank" rel="noreferrer">
          {REFERENCE_SOURCE.name}
        </a>
        （{REFERENCE_SOURCE.author}），
        <a href={REFERENCE_SOURCE.licenseUrl} target="_blank" rel="noreferrer">
          {REFERENCE_SOURCE.license}
        </a>
        。本 App 已將原始 3D 資料轉換為側面 2D 並重新計算指標；Driveline 未參與也未背書本 App。
      </p>
    </details>
  );
}
