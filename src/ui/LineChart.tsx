import { useMemo, useRef, useState } from 'react';

export interface Point {
  /** epoch ms */
  x: number;
  y: number;
  note?: string;
}

interface Props {
  points: Point[];
  format: (v: number) => string;
  /** Accessible name; the card title names the series, so no legend for one series. */
  label: string;
  height?: number;
  /** Optional horizontal reference (e.g. personal mean). */
  reference?: { y: number; label: string };
  /** Shared x domain to align small multiples. */
  domain?: [number, number];
  color?: 1 | 2 | 3 | 4;
}

const W = 340;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const d = Math.abs(min) * 0.1 || 1;
    min -= d;
    max += d;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step)
    out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** Single-series time chart: 2px line, 8px markers, crosshair + tooltip, table view. */
export function LineChart({
  points,
  format,
  label,
  height = 180,
  reference,
  domain,
  color = 1,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  const sorted = useMemo(() => [...points].sort((a, b) => a.x - b.x), [points]);
  const H = height;
  const xs = sorted.map((p) => p.x);
  const ys = sorted.map((p) => p.y).concat(reference ? [reference.y] : []);
  const x0 = domain?.[0] ?? Math.min(...xs);
  const x1 = domain?.[1] ?? Math.max(...xs);
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0]!;
  const y1 = ticks[ticks.length - 1]!;
  const sx = (x: number) =>
    x1 === x0 ? (PAD.l + W - PAD.r) / 2 : PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const stroke = `var(--series-${color})`;

  if (!sorted.length) return <p className="empty">還沒有資料。</p>;

  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    sorted.forEach((p, i) => {
      if (Math.abs(sx(p.x) - px) < Math.abs(sx(sorted[best]!.x) - px)) best = i;
    });
    setHover(best);
  };
  const hp = hover !== null ? sorted[hover] : null;

  return (
    <div className="stack">
      <div style={{ position: 'relative' }}>
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          className="chart"
          role="img"
          aria-label={label}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          style={{ touchAction: 'pan-y' }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={sy(t)}
                y2={sy(t)}
                className="axis"
                strokeWidth={1}
                opacity={0.6}
              />
              <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          <text x={PAD.l} y={H - 6}>
            {fmtDate(x0)}
          </text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end">
            {fmtDate(x1)}
          </text>
          {reference ? (
            <g>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={sy(reference.y)}
                y2={sy(reference.y)}
                stroke="currentColor"
                strokeDasharray="4 4"
                opacity={0.5}
              />
              <text x={W - PAD.r} y={sy(reference.y) - 4} textAnchor="end">
                {reference.label}
              </text>
            </g>
          ) : null}
          {sorted.length > 1 ? (
            <polyline
              points={sorted.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
              fill="none"
              stroke={stroke}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ) : null}
          {hp ? (
            <line
              x1={sx(hp.x)}
              x2={sx(hp.x)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="currentColor"
              opacity={0.35}
            />
          ) : null}
          {sorted.map((p, i) => (
            <circle
              key={i}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={hover === i ? 6 : 4}
              fill={stroke}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          ))}
        </svg>
        {hp ? (
          <div
            className="chart-tip"
            style={{
              left: `${(sx(hp.x) / W) * 100}%`,
              transform: `translateX(${sx(hp.x) > W / 2 ? '-105%' : '5%'})`,
            }}
          >
            <strong>{format(hp.y)}</strong>
            <br />
            {new Date(hp.x).toLocaleDateString('zh-TW')}
            {hp.note ? (
              <>
                <br />
                {hp.note}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => setTable((t) => !t)}>
        {table ? '隱藏表格' : '顯示表格'}
      </button>
      {table ? (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>日期</th>
                <th>數值</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={i}>
                  <td>{new Date(p.x).toLocaleDateString('zh-TW')}</td>
                  <td>{format(p.y)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
