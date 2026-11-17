// Compare one analysis with a reference motion (標竿動作): skeletons aligned by
// events and normalized by torso length around the pelvis, plus per-metric
// differences "you vs reference". No good/bad score (docs/DECISIONS.md D22).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildTimeWarp,
  comparability,
  diffMetrics,
  normalizeSequence,
  poseAt,
  poseBounds,
  warpTime,
  type Bounds,
  type NormPoint,
  type NormalizedSequence,
} from '../../analysis/reference';
import { SKELETON_EDGES } from '../../analysis/landmarks';
import type { MotionKind } from '../../analysis/types';
import { unpackKeypoints } from '../../lib/compress';
import { useRow, useRows } from '../../lib/hooks';
import { useReferenceEntries, type ReferenceEntry } from '../../lib/references';
import { navigate } from '../../lib/router';
import type { ArmAction, ArmSlot, MotionAnalysis } from '../../lib/types';
import { Badge, Button, Card, Empty, LinkButton, Notice, Page, Tabs } from '../../ui/components';
import { EVENT_LABELS, KIND_LABEL, METRIC_GROUPS, formatMetric, infoFor } from './metricInfo';
import {
  ARM_ACTION_LABEL,
  ARM_SLOT_LABEL,
  COMPARABILITY_TEXT,
  REFERENCE_DISCLAIMER,
  deltaText,
  styleLabels,
} from './referenceInfo';

const YOU_COLOR = '#5fa8ff';
const REF_COLOR = '#ffb020';
const ORDER: Record<MotionKind, string[]> = {
  batting: ['load', 'plant', 'contact', 'finish'],
  pitching: ['liftTop', 'plant', 'release', 'finish'],
};

function useNormalized(keypoints: string | undefined, forward: number | undefined) {
  const [ns, setNs] = useState<NormalizedSequence | null>(null);
  useEffect(() => {
    setNs(null);
    if (!keypoints) return;
    let alive = true;
    unpackKeypoints(keypoints)
      .then((seq) => alive && setNs(normalizeSequence(seq, forward ?? 1)))
      .catch(() => alive && setNs(null));
    return () => {
      alive = false;
    };
  }, [keypoints, forward]);
  return ns;
}

export function ReferenceComparePage({ a, r }: { a: string | null; r: string | null }) {
  const row = useRow('motion_analyses', a ?? undefined);
  const entries = useReferenceEntries(row?.kind);
  const profiles = useRows('profiles');
  const name = (pid: string | null) =>
    (pid && profiles?.find((p) => p.id === pid)?.display_name) || null;
  const [slot, setSlot] = useState<ArmSlot | null>(null);
  const [action, setAction] = useState<ArmAction | null>(null);
  const back = a ? `/analyze/${a}` : '/analyze';

  if (row === undefined || (row && entries === null))
    return (
      <Page title="與標竿對照" back={back}>
        <Empty>載入中…</Empty>
      </Page>
    );
  if (!row || !row.quality.ok)
    return (
      <Page title="與標竿對照" back={back}>
        <Empty>找不到可以對照的分析（需要通過品質檢查）。</Empty>
      </Page>
    );

  const all = (entries ?? []).filter((e) => e.kind === row.kind);
  const selected = all.find((e) => e.id === r) ?? null;
  const filtered = all.filter(
    (e) => (!slot || e.style?.arm_slot === slot) && (!action || e.style?.arm_action === action),
  );
  const pick = (id: string) =>
    navigate(`/analyze/reference-compare?a=${row.id}&r=${encodeURIComponent(id)}`, {
      replace: true,
    });

  return (
    <Page title="與標竿對照" back={back}>
      <Card title={`選擇${KIND_LABEL[row.kind]}標竿`}>
        {!all.length ? (
          <>
            <p style={{ marginTop: 0 }}>
              還沒有{KIND_LABEL[row.kind]}
              標竿。在教練或學長示範那次分析的結果頁，按「把這次設為標竿」。
            </p>
            <LinkButton to="/analyze/references" variant="secondary">
              標竿動作列表
            </LinkButton>
          </>
        ) : (
          <div className="stack">
            {row.kind === 'pitching' &&
            all.some((e) => e.style?.arm_slot || e.style?.arm_action) ? (
              <>
                <FilterChips
                  label="出手角度"
                  value={slot}
                  options={(Object.keys(ARM_SLOT_LABEL) as ArmSlot[]).map((k) => [
                    k,
                    ARM_SLOT_LABEL[k],
                  ])}
                  onChange={setSlot}
                />
                <FilterChips
                  label="引臂"
                  value={action}
                  options={(Object.keys(ARM_ACTION_LABEL) as ArmAction[]).map((k) => [
                    k,
                    ARM_ACTION_LABEL[k],
                  ])}
                  onChange={setAction}
                />
              </>
            ) : null}
            {!filtered.length ? <p className="small muted">沒有符合篩選的標竿。</p> : null}
            <div className="ref-options" role="radiogroup" aria-label="標竿">
              {filtered.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  role="radio"
                  aria-checked={e.id === selected?.id}
                  aria-label={e.label}
                  className={`ref-option ${e.id === selected?.id ? 'selected' : ''}`}
                  onClick={() => pick(e.id)}
                >
                  <span className="ref-option-title">{e.label}</span>
                  <span className="ref-option-sub">
                    {[
                      e.origin === 'builtin' ? (e.demo ? '測試用合成資料' : '內建') : '隊上',
                      name(e.player_id),
                      ...styleLabels(e.style),
                    ]
                      .filter(Boolean)
                      .join('・')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>
      {selected ? (
        <Comparison row={row} ref_={selected} refName={name(selected.player_id)} />
      ) : null}
    </Page>
  );
}

function FilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: [T, string][];
  onChange: (v: T | null) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="chips ref-chips" role="group" aria-label={label}>
        {[[null, '全部'] as [T | null, string], ...options].map(([k, text]) => (
          <button
            key={k ?? 'all'}
            type="button"
            className={`btn btn-secondary btn-sm ${value === k ? 'selected' : ''}`}
            aria-pressed={value === k}
            onClick={() => onChange(k)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Comparison({
  row,
  ref_,
  refName,
}: {
  row: MotionAnalysis;
  ref_: ReferenceEntry;
  refName: string | null;
}) {
  const kind = row.kind;
  const you = useNormalized(row.keypoints, row.forward);
  const ref = useNormalized(ref_.keypoints, ref_.forward);
  const userScale = row.capture?.timeScale || 1;
  const warp = useMemo(
    () =>
      buildTimeWarp(
        kind,
        { events: row.events, timeScale: userScale },
        { events: ref_.events, timeScale: ref_.time_scale || 1 },
      ),
    [kind, row.events, userScale, ref_.events, ref_.time_scale],
  );
  const warpT = useCallback((t: number) => warpTime(warp, t), [warp]);
  const issues = comparability(
    { engineVersion: row.engine_version, warnings: row.quality.warnings, forward: row.forward },
    { engineVersion: ref_.engine_version, warnings: ref_.quality.warnings, forward: ref_.forward },
    warp,
    kind,
  );
  const deltas = useMemo(
    () =>
      diffMetrics(
        row.metrics,
        ref_.metrics,
        METRIC_GROUPS[kind].flatMap((g) => [...g.primary, ...g.more]),
      ),
    [row.metrics, ref_.metrics, kind],
  );
  const shown = deltas.filter((d) => !infoFor(kind, d.key)?.hidden);
  const hidden = deltas.filter((d) => infoFor(kind, d.key)?.hidden);

  return (
    <>
      {issues.length ? (
        <Notice kind="warn">
          <strong>差異只能參考：</strong>
          <ul className="tight-list">
            {issues.map((i) => (
              <li key={i}>{COMPARABILITY_TEXT[i]}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <Card title="骨架對照">
        {you && ref ? (
          <SkeletonCompare
            kind={kind}
            you={you}
            ref_={ref}
            events={row.events}
            userScale={userScale}
            warpT={warpT}
          />
        ) : (
          <Empty>載入骨架中…</Empty>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          兩個骨架都以軀幹長縮放、骨盆對齊在同一點，動作方向統一朝右，所以身高、拍攝距離與左右投打不影響比較。時間以{' '}
          {warp.anchors.map((x) => EVENT_LABELS[kind][x.event]).join('、') || '開頭'}{' '}
          對齊，每一段依兩邊的長短拉伸。
        </p>
      </Card>
      <Card title="指標差異">
        {!shown.length ? (
          <Empty>兩邊沒有可以比較的指標。</Empty>
        ) : (
          <ul className="delta-list">
            {shown.map((d) => (
              <DeltaItem key={d.key} kind={kind} d={d} />
            ))}
          </ul>
        )}
        {hidden.length ? (
          <details className="disclosure">
            <summary>其他 {hidden.length} 項（較不可靠）</summary>
            <ul className="delta-list">
              {hidden.map((d) => (
                <DeltaItem key={d.key} kind={kind} d={d} />
              ))}
            </ul>
          </details>
        ) : null}
        <p className="small muted" style={{ marginBottom: 0 }}>
          {REFERENCE_DISCLAIMER}
        </p>
      </Card>
      <Card title="標竿來源">
        <p style={{ marginTop: 0 }}>
          <strong>{ref_.label}</strong>
          {refName ? `・${refName}` : ''}{' '}
          {ref_.origin === 'builtin' ? (
            <Badge kind={ref_.demo ? 'warn' : 'muted'}>{ref_.demo ? '測試用' : '內建'}</Badge>
          ) : null}
        </p>
        {ref_.source_note ? <p className="small">{ref_.source_note}</p> : null}
        {ref_.source ? (
          <p className="small">
            來源：
            {ref_.source.url ? (
              <a href={ref_.source.url} target="_blank" rel="noreferrer">
                {ref_.source.title}
              </a>
            ) : (
              ref_.source.title
            )}
            {ref_.source.author ? `・${ref_.source.author}` : ''}・授權：{ref_.source.license}
          </p>
        ) : null}
        <p className="small muted" style={{ marginBottom: 0 }}>
          模型：{ref_.model_version}・分析引擎 v{ref_.engine_version}（這次 v{row.engine_version}
          ）・
          {Math.round(ref_.quality.fps ?? ref_.fps)} fps
        </p>
      </Card>
    </>
  );
}

function DeltaItem({ kind, d }: { kind: MotionKind; d: ReturnType<typeof diffMetrics>[number] }) {
  const info = infoFor(kind, d.key);
  return (
    <li>
      <strong>{info?.label ?? d.key}</strong>：{deltaText(info, d)}
      <div className="small muted">
        你 {formatMetric({ value: d.you, unit: d.unit })}・標竿{' '}
        {formatMetric({ value: d.ref, unit: d.unit })}
      </div>
      {d.lowConfidence ? (
        <div className="small" style={{ color: 'var(--warn)' }}>
          有一邊這個部位追蹤得不太清楚，差異僅供參考。
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skeleton canvas

type Mode = 'overlay' | 'side';

function SkeletonCompare({
  kind,
  you,
  ref_,
  events,
  userScale,
  warpT,
}: {
  kind: MotionKind;
  you: NormalizedSequence;
  ref_: NormalizedSequence;
  events: Record<string, number>;
  userScale: number;
  warpT: (t: number) => number;
}) {
  const t0 = you.times[0] ?? 0;
  const t1 = you.times[you.times.length - 1] ?? 0;
  const order = ORDER[kind].filter((e) => events[e] !== undefined);
  const [t, setT] = useState(() => events[order[1] ?? order[0] ?? ''] ?? t0);
  const [mode, setMode] = useState<Mode>('overlay');
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bounds = useMemo(() => poseBounds([you, ref_]), [you, ref_]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    drawCompare(c, mode, poseAt(you, t), poseAt(ref_, warpT(t)), bounds);
  }, [t, mode, you, ref_, warpT, bounds]);

  useEffect(() => {
    if (!playing) return;
    let prev = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      // 0.25x real time; media time advances inversely to the slow-motion scale.
      const dt = (((now - prev) / 1000) * 0.25) / userScale;
      prev = now;
      setT((x) => {
        const n = x + dt;
        if (n >= t1) {
          setPlaying(false);
          return t1;
        }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, userScale, t1]);

  // Where we are relative to the nearest event (real milliseconds).
  let near = order[0];
  for (const e of order) if (Math.abs(events[e]! - t) < Math.abs(events[near!]! - t)) near = e;
  const offsetMs = near ? Math.round((t - events[near]!) * userScale * 1000) : 0;

  return (
    <div className="stack">
      <Tabs
        value={mode}
        onChange={setMode}
        options={[
          { value: 'overlay', label: '疊合' },
          { value: 'side', label: '並排' },
        ]}
      />
      <canvas
        ref={canvasRef}
        className="ref-canvas"
        role="img"
        aria-label={`你的骨架（藍）與標竿骨架（橘）${mode === 'overlay' ? '疊合' : '並排'}顯示`}
      />
      <div className="ref-legend small">
        <span>
          <i style={{ background: YOU_COLOR }} /> 你
        </span>
        <span>
          <i style={{ background: REF_COLOR }} /> 標竿
        </span>
        <span className="mono" style={{ marginLeft: 'auto' }}>
          {near ? `${EVENT_LABELS[kind][near]} ${offsetMs >= 0 ? '+' : ''}${offsetMs} ms` : ''}
        </span>
      </div>
      <div className="chips ref-chips" role="group" aria-label="跳到動作階段">
        {order.map((e) => (
          <button
            key={e}
            type="button"
            className={`btn btn-secondary btn-sm ${Math.abs(events[e]! - t) < 1e-6 ? 'selected' : ''}`}
            onClick={() => {
              setPlaying(false);
              setT(events[e]!);
            }}
          >
            {EVENT_LABELS[kind][e]}
          </button>
        ))}
      </div>
      <input
        type="range"
        min={t0}
        max={t1}
        step={0.001}
        value={t}
        onChange={(e) => {
          setPlaying(false);
          setT(Number(e.target.value));
        }}
        aria-label="動作時間（拖動）"
      />
      <Button
        variant="secondary"
        onClick={() => {
          if (!playing && t >= t1 - 1e-6) setT(t0);
          setPlaying((p) => !p);
        }}
      >
        {playing ? '暫停' : '0.25× 播放'}
      </Button>
    </div>
  );
}

const PAD = 0.25; // torso units around the figure

function drawCompare(
  c: HTMLCanvasElement,
  mode: Mode,
  you: NormPoint[] | null,
  ref: NormPoint[] | null,
  b: Bounds,
) {
  const bw = b.maxX - b.minX + 2 * PAD;
  const bh = b.maxY - b.minY + 2 * PAD;
  const panels = mode === 'side' ? 2 : 1;
  const W = 720;
  // Height from the figure's aspect ratio, capped so the canvas fits a phone screen.
  const H = Math.round(Math.min(900, Math.max(panels === 2 ? 520 : 360, (W / panels) * (bh / bw))));
  if (c.width !== W) c.width = W;
  if (c.height !== H) c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#0b0f17';
  ctx.fillRect(0, 0, W, H);
  const pw = W / panels;
  const s = Math.min(pw / bw, H / bh);
  const map = (panel: number) => (p: NormPoint) => ({
    x: panel * pw + (pw - bw * s) / 2 + (p.x - b.minX + PAD) * s,
    y: (H - bh * s) / 2 + (p.y - b.minY + PAD) * s,
  });
  const lw = Math.max(3, s * 0.05);
  const pelvisMark = (panel: number) => {
    const o = map(panel)({ x: 0, y: 0, v: 1 });
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panel * pw + 8, o.y);
    ctx.lineTo((panel + 1) * pw - 8, o.y);
    ctx.stroke();
  };
  if (mode === 'side') {
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.moveTo(pw, 0);
    ctx.lineTo(pw, H);
    ctx.stroke();
    pelvisMark(0);
    pelvisMark(1);
    drawPose(ctx, you, map(0), YOU_COLOR, lw);
    drawPose(ctx, ref, map(1), REF_COLOR, lw);
    label(ctx, '你', 16, 48, YOU_COLOR);
    label(ctx, '標竿', pw + 16, 48, REF_COLOR);
  } else {
    pelvisMark(0);
    drawPose(ctx, ref, map(0), REF_COLOR, lw * 1.6, 0.75);
    drawPose(ctx, you, map(0), YOU_COLOR, lw);
  }
  if (!you || !ref) label(ctx, '有一邊這時追蹤不到骨盆', 16, H - 20, '#ffffff');
}

function drawPose(
  ctx: CanvasRenderingContext2D,
  pose: NormPoint[] | null,
  map: (p: NormPoint) => { x: number; y: number },
  color: string,
  lw: number,
  alpha = 1,
) {
  if (!pose) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  for (const [i, j] of SKELETON_EDGES) {
    const p = pose[i];
    const q = pose[j];
    if (!p || !q || p.v < 0.3 || q.v < 0.3) continue;
    const a = map(p);
    const b2 = map(q);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.stroke();
  }
  const nose = pose[0];
  if (nose && nose.v >= 0.3) {
    const n = map(nose);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, lw * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  // The 720-px canvas is shown about 300 CSS px wide on a phone: keep text large.
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
