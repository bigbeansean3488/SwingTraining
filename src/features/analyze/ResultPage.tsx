import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ENGINE_VERSION } from '../../analysis';
import {
  compareWithHistory,
  compareWithReference,
  positionInRange,
  type ReferenceReport,
} from '../../analysis/feedback';
import { metricFigures, type FigureSet } from '../../analysis/figures';
import type { EventTimes, PoseSequence } from '../../analysis/types';
import { unpackKeypoints } from '../../lib/compress';
import { deleteBlob, deleteRow, getBlob, updateRow } from '../../lib/db';
import { downloadText } from '../../lib/download';
import { useRow, useRows } from '../../lib/hooks';
import { navigate } from '../../lib/router';
import type { MotionAnalysis } from '../../lib/types';
import { loadVideoElement } from '../../pose/extract';
import { Badge, Button, Card, LinkButton, Notice, Page } from '../../ui/components';
import { literatureFor } from './literature';
import {
  DISCLAIMER,
  EVENT_LABELS,
  FAILURE_TEXT,
  KIND_LABEL,
  METRIC_GROUPS,
  WARNING_TEXT,
  formatMetric,
  infoFor,
  rangeText,
  refText,
  stabilityText,
} from './metricInfo';
import {
  LiteratureBlock,
  MetricFigureView,
  PhaseBar,
  RangeBar,
  TorsoIllustration,
} from './MetricViews';
import { OverlayPlayer } from './OverlayPlayer';
import { recompute, sessionVideos } from './run';

export function ResultPage({ id }: { id: string }) {
  const row = useRow('motion_analyses', id);
  const player = useRow('profiles', row?.player_id);
  const [seq, setSeq] = useState<PoseSequence | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const history = useRows(
    'motion_analyses',
    (r) =>
      !!row &&
      r.id !== row.id &&
      r.player_id === row.player_id &&
      r.kind === row.kind &&
      r.quality.ok &&
      r.engine_version.split('.')[0] === row.engine_version.split('.')[0] &&
      r.recorded_at <= row.recorded_at,
    [row?.id, row?.player_id, row?.kind, row?.recorded_at, row?.engine_version],
  );

  // Own analyses marked as good (any date), excluding this one.
  const refRows = useRows(
    'motion_analyses',
    (r) =>
      !!row &&
      r.id !== row.id &&
      r.player_id === row.player_id &&
      r.kind === row.kind &&
      r.quality.ok &&
      !!r.marked_good &&
      r.engine_version.split('.')[0] === row.engine_version.split('.')[0],
    [row?.id, row?.player_id, row?.kind, row?.engine_version],
  );
  const keyframeUrls = useKeyframeUrls(row?.keyframes);

  const keypoints = row?.keypoints;
  useEffect(() => {
    if (!keypoints) return;
    let alive = true;
    unpackKeypoints(keypoints).then((s) => alive && setSeq(s));
    return () => {
      alive = false;
    };
  }, [keypoints]);

  const videoKey = row?.video_blob_key;
  useEffect(() => {
    const s = sessionVideos.get(id);
    if (s) {
      setVideoUrl(s);
      return;
    }
    if (!videoKey) return;
    let url: string | null = null;
    getBlob(videoKey).then((b) => {
      if (b) {
        url = URL.createObjectURL(b);
        setVideoUrl(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, videoKey]);

  const feedback = useMemo(() => {
    if (!row || !history || !row.quality.ok) return null;
    const sorted = [...history].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
    return compareWithHistory(
      row.metrics,
      sorted.map((h) => h.metrics),
    );
  }, [row, history]);

  const references = useMemo(() => {
    if (!row || !refRows || !row.quality.ok) return null;
    return compareWithReference(
      row.metrics,
      refRows.map((r) => r.metrics),
    );
  }, [row, refRows]);

  const figures = useMemo<FigureSet | null>(() => {
    if (!seq || !row || !row.quality.ok) return null;
    return metricFigures(row.kind, seq, row.events, row.capture.timeScale || 1);
  }, [seq, row]);

  if (row === undefined)
    return (
      <Page title="分析結果" back="/analyze">
        <p className="empty">載入中…</p>
      </Page>
    );
  if (row === null)
    return (
      <Page title="分析結果" back="/analyze">
        <p className="empty">找不到這筆分析。</p>
      </Page>
    );

  const labels = EVENT_LABELS[row.kind];
  const outdated = row.engine_version !== ENGINE_VERSION;

  async function mark(event: string, t: number) {
    if (!row || !seq) return;
    setBusy(true);
    const manual: EventTimes = { ...(row.manual_events ?? {}), [event]: t };
    try {
      const video = videoUrl ? await loadVideoElement(videoUrl) : undefined;
      await recompute(row, seq, manual, video);
      setMsg(`已把「${labels[event]}」設為 ${t.toFixed(3)} 秒並重新計算。`);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!row || !seq) return;
    setBusy(true);
    try {
      const video = videoUrl ? await loadVideoElement(videoUrl) : undefined;
      await recompute(row, seq, null, video);
      setMsg('已用目前的分析引擎重新計算。');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!row || !confirm('確定刪除這筆分析？')) return;
    for (const k of row.keyframes) if (k.blob_key) await deleteBlob(k.blob_key);
    if (row.video_blob_key) await deleteBlob(row.video_blob_key);
    await deleteRow('motion_analyses', row.id);
    navigate('/analyze', { replace: true });
  }

  function exportJson() {
    if (!row) return;
    const { video_blob_key: _v, ...rest } = row;
    downloadText(
      `${row.kind}-${row.recorded_at.slice(0, 10)}-${row.id.slice(0, 8)}.json`,
      JSON.stringify({ ...rest, keypoints_decoded: seq }, null, 1),
      'application/json',
    );
  }

  return (
    <Page title={`${KIND_LABEL[row.kind]}分析`} back="/analyze">
      <Card>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="list-title">{player?.display_name ?? '—'}</div>
            <div className="muted small">{new Date(row.recorded_at).toLocaleString('zh-TW')}</div>
          </div>
          {row.quality.ok ? (
            <Badge kind="ok">追蹤良好</Badge>
          ) : (
            <Badge kind="error">無法分析</Badge>
          )}
        </div>
        {row.quality.ok ? (
          <Button
            variant="secondary"
            className="good-toggle"
            aria-pressed={!!row.marked_good}
            style={{ marginTop: 10, width: '100%' }}
            onClick={() => updateRow('motion_analyses', row.id, { marked_good: !row.marked_good })}
          >
            {row.marked_good ? '★ 已標記為好的動作（點一下取消）' : '☆ 標記為好的動作'}
          </Button>
        ) : null}
        <div className="grid-2 small mono" style={{ marginTop: 10 }}>
          <span>實際幀率：{row.quality.fps.toFixed(1)} fps</span>
          <span>追蹤成功：{Math.round(row.quality.validFraction * 100)}%</span>
          <span>平均信心值：{row.quality.meanConfidence.toFixed(2)}</span>
          <span>
            分析 {row.capture.frames} 幀・{(row.capture.processingMs / 1000).toFixed(1)} 秒
          </span>
        </div>
      </Card>

      {row.failure ? (
        <Notice kind="error">
          <strong>無法可靠分析這次動作，請重拍。</strong>
          <br />
          {FAILURE_TEXT[row.failure] ?? row.failure}
        </Notice>
      ) : null}
      {row.quality.warnings.map((w) => (
        <Notice key={w} kind="warn">
          {WARNING_TEXT[w] ?? w}
        </Notice>
      ))}
      {outdated ? (
        <Notice kind="info">
          這筆結果是用分析引擎 v{row.engine_version} 算的（目前 v{ENGINE_VERSION}
          ），數值可能無法直接比較。
          <div style={{ marginTop: 8 }}>
            <Button variant="secondary" className="btn-sm" onClick={reset} disabled={busy || !seq}>
              用目前引擎重新計算
            </Button>
          </div>
        </Notice>
      ) : null}
      {msg ? <Notice kind="ok">{msg}</Notice> : null}

      {row.quality.ok ? (
        <SummaryCard row={row} references={references} refCount={refRows?.length ?? 0} />
      ) : null}

      <Card title="骨架疊圖">
        {seq ? (
          <OverlayPlayer
            seq={seq}
            videoUrl={videoUrl}
            events={row.events}
            eventLabels={labels}
            onMarkEvent={busy ? undefined : mark}
          />
        ) : (
          <p className="empty">載入骨架中…</p>
        )}
        {!videoUrl ? <p className="small muted">沒有保留原始影片，只顯示骨架。</p> : null}
        {row.manual_events ? (
          <div className="row small" style={{ marginTop: 8 }}>
            <span className="muted">
              已手動修正：
              {Object.keys(row.manual_events)
                .map((k) => labels[k])
                .join('、')}
            </span>
            <Button variant="ghost" className="btn-sm" onClick={reset} disabled={busy}>
              還原自動偵測
            </Button>
          </div>
        ) : null}
      </Card>

      {row.quality.ok ? (
        <Card title="動作指標">
          <p className="small muted" style={{ marginTop: 0 }}>
            {DISCLAIMER}
          </p>
          <HowToRead />
          {feedback && !feedback.enoughHistory ? (
            <p className="small muted">
              累積 3 次以上的分析後，每個指標會顯示這次落在你自己範圍的哪裡。
            </p>
          ) : null}
          <MetricGroups
            row={row}
            history={history ?? []}
            refRows={refRows ?? []}
            feedback={feedback}
            references={references}
            figures={figures}
            seq={seq}
            keyframeUrls={keyframeUrls}
          />
        </Card>
      ) : null}

      <Keyframes urls={keyframeUrls} labels={labels} />

      <Card title="資料">
        <div className="stack">
          <LinkButton to={`/analyze/compare?a=${row.id}`} variant="secondary">
            與另一次分析並排比較
          </LinkButton>
          {refRows?.length ? (
            <LinkButton
              to={`/analyze/compare?a=${row.id}&b=${latest(refRows).id}`}
              variant="secondary"
            >
              與最近一次好的動作並排比較
            </LinkButton>
          ) : null}
          <Button variant="secondary" onClick={exportJson} disabled={!seq}>
            匯出 JSON
          </Button>
          <Button variant="danger" onClick={remove}>
            刪除這筆分析
          </Button>
          <p className="small muted" style={{ margin: 0 }}>
            模型：{row.model_version}・分析引擎 v{row.engine_version}・擷取方式：
            {row.capture.method === 'webcodecs' ? 'WebCodecs' : '逐格跳轉'}・{row.capture.delegate}
            {row.capture.timeScale !== 1 ? `・時間倍率 ${row.capture.timeScale.toFixed(4)}` : ''}
          </p>
        </div>
      </Card>
    </Page>
  );
}

function latest(rows: MotionAnalysis[]): MotionAnalysis {
  return [...rows].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]!;
}

/** The few differences from the athlete's own "good" analyses, largest first. */
function SummaryCard({
  row,
  references,
  refCount,
}: {
  row: MotionAnalysis;
  references: ReferenceReport | null;
  refCount: number;
}) {
  if (!refCount || !references) {
    return (
      <Card title="重點摘要">
        <p style={{ margin: 0 }}>
          還沒有標記「好的動作」。當你或教練覺得某一次動作不錯時，在那次分析按「☆
          標記為好的動作」，之後每次分析都會列出跟它差最多的地方。
        </p>
        {row.marked_good ? (
          <p className="small muted">這一次已標記；再標記其他次分析後，就能互相比較。</p>
        ) : null}
      </Card>
    );
  }
  const visible = references.metrics.filter((m) => !infoFor(row.kind, m.key)?.hidden);
  const diffs = visible
    .filter((m) => m.trend !== 'similar')
    .sort((a, b) => b.size - a.size)
    .slice(0, 3);
  return (
    <Card title="重點摘要">
      <p style={{ margin: 0 }}>
        跟你標記為好的 {refCount} 次動作相比
        {diffs.length ? '，差最多的地方：' : '，這次各項都很接近。'}
      </p>
      {diffs.length ? (
        <ol className="summary-list">
          {diffs.map((d) => {
            const i = infoFor(row.kind, d.key);
            const unit = row.metrics[d.key]!.unit;
            return (
              <li key={d.key}>
                <strong>{i?.label ?? d.key}</strong>：{refText(i, d.trend)}
                <div className="small muted">
                  這次 {formatMetric({ value: d.value, unit })}・好的動作平均{' '}
                  {formatMetric({ value: d.refMean, unit })}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      <p className="small muted" style={{ marginBottom: 0 }}>
        比較的對象是你自己的好動作，不是標準答案；「不一樣」不代表「比較差」。要怎麼調整，請跟教練討論。
      </p>
    </Card>
  );
}

function HowToRead() {
  return (
    <details className="disclosure">
      <summary>怎麼看這些數字？</summary>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'nowrap' }}>
        <TorsoIllustration />
        <div className="small">
          <p style={{ marginTop: 0 }}>
            <strong>距離的單位是「軀幹長」</strong>
            ：肩膀中心到骨盆中心的長度（圖中黃色那一段）。用自己的身體當尺，拍攝距離遠近不會影響數字。例如跨步
            1.2 軀幹長，就是跨出去的距離是軀幹的 1.2 倍。
          </p>
          <p>
            <strong>角度</strong>：180° 是完全打直，數字越小彎得越多。
          </p>
          <p style={{ marginBottom: 0 }}>
            每個指標下面的橫條：<strong>藍點</strong>是這次，灰色區塊是你之前的範圍，
            <strong>綠色菱形</strong>
            是你標記為好的動作。點「看這個數字量的是哪裡」可以看到畫在畫面上的位置。
          </p>
        </div>
      </div>
      <p className="small" style={{ marginBottom: 0 }}>
        <a href="#/analyze/metrics">所有指標的說明與參考文獻 ›</a>
      </p>
    </details>
  );
}

const PHASE_ORDER: Record<MotionAnalysis['kind'], string[]> = {
  batting: ['load', 'plant', 'contact', 'finish'],
  pitching: ['liftTop', 'plant', 'release', 'finish'],
};

function MetricGroups({
  row,
  history,
  refRows,
  feedback,
  references,
  figures,
  seq,
  keyframeUrls,
}: {
  row: MotionAnalysis;
  history: MotionAnalysis[];
  refRows: MotionAnalysis[];
  feedback: ReturnType<typeof compareWithHistory> | null;
  references: ReferenceReport | null;
  figures: FigureSet | null;
  seq: PoseSequence | null;
  keyframeUrls: Record<string, string>;
}) {
  const past = [...history].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).slice(-20);
  const card = (k: string) => {
    const m = row.metrics[k];
    if (!m) return null;
    const figure = figures?.figures[k];
    return (
      <MetricCard
        key={k}
        kind={row.kind}
        metricKey={k}
        value={m.value}
        unit={m.unit}
        confidence={m.confidence}
        experimental={!!m.experimental}
        past={past.map((r) => usable(k, r.metrics[k]?.value)).filter(isFiniteNum)}
        refs={refRows.map((r) => usable(k, r.metrics[k]?.value)).filter(isFiniteNum)}
        refDiff={references?.metrics.find((x) => x.key === k)}
        stability={feedback?.stability[k]}
        figure={
          figure && seq && figures ? (
            <MetricFigureView
              seq={seq}
              figure={figure}
              torso={figures.torso}
              imageUrl={keyframeUrls[figure.event]}
              valueText={formatMetric(m)}
            />
          ) : null
        }
      />
    );
  };
  return (
    <div>
      {METRIC_GROUPS[row.kind].map((g) => {
        const primary = g.primary.filter((k) => row.metrics[k]);
        const more = g.more.filter((k) => row.metrics[k]);
        if (!primary.length && !more.length) return null;
        return (
          <section key={g.id} className="metric-group">
            <h3>{g.title}</h3>
            <p className="metric-group-about">{g.about}</p>
            {g.id === 'rhythm' ? (
              <PhaseBar
                events={row.events}
                order={PHASE_ORDER[row.kind]}
                labels={EVENT_LABELS[row.kind]}
                timeScale={row.capture.timeScale || 1}
              />
            ) : null}
            {primary.map(card)}
            {more.length ? (
              <details className="disclosure">
                <summary>其他 {more.length} 項指標</summary>
                {more.map(card)}
              </details>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Engine 1.0.x could store a negative stride (wrong foot or direction); such
 * values are left out of comparisons until that analysis is recomputed.
 */
function usable(key: string, v: number | undefined): number | undefined {
  return key === 'stride_length' && typeof v === 'number' && v < 0 ? undefined : v;
}

function isFiniteNum(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function MetricCard({
  kind,
  metricKey,
  value,
  unit,
  confidence,
  experimental,
  past,
  refs,
  refDiff,
  stability,
  figure,
}: {
  kind: MotionAnalysis['kind'];
  metricKey: string;
  value: number;
  unit: string;
  confidence: number;
  experimental: boolean;
  past: number[];
  refs: number[];
  refDiff?: ReferenceReport['metrics'][number];
  stability?: ReturnType<typeof compareWithHistory>['stability'][string];
  figure: ReactNode;
}) {
  const info = infoFor(kind, metricKey);
  const range = positionInRange(value, past);
  const lit = literatureFor(kind, metricKey);
  const st = stability ? stabilityText(stability) : null;
  return (
    <div className="metric">
      <div className="metric-head">
        <span className="metric-name">
          {info?.label ?? metricKey} {experimental ? <Badge kind="warn">實驗性</Badge> : null}
        </span>
        <span className="metric-value">{formatMetric({ value, unit })}</span>
      </div>
      {info ? <div className="metric-what">{info.what}</div> : null}
      {range || refDiff || st ? (
        <div className="metric-compare">
          {range ? <span>・{rangeText(info, range)}</span> : null}
          {refDiff ? (
            <span>
              ・{refText(info, refDiff.trend)}（好的動作平均{' '}
              {formatMetric({ value: refDiff.refMean, unit })}）
            </span>
          ) : null}
          {st ? <span>・{st}</span> : null}
        </div>
      ) : null}
      {confidence < 0.6 ? (
        <p className="small" style={{ margin: '4px 0 0', color: 'var(--warn)' }}>
          這次這個部位追蹤得不太清楚（信心值 {confidence.toFixed(2)}），數字僅供參考。
        </p>
      ) : null}
      <RangeBar value={value} past={past} refs={refs} unit={unit} info={info} />
      <details>
        <summary>{figure ? '看這個數字量的是哪裡' : '看說明'}</summary>
        {figure}
        {info ? (
          <dl className="explain">
            <dt>量什麼</dt>
            <dd>{info.what}</dd>
            <dt>為什麼要看</dt>
            <dd>{info.why}</dd>
            <dt>量不準的地方</dt>
            <dd>{info.limit}</dd>
          </dl>
        ) : null}
        {lit.length ? <LiteratureBlock notes={lit} /> : null}
      </details>
    </div>
  );
}

/** Object URLs (local) or signed URLs (cloud) of the keyframe images, by event. */
function useKeyframeUrls(keyframes: MotionAnalysis['keyframes'] | undefined) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const made = useRef<string[]>([]);
  useEffect(() => {
    if (!keyframes) return;
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const k of keyframes) {
        const b = k.blob_key ? await getBlob(k.blob_key) : undefined;
        if (b) out[k.event] = URL.createObjectURL(b);
        else if (k.path) {
          const { keyframeUrl } = await import('../../lib/storage');
          const u = await keyframeUrl(k.path);
          if (u) out[k.event] = u;
        }
      }
      if (alive) {
        made.current.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u));
        made.current = Object.values(out);
        setUrls(out);
      } else {
        Object.values(out).forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u));
      }
    })();
    return () => {
      alive = false;
    };
  }, [keyframes]);
  useEffect(
    () => () => made.current.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)),
    [],
  );
  return urls;
}

function Keyframes({
  urls,
  labels,
}: {
  urls: Record<string, string>;
  labels: Record<string, string>;
}) {
  const order = Object.keys(labels).filter((e) => urls[e]);
  if (!order.length) return null;
  return (
    <Card title="關鍵幀">
      <div className="keyframes">
        {order.map((e) => (
          <figure key={e}>
            <img src={urls[e]} alt={labels[e] ?? e} loading="lazy" />
            <figcaption>{labels[e] ?? e}</figcaption>
          </figure>
        ))}
      </div>
    </Card>
  );
}
