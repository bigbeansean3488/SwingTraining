import { useState } from 'react';

export interface BarSeries {
  key: string;
  label: string;
  color: 1 | 2 | 3 | 4;
}

interface Props {
  /** One row per time bucket; x is epoch ms of the bucket start. */
  rows: ({ x: number } & Record<string, number>)[];
  series: BarSeries[];
  label: string;
  domain?: [number, number];
  /** Bucket width in ms (one week by default). */
  bucketMs?: number;
  height?: number;
}

const W = 340;
const PAD = { l: 40, r: 12, t: 12, b: 26 };

/** Grouped bars over time with a legend, hover tooltip and table view. Bars start at zero. */
export function BarChart({
  rows,
  series,
  label,
  domain,
  bucketMs = 7 * 86400000,
  height = 170,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (!rows.length) return <p className="empty">還沒有資料。</p>;
  const H = height;
  const x0 = domain?.[0] ?? Math.min(...rows.map((r) => r.x));
  const x1 = Math.max(domain?.[1] ?? 0, Math.max(...rows.map((r) => r.x)) + bucketMs);
  const maxY = Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.key] ?? 0)));
  const step = 10 ** Math.floor(Math.log10(maxY));
  const top = Math.ceil(maxY / step) * step;
  const sx = (x: number) => PAD.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => PAD.t + (1 - y / top) * (H - PAD.t - PAD.b);
  const bw = Math.max(3, (sx(x0 + bucketMs) - sx(x0)) * 0.8);
  const each = bw / series.length;
  const fmt = (ms: number) => {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const hr = hover !== null ? rows[hover] : null;
  return (
    <div className="stack">
      {series.length > 1 ? (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key} style={{ ['--dot' as string]: `var(--series-${s.color})` }}>
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
      <div style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart"
          role="img"
          aria-label={label}
          onPointerLeave={() => setHover(null)}
        >
          {[0, top / 2, top].map((t) => (
            <g key={t}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={sy(t)}
                y2={sy(t)}
                className="axis"
                opacity={0.6}
              />
              <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          <text x={PAD.l} y={H - 6}>
            {fmt(x0)}
          </text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end">
            {fmt(x1)}
          </text>
          {rows.map((r, i) => (
            <g key={r.x} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
              <rect
                x={sx(r.x)}
                y={PAD.t}
                width={bw + 2}
                height={H - PAD.t - PAD.b}
                fill="transparent"
              />
              {series.map((s, j) => {
                const v = r[s.key] ?? 0;
                const y = sy(v);
                const h = Math.max(0, sy(0) - y);
                return h > 0 ? (
                  <path
                    key={s.key}
                    d={`M ${sx(r.x) + j * each + 1} ${sy(0)} V ${y + Math.min(4, h)} q 0 -4 4 -4 h ${Math.max(0, each - 10)} q 4 0 4 4 V ${sy(0)} Z`}
                    fill={`var(--series-${s.color})`}
                    opacity={hover === null || hover === i ? 1 : 0.5}
                  />
                ) : null;
              })}
            </g>
          ))}
        </svg>
        {hr ? (
          <div
            className="chart-tip"
            style={{
              left: `${(sx(hr.x) / W) * 100}%`,
              transform: `translateX(${sx(hr.x) > W / 2 ? '-105%' : '5%'})`,
            }}
          >
            <strong>{new Date(hr.x).toLocaleDateString('zh-TW')} 起一週</strong>
            {series.map((s) => (
              <div key={s.key}>
                {s.label}：{hr[s.key] ?? 0}
              </div>
            ))}
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
                <th>週</th>
                {series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.x}>
                  <td>{new Date(r.x).toLocaleDateString('zh-TW')}</td>
                  {series.map((s) => (
                    <td key={s.key}>{r[s.key] ?? 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
