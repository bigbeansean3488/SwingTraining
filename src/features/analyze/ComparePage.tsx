import { useEffect, useMemo, useRef, useState } from 'react';
import type { PoseSequence } from '../../analysis/types';
import { unpackKeypoints } from '../../lib/compress';
import { getBlob } from '../../lib/db';
import { useRows } from '../../lib/hooks';
import { navigate } from '../../lib/router';
import type { MotionAnalysis } from '../../lib/types';
import { Card, Empty, Field, Notice, Page } from '../../ui/components';
import { EVENT_LABELS, KIND_LABEL, METRIC_INFO, METRIC_ORDER, formatMetric } from './metricInfo';
import { OverlayPlayer } from './OverlayPlayer';
import { sessionVideos } from './run';

function useSeqAndVideo(row: MotionAnalysis | undefined) {
  const [seq, setSeq] = useState<PoseSequence | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setSeq(null);
    setUrl(null);
    if (!row) return;
    let alive = true;
    let made: string | null = null;
    unpackKeypoints(row.keypoints).then((s) => alive && setSeq(s));
    const s = sessionVideos.get(row.id);
    if (s) setUrl(s);
    else if (row.video_blob_key)
      getBlob(row.video_blob_key).then((b) => {
        if (b && alive) setUrl((made = URL.createObjectURL(b)));
      });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [row]);
  return { seq, url };
}

export function ComparePage({ a, b }: { a: string | null; b: string | null }) {
  const rows = useRows('motion_analyses', (r) => r.quality.ok);
  const profiles = useRows('profiles');
  const name = (id: string) => profiles?.find((p) => p.id === id)?.display_name ?? '—';
  const sorted = useMemo(
    () => [...(rows ?? [])].sort((x, y) => y.recorded_at.localeCompare(x.recorded_at)),
    [rows],
  );
  const A = sorted.find((r) => r.id === a);
  const B = sorted.find((r) => r.id === b);
  const kind = A?.kind ?? B?.kind ?? 'batting';
  const events = Object.keys(EVENT_LABELS[kind]).filter((e) => e !== 'stance');
  const [anchor, setAnchor] = useState(kind === 'batting' ? 'plant' : 'plant');
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(false);
  const sa = useSeqAndVideo(A);
  const sb = useSeqAndVideo(B);
  const raf = useRef(0);

  // Window around the anchor event that both clips cover.
  const range = useMemo(() => {
    if (!A || !B || !sa.seq || !sb.seq) return null;
    const ea = A.events[anchor];
    const eb = B.events[anchor];
    if (ea === undefined || eb === undefined) return null;
    const first = (s: PoseSequence) => s.frames[0]!.t;
    const last = (s: PoseSequence) => s.frames[s.frames.length - 1]!.t;
    // Offsets are in real seconds; convert media time with each clip's time scale.
    const ka = A.capture.timeScale || 1;
    const kb = B.capture.timeScale || 1;
    const lo = Math.max((first(sa.seq) - ea) * ka, (first(sb.seq) - eb) * kb);
    const hi = Math.min((last(sa.seq) - ea) * ka, (last(sb.seq) - eb) * kb);
    return { lo, hi, ea, eb, ka, kb };
  }, [A, B, sa.seq, sb.seq, anchor]);

  useEffect(() => {
    if (!playing || !range) return;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = ((now - prev) / 1000) * 0.25;
      prev = now;
      setOffset((o) => {
        const n = o + dt;
        if (n >= range.hi) {
          setPlaying(false);
          return range.hi;
        }
        return n;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, range]);

  const pick = (which: 'a' | 'b', id: string) => {
    const q = new URLSearchParams({ a: a ?? '', b: b ?? '' });
    q.set(which, id);
    navigate(`/analyze/compare?${q.toString()}`, { replace: true });
  };

  const option = (r: MotionAnalysis) => (
    <option key={r.id} value={r.id}>
      {KIND_LABEL[r.kind]}・{name(r.player_id)}・
      {new Date(r.recorded_at).toLocaleDateString('zh-TW')}
    </option>
  );

  return (
    <Page title="並排比較" back="/analyze">
      {!sorted.length ? (
        <Empty>需要至少兩筆通過品質檢查的分析。</Empty>
      ) : (
        <>
          <Card>
            <div className="stack">
              <Field label="A">
                <select value={a ?? ''} onChange={(e) => pick('a', e.target.value)}>
                  <option value="">選擇分析</option>
                  {sorted.map(option)}
                </select>
              </Field>
              <Field label="B">
                <select value={b ?? ''} onChange={(e) => pick('b', e.target.value)}>
                  <option value="">選擇分析</option>
                  {sorted.filter((r) => !A || r.kind === A.kind).map(option)}
                </select>
              </Field>
              <Field label="對齊事件">
                <div className="chips">
                  {events.map((e) => (
                    <button
                      key={e}
                      className={`btn btn-secondary btn-sm ${anchor === e ? 'selected' : ''}`}
                      onClick={() => {
                        setAnchor(e);
                        setOffset(0);
                      }}
                    >
                      {EVENT_LABELS[kind][e]}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Card>

          {A && B && A.kind !== B.kind ? (
            <Notice kind="warn">兩筆分析類型不同，無法對齊。</Notice>
          ) : null}

          {A && B && range && sa.seq && sb.seq ? (
            <>
              <Card>
                <div className="stack">
                  <input
                    type="range"
                    min={range.lo}
                    max={range.hi}
                    step={0.001}
                    value={offset}
                    onChange={(e) => {
                      setPlaying(false);
                      setOffset(Number(e.target.value));
                    }}
                    aria-label="相對事件的時間"
                  />
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="mono">
                      {EVENT_LABELS[kind][anchor]} {offset >= 0 ? '+' : ''}
                      {Math.round(offset * 1000)} ms
                    </span>
                    <div className="row">
                      <button className="btn btn-secondary btn-sm" onClick={() => setOffset(0)}>
                        回到事件
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setPlaying((p) => !p)}
                      >
                        {playing ? '暫停' : '0.25× 播放'}
                      </button>
                    </div>
                  </div>
                </div>
              </Card>
              <div className="grid-2">
                <div>
                  <div className="small center list-title">A・{name(A.player_id)}</div>
                  <OverlayPlayer
                    compact
                    seq={sa.seq}
                    videoUrl={sa.url}
                    events={A.events}
                    eventLabels={EVENT_LABELS[kind]}
                    syncTime={range.ea + offset / range.ka}
                  />
                </div>
                <div>
                  <div className="small center list-title">B・{name(B.player_id)}</div>
                  <OverlayPlayer
                    compact
                    seq={sb.seq}
                    videoUrl={sb.url}
                    events={B.events}
                    eventLabels={EVENT_LABELS[kind]}
                    syncTime={range.eb + offset / range.kb}
                  />
                </div>
              </div>
              <Card title="指標對照">
                <div className="table-scroll">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>指標</th>
                        <th>A</th>
                        <th>B</th>
                        <th>B − A</th>
                      </tr>
                    </thead>
                    <tbody>
                      {METRIC_ORDER[kind]
                        .filter((k) => A.metrics[k] || B.metrics[k])
                        .map((k) => {
                          const ma = A.metrics[k];
                          const mb = B.metrics[k];
                          return (
                            <tr key={k}>
                              <td style={{ whiteSpace: 'normal' }}>{METRIC_INFO[k]?.label ?? k}</td>
                              <td>{ma ? formatMetric(ma) : '—'}</td>
                              <td>{mb ? formatMetric(mb) : '—'}</td>
                              <td>
                                {ma && mb
                                  ? formatMetric({ value: mb.value - ma.value, unit: ma.unit })
                                  : '—'}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <p className="small muted">
                  兩筆都是 2D 估計值；拍攝距離、角度不同時差異可能來自拍攝條件。
                </p>
              </Card>
            </>
          ) : null}
        </>
      )}
    </Page>
  );
}
