import { useEffect, useRef, useState } from 'react';
import type { MotionKind } from '../../analysis/types';
import { useRows } from '../../lib/hooks';
import { useMe } from '../../lib/identity';
import { navigate } from '../../lib/router';
import { useCurrentTeam } from '../../lib/team';
import { loadVideoElement, probeVideo, type VideoProbe } from '../../pose/extract';
import type { PoseModel } from '../../pose/mediapipe';
import { Button, Card, Field, LinkButton, Notice, Page } from '../../ui/components';
import { setMeta } from '../../lib/db';
import { KIND_LABEL } from './metricInfo';
import { runAnalysis, type LastErrorInfo } from './run';

const TRIM_HINT =
  '可以先在「照片」App 把影片剪到只剩動作前後幾秒再選取；iPhone 也可以把「設定 → 相機 → 格式」改成「最相容」，讀取會比較快。';

/** User-facing text for errors thrown while reading or analyzing a video. */
function errorText(code: string): string {
  switch (code) {
    case 'video_unsupported':
      return '這支手機的瀏覽器無法讀取這個影片格式。請改用相機 App 直接拍攝的影片。';
    case 'video_load_timeout':
      return `影片讀取超過 1 分鐘沒有進展，可能是檔案太大（例如 4K 或很長的影片）。${TRIM_HINT}`;
    case 'seek_failed':
      return `這支手機讀取影片畫面太慢，有太多畫面讀不到。${TRIM_HINT}也可以在「進階選項」把「降採樣」改成每 2 幀。`;
    default:
      return `分析失敗（${code}）。可以在「進階選項」改用較小的模型，或到「診斷」頁截圖回報。`;
  }
}

type Phase = 'pick' | 'probing' | 'ready' | 'running' | 'error';

export function NewAnalysis({
  kind,
  devVideo = null,
}: {
  kind: MotionKind;
  devVideo?: string | null;
}) {
  const me = useMe();
  const team = useCurrentTeam();
  const profiles = useRows('profiles');
  const [playerId, setPlayerId] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [probe, setProbe] = useState<VideoProbe | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [model, setModel] = useState<PoseModel>('full');
  const [stride, setStride] = useState(1);
  const [captureFps, setCaptureFps] = useState('');
  const [keepVideo, setKeepVideo] = useState(false);
  const [forceSeek, setForceSeek] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, startedAt: 0 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!playerId && me) setPlayerId(me.id);
  }, [me, playerId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Development only: ?devVideo=/data/local-videos/x.mov loads a local file without a picker.
  useEffect(() => {
    if (!devVideo) return;
    fetch(devVideo)
      .then((r) => r.blob())
      .then((b) =>
        onFile(
          new File([b], devVideo.split('/').pop() ?? 'dev.mp4', { type: b.type || 'video/mp4' }),
        ),
      );
  }, [devVideo]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    setFile(f);
    setPhase('probing');
    const u = URL.createObjectURL(f);
    setUrl(u);
    try {
      const v = await loadVideoElement(u);
      videoRef.current = v;
      const p = await probeVideo(f, v);
      setProbe(p);
      setRange([0, Math.min(p.durationS, 6)]);
      setPhase('ready');
    } catch (err) {
      setPhase('error');
      const code = (err as Error).message;
      setError(errorText(code));
      void recordError('load', code, f, null);
    }
  }

  function recordError(stage: LastErrorInfo['stage'], code: string, f: File, p: VideoProbe | null) {
    const info: LastErrorInfo = {
      at: new Date().toISOString(),
      stage,
      code,
      fileSizeMB: Math.round((f.size / 1e6) * 10) / 10,
      fileType: f.type || f.name.split('.').pop() || '—',
      fps: p?.fps ?? null,
      width: p?.width ?? null,
      height: p?.height ?? null,
      codec: p?.codec ?? null,
    };
    return setMeta('last_error', info).catch(() => {});
  }

  const fps = probe?.fps ?? 30;
  const frameCount = Math.max(0, Math.round(((range[1] - range[0]) * fps) / stride));

  async function start() {
    if (!file || !probe || !videoRef.current || !url || !playerId) return;
    setPhase('running');
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress({ done: 0, total: frameCount, startedAt: performance.now() });
    try {
      const row = await runAnalysis({
        kind,
        playerId,
        teamId: team?.id ?? null,
        file,
        videoUrl: url,
        video: videoRef.current,
        probe,
        extract: {
          model,
          frameStride: stride,
          start: range[0],
          end: range[1],
          forceMethod: forceSeek ? 'seek' : undefined,
          signal: ac.signal,
          onProgress: (done, total) => setProgress((p) => ({ ...p, done, total })),
        },
        captureFps: captureFps ? Number(captureFps) : null,
        keepVideo,
        createdBy: me?.user_id ?? null,
      });
      navigate(`/analyze/${row.id}`, { replace: true });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setPhase('ready');
        return;
      }
      console.error(err);
      setPhase('error');
      const code = (err as Error).message;
      setError(errorText(code));
      void recordError('analyze', code, file, probe);
    }
  }

  const elapsed = progress.startedAt ? (performance.now() - progress.startedAt) / 1000 : 0;
  const eta =
    progress.done > 5 ? (elapsed / progress.done) * (progress.total - progress.done) : null;

  return (
    <Page title={`新增${KIND_LABEL[kind]}分析`} back="/analyze">
      <Notice>
        影片只在這支手機上分析，<strong>不會上傳</strong>。第一次使用需要網路下載模型（約 10～30
        MB）。
      </Notice>

      <Card title="1. 球員">
        <select
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          disabled={phase === 'running'}
        >
          {(profiles ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.display_name}
            </option>
          ))}
        </select>
      </Card>

      <Card title="2. 選擇影片">
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>
            用手機相機以<strong>側面機位</strong>拍攝一次完整的{KIND_LABEL[kind]}動作，建議慢動作
            120／240 fps。
          </p>
          <LinkButton to="/analyze/guide" variant="secondary">
            怎麼拍？看拍攝引導
          </LinkButton>
          <label className="btn btn-primary btn-block">
            {file ? '換一支影片' : '選擇影片'}
            <input
              type="file"
              accept="video/*"
              hidden
              disabled={phase === 'running' || phase === 'probing'}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {phase === 'probing' ? <p className="muted">讀取影片資訊中…</p> : null}
          {url && phase !== 'probing' ? (
            <div className="video-stage">
              <video src={url} controls playsInline muted preload="metadata" />
            </div>
          ) : null}
          {probe ? <ProbeInfo probe={probe} /> : null}
        </div>
      </Card>

      {probe && (phase === 'ready' || phase === 'running') ? (
        <Card title="3. 分析範圍與選項">
          <div className="stack">
            <Field label={`開始：${range[0].toFixed(2)} 秒`}>
              <input
                type="range"
                min={0}
                max={probe.durationS}
                step={0.01}
                value={range[0]}
                disabled={phase === 'running'}
                onChange={(e) =>
                  setRange([Math.min(Number(e.target.value), range[1] - 0.2), range[1]])
                }
              />
            </Field>
            <Field label={`結束：${range[1].toFixed(2)} 秒`}>
              <input
                type="range"
                min={0}
                max={probe.durationS}
                step={0.01}
                value={range[1]}
                disabled={phase === 'running'}
                onChange={(e) =>
                  setRange([range[0], Math.max(Number(e.target.value), range[0] + 0.2)])
                }
              />
            </Field>
            <p className="small muted" style={{ margin: 0 }}>
              將分析 {frameCount} 幀。範圍只要包含一次完整動作（約 2～4 秒）即可，越短越快。
            </p>
            <details>
              <summary className="field-label">進階選項</summary>
              <div className="stack" style={{ marginTop: 10 }}>
                <Field label="骨架模型" hint="lite 最快、heavy 最準但最慢。預設 full。">
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value as PoseModel)}
                    disabled={phase === 'running'}
                  >
                    <option value="lite">lite（最快）</option>
                    <option value="full">full（建議）</option>
                    <option value="heavy">heavy（最慢）</option>
                  </select>
                </Field>
                <Field label="降採樣" hint="每 N 幀分析一次。手機太慢時使用，時間精度會下降。">
                  <select
                    value={stride}
                    onChange={(e) => setStride(Number(e.target.value))}
                    disabled={phase === 'running'}
                  >
                    <option value={1}>全部影格</option>
                    <option value={2}>每 2 幀</option>
                    <option value={4}>每 4 幀</option>
                  </select>
                </Field>
                <Field
                  label="實際拍攝 fps（選填）"
                  hint="只有在慢動作影片被轉成一般速度播放時才需要填，例如影片 30 fps 但實際用 240 fps 拍攝。"
                >
                  <input
                    inputMode="numeric"
                    placeholder="例如 240"
                    value={captureFps}
                    onChange={(e) => setCaptureFps(e.target.value.replace(/[^0-9.]/g, ''))}
                    disabled={phase === 'running'}
                  />
                </Field>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={keepVideo}
                    onChange={(e) => setKeepVideo(e.target.checked)}
                    disabled={phase === 'running'}
                  />
                  在這支手機保留原始影片（佔空間，不會上傳）
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={forceSeek}
                    onChange={(e) => setForceSeek(e.target.checked)}
                    disabled={phase === 'running'}
                  />
                  強制使用逐格跳轉（診斷用）
                </label>
              </div>
            </details>
          </div>
        </Card>
      ) : null}

      {error ? <Notice kind="error">{error}</Notice> : null}

      {phase === 'running' ? (
        <Card title="分析中…">
          <div className="stack">
            <div className="progress" aria-label="進度">
              <div
                style={{ width: `${progress.total ? (100 * progress.done) / progress.total : 0}%` }}
              />
            </div>
            <p className="mono" style={{ margin: 0 }}>
              {progress.done} / {progress.total} 幀・已用 {elapsed.toFixed(0)} 秒
              {eta !== null ? `・約剩 ${eta.toFixed(0)} 秒` : ''}
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              分析時請保持這個畫面開啟，不要切換 App 或鎖定螢幕。
            </p>
            <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
              取消
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          className="btn-block"
          disabled={phase !== 'ready' || !playerId || frameCount < 12}
          onClick={start}
        >
          開始分析
        </Button>
      )}
    </Page>
  );
}

function ProbeInfo({ probe }: { probe: VideoProbe }) {
  const lowFps = probe.fps !== null && probe.fps < 100;
  return (
    <div className="stack small">
      <div className="grid-2 mono">
        <span>長度：{probe.durationS.toFixed(2)} 秒</span>
        <span>
          解析度：{probe.width}×{probe.height}
        </span>
        <span>影格率：{probe.fps ? `${probe.fps.toFixed(1)} fps` : '無法讀取'}</span>
        <span>總幀數：{probe.frameCount ?? '—'}</span>
        <span>編碼：{probe.codec ?? '—'}</span>
        <span>擷取方式：{probe.webcodecs ? 'WebCodecs' : '逐格跳轉'}</span>
      </div>
      {lowFps ? (
        <Notice kind="warn">
          這支影片只有 {probe.fps!.toFixed(0)}{' '}
          fps。時間類指標精度有限；如果你是用慢動作拍的，可能是相簿轉出時降成一般影格率，請看拍攝引導的「取得原始檔」。
        </Notice>
      ) : null}
      {!probe.webcodecs ? (
        <Notice kind="warn">
          這支手機無法用快速模式解碼此影片，會改用逐格跳轉，分析時間會比較長。
        </Notice>
      ) : null}
    </div>
  );
}
