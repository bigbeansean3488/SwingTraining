import type { HitLocation } from '../../scoring/types';

/** Bases diamond with occupied bases filled, plus out lights. */
export function Diamond({ bases, outs }: { bases: boolean[]; outs: number }) {
  const base = (cx: number, cy: number, on: boolean, label: string) => (
    <rect
      x={cx - 11}
      y={cy - 11}
      width={22}
      height={22}
      transform={`rotate(45 ${cx} ${cy})`}
      fill={on ? 'var(--accent)' : 'var(--bg)'}
      stroke="var(--text)"
      strokeWidth={2}
      aria-label={`${label}${on ? '有人' : '無人'}`}
    />
  );
  return (
    <svg viewBox="0 0 120 90" width="120" height="90" role="img" aria-label={`${outs} 出局`}>
      {base(60, 18, bases[1]!, '二壘')}
      {base(96, 50, bases[0]!, '一壘')}
      {base(24, 50, bases[2]!, '三壘')}
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          cx={42 + i * 18}
          cy={80}
          r={6}
          fill={i < outs ? 'var(--warn)' : 'none'}
          stroke="var(--text)"
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

const W = 300;
const H = 260;
const HOME = { x: W / 2, y: H - 14 };
const R = 230;

/** Convert a normalized location to SVG coordinates (y = distance from home outward). */
function toXY(l: HitLocation) {
  return { x: l.x * W, y: HOME.y - l.y * (H - 20) };
}

export interface SprayDot {
  loc: HitLocation;
  color: string;
  label: string;
}

/** Baseball field outline. Tap to pick a location, or show dots as a spray chart. */
export function FieldDiagram({
  value,
  onPick,
  dots,
}: {
  value?: HitLocation | null;
  onPick?: (l: HitLocation) => void;
  dots?: SprayDot[];
}) {
  const a = (deg: number) => ({
    x: HOME.x + R * Math.cos((deg * Math.PI) / 180),
    y: HOME.y - R * Math.sin((deg * Math.PI) / 180),
  });
  const lf = a(135);
  const rf = a(45);
  const inf = 70;
  const b1 = { x: HOME.x + inf * Math.cos(Math.PI / 4), y: HOME.y - inf * Math.sin(Math.PI / 4) };
  const b3 = { x: HOME.x - inf * Math.cos(Math.PI / 4), y: b1.y };
  const b2 = { x: HOME.x, y: HOME.y - inf * Math.SQRT2 };
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="field-diagram"
      role={onPick ? 'button' : 'img'}
      aria-label={onPick ? '點選擊球落點' : '擊球落點圖'}
      onClick={(e) => {
        if (!onPick) return;
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * W;
        const y = ((e.clientY - rect.top) / rect.height) * H;
        onPick({
          x: Math.round((x / W) * 1000) / 1000,
          y: Math.round(((HOME.y - y) / (H - 20)) * 1000) / 1000,
        });
      }}
    >
      <path
        d={`M ${HOME.x} ${HOME.y} L ${lf.x} ${lf.y} A ${R} ${R} 0 0 1 ${rf.x} ${rf.y} Z`}
        fill="var(--ok-bg)"
        stroke="var(--line)"
        strokeWidth={2}
      />
      <path
        d={`M ${HOME.x} ${HOME.y} L ${b1.x} ${b1.y} L ${b2.x} ${b2.y} L ${b3.x} ${b3.y} Z`}
        fill="var(--warn-bg)"
        stroke="var(--line)"
        strokeWidth={2}
      />
      {[b1, b2, b3, HOME].map((b, i) => (
        <rect
          key={i}
          x={b.x - 4}
          y={b.y - 4}
          width={8}
          height={8}
          fill="var(--bg)"
          stroke="var(--text)"
          transform={`rotate(45 ${b.x} ${b.y})`}
        />
      ))}
      {(dots ?? []).map((d, i) => {
        const p = toXY(d.loc);
        return (
          <circle key={i} cx={p.x} cy={p.y} r={6} fill={d.color} stroke="var(--bg)" strokeWidth={2}>
            <title>{d.label}</title>
          </circle>
        );
      })}
      {value ? (
        <g>
          <circle
            cx={toXY(value).x}
            cy={toXY(value).y}
            r={9}
            fill="var(--accent)"
            stroke="var(--bg)"
            strokeWidth={3}
          />
        </g>
      ) : null}
    </svg>
  );
}
