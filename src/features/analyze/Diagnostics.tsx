import { useEffect, useState } from 'react';
import { ENGINE_VERSION } from '../../analysis';
import { useMeta } from '../../lib/hooks';
import { prefetchModel, TASKS_VISION_VERSION, type PoseModel } from '../../pose/mediapipe';
import { Button, Card, Notice, Page } from '../../ui/components';
import type { LastRunStats } from './run';

interface Caps {
  webcodecs: boolean;
  h264: boolean | null;
  hevc: boolean | null;
  rvfc: boolean;
  compression: boolean;
  webgl2: boolean;
  storage: string;
}

async function detectCaps(): Promise<Caps> {
  const check = async (codec: string) => {
    if (typeof VideoDecoder === 'undefined') return null;
    try {
      return !!(
        await VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080 })
      ).supported;
    } catch {
      return false;
    }
  };
  let storage = '—';
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    storage = `${((e.usage ?? 0) / 1e6).toFixed(1)} MB / ${((e.quota ?? 0) / 1e9).toFixed(1)} GB`;
  }
  return {
    webcodecs: typeof VideoDecoder !== 'undefined',
    h264: await check('avc1.640028'),
    hevc: await check('hvc1.1.6.L123.B0'),
    rvfc: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    compression: typeof CompressionStream !== 'undefined',
    webgl2: !!document.createElement('canvas').getContext('webgl2'),
    storage,
  };
}

const yes = (v: boolean | null) => (v === null ? '—' : v ? '✅ 支援' : '❌ 不支援');

export function Diagnostics() {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [dl, setDl] = useState<string | null>(null);
  const last = useMeta<LastRunStats>('last_run');
  useEffect(() => {
    detectCaps().then(setCaps);
  }, []);

  async function prefetch(m: PoseModel) {
    setDl(`下載 ${m} 模型中…`);
    try {
      await prefetchModel(m);
      setDl(`${m} 模型已下載，之後離線也能分析。`);
    } catch (err) {
      setDl(`下載失敗：${(err as Error).message}`);
    }
  }

  return (
    <Page title="診斷與效能" back="/analyze">
      <Card title="離線準備">
        <p style={{ marginTop: 0 }}>在有網路時先下載模型，之後沒網路也能分析。</p>
        <div className="grid-3">
          {(['lite', 'full', 'heavy'] as PoseModel[]).map((m) => (
            <Button key={m} variant="secondary" onClick={() => prefetch(m)}>
              {m}
            </Button>
          ))}
        </div>
        {dl ? <Notice>{dl}</Notice> : null}
      </Card>

      <Card title="這支手機的瀏覽器">
        {caps ? (
          <div className="stack small">
            <div>WebCodecs：{yes(caps.webcodecs)}</div>
            <div>H.264 解碼：{yes(caps.h264)}</div>
            <div>HEVC（iPhone 預設）解碼：{yes(caps.hevc)}</div>
            <div>requestVideoFrameCallback：{yes(caps.rvfc)}</div>
            <div>WebGL2（GPU 推論）：{yes(caps.webgl2)}</div>
            <div>壓縮串流：{yes(caps.compression)}</div>
            <div>本機儲存用量：{caps.storage}</div>
            <div className="muted" style={{ wordBreak: 'break-all' }}>
              {navigator.userAgent}
            </div>
          </div>
        ) : (
          <p className="empty">偵測中…</p>
        )}
      </Card>

      <Card title="上一次分析的效能">
        {last ? (
          <div className="stack small mono">
            <div>時間：{new Date(last.at).toLocaleString('zh-TW')}</div>
            <div>
              擷取方式：{last.method}・{last.delegate}・模型 {last.model}
            </div>
            <div>
              影片：{last.width}×{last.height}・
              {last.sourceFps ? `${last.sourceFps.toFixed(1)} fps` : '幀率未知'}・
              {last.codec ?? '—'}
            </div>
            <div>
              分析 {last.frames} 幀・總共 {(last.processingMs / 1000).toFixed(1)} 秒・每幀{' '}
              {last.msPerFrame} ms（推論{' '}
              {last.frames ? (last.inferMs / last.frames).toFixed(1) : '—'} ms）
            </div>
            <div>3 秒 240 fps（720 幀）預估：{((last.msPerFrame * 720) / 1000).toFixed(0)} 秒</div>
            {last.fallbackReason ? <div>改用逐格跳轉的原因：{last.fallbackReason}</div> : null}
          </div>
        ) : (
          <p className="empty">還沒有分析紀錄。</p>
        )}
        <p className="small muted">
          請把這一段截圖回報，用來記錄不同手機的速度（docs/DECISIONS.md）。
        </p>
      </Card>

      <p className="small muted center">
        分析引擎 v{ENGINE_VERSION}・tasks-vision {TASKS_VISION_VERSION}
      </p>
    </Page>
  );
}
