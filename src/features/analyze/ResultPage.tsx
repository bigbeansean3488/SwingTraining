import { useEffect, useMemo, useRef, useState } from 'react';
import { ENGINE_VERSION } from '../../analysis';
import { compareWithHistory } from '../../analysis/feedback';
import type { EventTimes, PoseSequence } from '../../analysis/types';
import { unpackKeypoints } from '../../lib/compress';
import { deleteBlob, deleteRow, getBlob } from '../../lib/db';
import { downloadText } from '../../lib/download';
import { useRow, useRows } from '../../lib/hooks';
import { navigate } from '../../lib/router';
import type { MotionAnalysis } from '../../lib/types';
import { loadVideoElement } from '../../pose/extract';
import { Badge, Button, Card, LinkButton, Notice, Page } from '../../ui/components';
import {
  DISCLAIMER,
  EVENT_LABELS,
  FAILURE_TEXT,
  KIND_LABEL,
  METRIC_INFO,
  METRIC_ORDER,
  WARNING_TEXT,
  formatMetric,
  stabilityText,
  trendText,
} from './metricInfo';
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
          {feedback && !feedback.enoughHistory ? (
            <p className="small muted">累積 3 次以上的分析後，會顯示跟你自己平均的比較。</p>
          ) : null}
          <MetricList row={row} feedback={feedback} />
        </Card>
      ) : null}

      <Keyframes row={row} labels={labels} />

      <Card title="資料">
        <div className="stack">
          <LinkButton to={`/analyze/compare?a=${row.id}`} variant="secondary">
            與另一次分析並排比較
          </LinkButton>
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

function MetricList({
  row,
  feedback,
}: {
  row: MotionAnalysis;
  feedback: ReturnType<typeof compareWithHistory> | null;
}) {
  const order = METRIC_ORDER[row.kind];
  const keys = [
    ...order.filter((k) => row.metrics[k]),
    ...Object.keys(row.metrics).filter((k) => !order.includes(k)),
  ];
  return (
    <div>
      {keys.map((k) => {
        const m = row.metrics[k]!;
        const info = METRIC_INFO[k];
        const fb = feedback?.metrics.find((x) => x.key === k);
        const st = feedback?.stability[k];
        return (
          <div key={k} className="metric">
            <div className="metric-head">
              <span className="metric-name">
                {info?.label ?? k} {m.experimental ? <Badge kind="warn">實驗性</Badge> : null}
              </span>
              <span className="metric-value">{formatMetric(m)}</span>
            </div>
            <div className="metric-desc">{info?.desc}</div>
            <div className="small row" style={{ marginTop: 4, gap: 6 }}>
              {m.confidence < 0.6 ? (
                <Badge kind="warn">信心值 {m.confidence.toFixed(2)}</Badge>
              ) : (
                <Badge>信心值 {m.confidence.toFixed(2)}</Badge>
              )}
              {fb ? (
                <Badge kind={fb.trend === 'similar' ? 'muted' : 'warn'}>
                  {trendText(info, fb.trend)}（平均{' '}
                  {formatMetric({ value: fb.baselineMean, unit: m.unit })}）
                </Badge>
              ) : null}
              {st && stabilityText(st) ? <Badge>{stabilityText(st)}</Badge> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Keyframes({ row, labels }: { row: MotionAnalysis; labels: Record<string, string> }) {
  const [urls, setUrls] = useState<{ event: string; url: string }[]>([]);
  const made = useRef<string[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: { event: string; url: string }[] = [];
      for (const k of row.keyframes) {
        const b = k.blob_key ? await getBlob(k.blob_key) : undefined;
        if (b) out.push({ event: k.event, url: URL.createObjectURL(b) });
        else if (k.path) {
          const { keyframeUrl } = await import('../../lib/storage');
          const u = await keyframeUrl(k.path);
          if (u) out.push({ event: k.event, url: u });
        }
      }
      if (alive) {
        made.current.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u));
        made.current = out.map((o) => o.url);
        setUrls(out);
      }
    })();
    return () => {
      alive = false;
    };
  }, [row.keyframes]);
  if (!urls.length) return null;
  return (
    <Card title="關鍵幀">
      <div className="keyframes">
        {urls.map((u) => (
          <figure key={u.event}>
            <img src={u.url} alt={labels[u.event] ?? u.event} loading="lazy" />
            <figcaption>{labels[u.event] ?? u.event}</figcaption>
          </figure>
        ))}
      </div>
    </Card>
  );
}
