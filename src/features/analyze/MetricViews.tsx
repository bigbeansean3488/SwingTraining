import type { FigureShape, MetricFigure } from '../../analysis/figures';
import type { Vec } from '../../analysis/geometry';
import { SKELETON_EDGES } from '../../analysis/landmarks';
import type { PoseSequence } from '../../analysis/types';
import { nearestFrame } from '../../ui/skeleton';
import { LITERATURE_CAVEAT, REFERENCES, type LiteratureNote } from './literature';
import { formatMetric, type MetricInfo } from './metricInfo';

const MARK = '#facc15';
const MARK_EDGE = 'rgba(0,0,0,0.75)';

/**
 * One frame (keyframe photo, or the skeleton when there is no photo) cropped to
 * the athlete, with the measured angle / displacement drawn on top.
 */
export function MetricFigureView({
  seq,
  figure,
  torso,
  imageUrl,
  valueText,
}: {
  seq: PoseSequence;
  figure: MetricFigure;
  torso: number;
  imageUrl?: string;
  valueText: string;
}) {
  const W = seq.width;
  const H = seq.height;
  const frame =
    seq.frames[
      nearestFrame(
        seq.frames.map((f) => f.t),
        figure.t,
      )
    ];
  const lm = frame?.lm ?? null;
  const px = (i: number): Vec | null => {
    const p = lm?.[i];
    return p && p.v >= 0.3 ? { x: p.x * W, y: p.y * H } : null;
  };

  // Crop: the visible body plus every annotated point, padded.
  const pts: Vec[] = [];
  if (lm) for (let i = 0; i < lm.length; i++) if (i === 0 || i > 10) pts.push(px(i) ?? NaN_V);
  for (const s of figure.shapes) pts.push(...shapePoints(s));
  const ok = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!ok.length || !Number.isFinite(torso)) return null;
  const pad = 0.35 * torso;
  let x0 = Math.max(0, Math.min(...ok.map((p) => p.x)) - pad);
  let x1 = Math.min(W, Math.max(...ok.map((p) => p.x)) + pad);
  const y0 = Math.max(0, Math.min(...ok.map((p) => p.y)) - pad);
  const y1 = Math.min(H, Math.max(...ok.map((p) => p.y)) + pad);
  // Keep the crop from becoming a thin sliver.
  const minW = (y1 - y0) * 0.6;
  if (x1 - x0 < minW) {
    const c = (x0 + x1) / 2;
    x0 = Math.max(0, c - minW / 2);
    x1 = Math.min(W, c + minW / 2);
  }
  const sw = Math.max(2, torso * 0.028);
  const font = Math.max(12, torso * 0.16);

  return (
    <figure className="metric-figure">
      <svg
        viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`}
        role="img"
        aria-label={`量測位置示意：${valueText}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="#111827" />
        {imageUrl ? (
          <image href={imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
        ) : (
          <g stroke="#e5e7eb" strokeWidth={sw * 0.8} strokeLinecap="round" opacity={0.85}>
            {SKELETON_EDGES.map(([a, b]) => {
              const p = px(a);
              const q = px(b);
              return p && q ? <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} /> : null;
            })}
          </g>
        )}
        {figure.shapes.map((s, i) => (
          <Shape key={i} s={s} sw={sw} font={font} torso={torso} valueText={valueText} />
        ))}
      </svg>
      <figcaption className="small muted">{captionFor(figure.shapes)}</figcaption>
    </figure>
  );
}

const NaN_V: Vec = { x: NaN, y: NaN };

function shapePoints(s: FigureShape): Vec[] {
  switch (s.type) {
    case 'angle':
      return [s.a, s.b, s.c];
    case 'arrow':
    case 'line':
      return [s.from, s.to];
    case 'ghost':
      return [s.at];
    case 'path':
      return s.points;
  }
}

function captionFor(shapes: FigureShape[]): string {
  const parts: string[] = [];
  if (shapes.some((s) => s.type === 'angle')) parts.push('黃色：量的角度');
  if (shapes.some((s) => s.type === 'arrow')) parts.push('黃色箭頭：量的距離');
  if (shapes.some((s) => s.type === 'path')) parts.push('黃線：手的移動路徑，圓圈是最快的位置');
  else if (shapes.some((s) => s.type === 'ghost')) parts.push('虛線圈：起點（預備時或後腳的位置）');
  if (shapes.some((s) => s.type === 'line')) parts.push('白色虛線：參考線');
  return parts.join('・');
}

function Shape({
  s,
  sw,
  font,
  torso,
  valueText,
}: {
  s: FigureShape;
  sw: number;
  font: number;
  torso: number;
  valueText: string;
}) {
  switch (s.type) {
    case 'line':
      return (
        <line
          x1={s.from.x}
          y1={s.from.y}
          x2={s.to.x}
          y2={s.to.y}
          stroke="#ffffff"
          strokeWidth={sw * 0.7}
          strokeDasharray={`${sw * 2} ${sw * 1.5}`}
          opacity={0.9}
        />
      );
    case 'ghost':
      return (
        <circle
          cx={s.at.x}
          cy={s.at.y}
          r={torso * 0.08}
          fill="none"
          stroke="#ffffff"
          strokeWidth={sw * 0.8}
          strokeDasharray={`${sw * 1.5} ${sw}`}
        />
      );
    case 'path':
      return (
        <polyline
          points={s.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={MARK}
          strokeWidth={sw}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      );
    case 'arrow': {
      const dx = s.to.x - s.from.x;
      const dy = s.to.y - s.from.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return null;
      const ux = dx / len;
      const uy = dy / len;
      const head = Math.min(len * 0.45, sw * 4);
      const tip = s.to;
      const base = { x: tip.x - ux * head, y: tip.y - uy * head };
      const wing = head * 0.6;
      const poly = `${tip.x},${tip.y} ${base.x - uy * wing},${base.y + ux * wing} ${base.x + uy * wing},${base.y - ux * wing}`;
      const mid = { x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 };
      // Label beside the arrow: above a horizontal one, to the side of a vertical one.
      const horizontal = Math.abs(ux) >= Math.abs(uy);
      const lx = horizontal ? mid.x : mid.x + font * 0.6;
      const ly = horizontal ? Math.min(s.from.y, s.to.y) - font * 0.7 : mid.y + font * 0.35;
      const anchor = horizontal ? 'middle' : 'start';
      return (
        <g>
          <line
            x1={s.from.x}
            y1={s.from.y}
            x2={base.x}
            y2={base.y}
            stroke={MARK_EDGE}
            strokeWidth={sw * 1.8}
            strokeLinecap="round"
          />
          <line
            x1={s.from.x}
            y1={s.from.y}
            x2={base.x}
            y2={base.y}
            stroke={MARK}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <polygon points={poly} fill={MARK} stroke={MARK_EDGE} strokeWidth={sw * 0.4} />
          <Label x={lx} y={ly} font={font} text={valueText} anchor={anchor} />
        </g>
      );
    }
    case 'angle': {
      const { a, b, c } = s;
      const la = Math.hypot(a.x - b.x, a.y - b.y);
      const lc = Math.hypot(c.x - b.x, c.y - b.y);
      if (la < 1e-6 || lc < 1e-6) return null;
      const r = Math.min(la, lc) * 0.4;
      const ua = { x: (a.x - b.x) / la, y: (a.y - b.y) / la };
      const uc = { x: (c.x - b.x) / lc, y: (c.y - b.y) / lc };
      const pa = { x: b.x + ua.x * r, y: b.y + ua.y * r };
      const pc = { x: b.x + uc.x * r, y: b.y + uc.y * r };
      const sweep = ua.x * uc.y - ua.y * uc.x > 0 ? 1 : 0;
      const bis = { x: ua.x + uc.x, y: ua.y + uc.y };
      const bl = Math.hypot(bis.x, bis.y) || 1;
      // Put the label on the open side of the angle; for a narrow angle, beside it.
      const cos = ua.x * uc.x + ua.y * uc.y;
      const narrow = cos > Math.cos((40 * Math.PI) / 180);
      const side = { x: uc.x - ua.x, y: uc.y - ua.y };
      const sl = Math.hypot(side.x, side.y) || 1;
      const lx = narrow
        ? b.x + (bis.x / bl) * r + (side.x / sl) * font * 2.4
        : b.x + (bis.x / bl) * (r + font * 1.2);
      const ly =
        (narrow
          ? b.y + (bis.y / bl) * r + (side.y / sl) * font * 2.4
          : b.y + (bis.y / bl) * (r + font * 1.2)) +
        font * 0.35;
      const legs = `M ${a.x} ${a.y} L ${b.x} ${b.y} L ${c.x} ${c.y}`;
      return (
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={legs} stroke={MARK_EDGE} strokeWidth={sw * 1.8} />
          <path d={legs} stroke={MARK} strokeWidth={sw} />
          <path
            d={`M ${pa.x} ${pa.y} A ${r} ${r} 0 0 ${sweep} ${pc.x} ${pc.y}`}
            stroke={MARK}
            strokeWidth={sw * 0.8}
          />
          <Label x={lx} y={ly} font={font} text={valueText} />
        </g>
      );
    }
  }
}

function Label({
  x,
  y,
  font,
  text,
  anchor = 'middle',
}: {
  x: number;
  y: number;
  font: number;
  text: string;
  anchor?: 'start' | 'middle' | 'end';
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={font}
      fontWeight={800}
      textAnchor={anchor}
      fill="#ffffff"
      stroke="rgba(0,0,0,0.85)"
      strokeWidth={font * 0.18}
      paintOrder="stroke"
    >
      {text}
    </text>
  );
}

/**
 * This result on a line together with the athlete's own earlier range and the
 * analyses they marked as good. No external "ideal" band.
 */
export function RangeBar({
  value,
  past,
  refs,
  unit,
  info,
}: {
  value: number;
  past: number[];
  refs: number[];
  unit: string;
  info?: MetricInfo;
}) {
  const showPast = past.length >= 3;
  if (!showPast && !refs.length) return null;
  const all = [value, ...(showPast ? past : []), ...refs];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const padV = (hi - lo) * 0.08;
  lo -= padV;
  hi += padV;
  const W = 320;
  const H = 40;
  const L = 12;
  const R = W - 12;
  const sx = (v: number) => L + ((v - lo) / (hi - lo)) * (R - L);
  const y = 18;
  const fmt = (v: number) => formatMetric({ value: v, unit });
  const pMin = showPast ? Math.min(...past) : NaN;
  const pMax = showPast ? Math.max(...past) : NaN;
  const pMean = showPast ? past.reduce((s, v) => s + v, 0) / past.length : NaN;
  return (
    <div className="range-bar">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="這次與你自己的範圍">
        <line x1={L} x2={R} y1={y} y2={y} className="range-track" />
        {showPast ? (
          <g>
            <rect
              x={sx(pMin)}
              y={y - 7}
              width={Math.max(2, sx(pMax) - sx(pMin))}
              height={14}
              rx={4}
              className="range-band"
            >
              <title>{`你之前 ${past.length} 次：${fmt(pMin)}～${fmt(pMax)}`}</title>
            </rect>
            <line x1={sx(pMean)} x2={sx(pMean)} y1={y - 9} y2={y + 9} className="range-mean">
              <title>{`你之前的平均：${fmt(pMean)}`}</title>
            </line>
          </g>
        ) : null}
        {refs.map((v, i) => (
          <path
            key={i}
            d={`M ${sx(v)} ${y - 11} l 11 11 l -11 11 l -11 -11 Z`}
            className="range-ref"
          >
            <title>{`標記為好的動作：${fmt(v)}`}</title>
          </path>
        ))}
        <circle cx={sx(value)} cy={y} r={7} className="range-now">
          <title>{`這次：${fmt(value)}`}</title>
        </circle>
        <text x={L} y={H - 1} className="range-axis">
          {info?.small ?? '小'}
        </text>
        <text x={R} y={H - 1} textAnchor="end" className="range-axis">
          {info?.big ?? '大'}
        </text>
      </svg>
      <div className="range-legend small">
        <span>
          <i className="dot-now" />
          這次 {fmt(value)}
        </span>
        {showPast ? (
          <span>
            <i className="swatch-band" />
            你之前 {past.length} 次 {fmt(pMin)}～{fmt(pMax)}
          </span>
        ) : null}
        {refs.length ? (
          <span>
            <i className="dot-ref" />
            好的動作 {refs.length} 次
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Phases of the motion on one time line (real time). */
export function PhaseBar({
  events,
  order,
  labels,
  timeScale,
}: {
  events: Record<string, number>;
  order: string[];
  labels: Record<string, string>;
  timeScale: number;
}) {
  const names = order.filter((e) => Number.isFinite(events[e]));
  if (names.length < 2) return null;
  const t0 = events[names[0]!]!;
  const t1 = events[names[names.length - 1]!]!;
  const total = t1 - t0;
  if (!(total > 0)) return null;
  const segs = names.slice(1).map((e, i) => {
    const from = names[i]!;
    return {
      key: `${from}-${e}`,
      from,
      to: e,
      share: (events[e]! - events[from]!) / total,
      ms: Math.round((events[e]! - events[from]!) * timeScale * 1000),
    };
  });
  return (
    <div className="phase-bar">
      <div className="phase-track" role="img" aria-label="動作分期時間軸">
        {segs.map((s, i) => (
          <div
            key={s.key}
            className="phase-seg"
            style={{
              flexGrow: Math.max(0.02, s.share),
              background: `var(--series-${(i % 4) + 1})`,
            }}
            title={`${labels[s.from]} → ${labels[s.to]}：${s.ms} ms`}
          />
        ))}
      </div>
      <ol className="phase-list small">
        {segs.map((s, i) => (
          <li key={s.key}>
            <i style={{ background: `var(--series-${(i % 4) + 1})` }} />
            {labels[s.from]} → {labels[s.to]}
            <strong>{s.ms} ms</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Small drawing explaining the torso-length unit. */
export function TorsoIllustration() {
  return (
    <svg viewBox="0 0 172 150" className="torso-illus" role="img" aria-label="軀幹長示意圖">
      <g stroke="currentColor" strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.55}>
        <circle cx={50} cy={20} r={11} />
        <line x1={28} y1={42} x2={72} y2={42} />
        <line x1={34} y1={92} x2={66} y2={92} />
        <line x1={28} y1={42} x2={18} y2={80} />
        <line x1={72} y1={42} x2={82} y2={80} />
        <line x1={34} y1={92} x2={30} y2={142} />
        <line x1={66} y1={92} x2={70} y2={142} />
      </g>
      <line
        x1={50}
        y1={42}
        x2={50}
        y2={92}
        stroke="#eda100"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <circle cx={50} cy={42} r={5} fill="#eda100" />
      <circle cx={50} cy={92} r={5} fill="#eda100" />
      <g stroke="currentColor" strokeWidth={1.5} opacity={0.6}>
        <line x1={56} y1={42} x2={98} y2={30} />
        <line x1={56} y1={92} x2={98} y2={104} />
      </g>
      <text x={101} y={34} fontSize={13} fill="currentColor">
        肩膀中心
      </text>
      <text x={101} y={108} fontSize={13} fill="currentColor">
        骨盆中心
      </text>
    </svg>
  );
}

/** General research observations with links to the sources. */
export function LiteratureBlock({ notes }: { notes: LiteratureNote[] }) {
  return (
    <div className="lit">
      <strong>研究怎麼說</strong>
      {notes.map((n, i) => (
        <p key={i}>
          {n.text}
          {n.refs.map((r) => {
            const ref = REFERENCES[r];
            return ref ? (
              <span key={r}>
                {' '}
                <a href={ref.url} target="_blank" rel="noreferrer">
                  〔{ref.short}〕
                </a>
              </span>
            ) : null;
          })}
        </p>
      ))}
      <p className="small muted" style={{ marginBottom: 0 }}>
        {LITERATURE_CAVEAT}
      </p>
    </div>
  );
}
