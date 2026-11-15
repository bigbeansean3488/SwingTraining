import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventTimes, PoseSequence } from '../../analysis/types';
import { frameConfidence } from '../../analysis/quality';
import { drawSkeleton, nearestFrame } from '../../ui/skeleton';

const SPEEDS = [0.1, 0.25, 0.5, 1];

export interface OverlayPlayerProps {
  seq: PoseSequence;
  videoUrl: string | null;
  events: EventTimes;
  eventLabels: Record<string, string>;
  /** Called with the media time of the frame on screen when the user re-marks an event. */
  onMarkEvent?: (event: string, t: number) => void;
  /** Externally requested time to jump to (e.g. when a peer player is synced). */
  syncTime?: number;
  onTime?: (t: number) => void;
  compact?: boolean;
}

/**
 * Video with the skeleton drawn on top. Frame-by-frame stepping uses the analyzed
 * frames; without a video (not kept) it plays the skeleton alone.
 */
export function OverlayPlayer(props: OverlayPlayerProps) {
  const { seq, videoUrl, events } = props;
  const times = useMemo(() => seq.frames.map((f) => f.t), [seq]);
  const conf = useMemo(() => frameConfidence(seq), [seq]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.25);
  const [markAs, setMarkAs] = useState<string>(
    Object.keys(props.eventLabels).find((k) => k !== 'stance') ?? '',
  );
  const idxRef = useRef(0);
  const onTimeRef = useRef(props.onTime);
  onTimeRef.current = props.onTime;

  const draw = useCallback(
    (i: number) => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d')!;
      const w = c.width;
      const h = c.height;
      ctx.clearRect(0, 0, w, h);
      if (!videoUrl) {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, w, h);
      }
      drawSkeleton(ctx, seq.frames[i]?.lm ?? null, w, h, w / 600);
    },
    [seq, videoUrl],
  );

  const show = useCallback(
    (i: number, seekVideo = true) => {
      const j = Math.max(0, Math.min(seq.frames.length - 1, i));
      idxRef.current = j;
      setIdx(j);
      draw(j);
      onTimeRef.current?.(times[j]!);
      const v = videoRef.current;
      if (v && seekVideo) v.currentTime = times[j]! + 0.0005;
    },
    [draw, seq.frames.length, times],
  );

  // Canvas resolution follows the image aspect.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = 720;
    c.height = Math.round((720 * seq.height) / Math.max(1, seq.width));
    draw(idxRef.current);
  }, [seq, draw]);

  useEffect(() => {
    if (props.syncTime === undefined) return;
    show(nearestFrame(times, props.syncTime));
  }, [props.syncTime, show, times]);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    const v = videoRef.current;
    let raf = 0;
    if (v) {
      v.playbackRate = speed;
      if (v.currentTime >= times[times.length - 1]! - 0.01) v.currentTime = times[0]!;
      v.play().catch(() => setPlaying(false));
      const tick = () => {
        const i = nearestFrame(times, v.currentTime);
        if (i !== idxRef.current) {
          idxRef.current = i;
          setIdx(i);
          draw(i);
          onTimeRef.current?.(times[i]!);
        }
        if (v.currentTime >= times[times.length - 1]!) {
          v.pause();
          setPlaying(false);
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(raf);
        v.pause();
      };
    }
    // Skeleton-only playback driven by a wall clock.
    const startWall = performance.now();
    const startT = idxRef.current >= times.length - 1 ? times[0]! : times[idxRef.current]!;
    const tick = () => {
      const t = startT + ((performance.now() - startWall) / 1000) * speed;
      if (t >= times[times.length - 1]!) {
        show(times.length - 1, false);
        setPlaying(false);
        return;
      }
      const i = nearestFrame(times, t);
      if (i !== idxRef.current) show(i, false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, times, draw, show]);

  const eventEntries = Object.entries(events).filter(([k]) => props.eventLabels[k]);

  return (
    <div className="stack">
      <div
        className="video-stage"
        style={videoUrl ? undefined : { aspectRatio: `${seq.width} / ${seq.height}` }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            muted
            preload="auto"
            onLoadedData={() => show(idxRef.current)}
          />
        ) : null}
        <canvas ref={canvasRef} className={videoUrl ? 'overlay' : undefined} />
      </div>
      <input
        type="range"
        min={0}
        max={seq.frames.length - 1}
        value={idx}
        aria-label="影格"
        onChange={(e) => {
          setPlaying(false);
          show(Number(e.target.value));
        }}
      />
      <div className="row mono small" style={{ justifyContent: 'space-between' }}>
        <span>
          {times[idx]?.toFixed(3)} 秒・第 {idx + 1}/{seq.frames.length} 幀
        </span>
        <span>
          信心值 {(conf[idx] ?? 0).toFixed(2)}
          {(conf[idx] ?? 0) < 0.5 ? ' ⚠' : ''}
        </span>
      </div>
      <div className="grid-3">
        <button
          className="btn btn-secondary"
          aria-label="上一幀"
          onClick={() => (setPlaying(false), show(idx - 1))}
        >
          ◀ 1 幀
        </button>
        <button className="btn btn-primary" onClick={() => setPlaying((p) => !p)}>
          {playing ? '暫停' : '播放'}
        </button>
        <button
          className="btn btn-secondary"
          aria-label="下一幀"
          onClick={() => (setPlaying(false), show(idx + 1))}
        >
          1 幀 ▶
        </button>
      </div>
      <div className="chips" role="group" aria-label="播放速度">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`btn btn-secondary btn-sm ${s === speed ? 'selected' : ''}`}
            onClick={() => setSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      {eventEntries.length && !props.compact ? (
        <div className="chips" role="group" aria-label="跳到事件">
          {eventEntries.map(([k, t]) => (
            <button
              key={k}
              className="btn btn-ghost btn-sm"
              onClick={() => (setPlaying(false), show(nearestFrame(times, t)))}
            >
              {props.eventLabels[k]} {t.toFixed(2)}s
            </button>
          ))}
        </div>
      ) : null}
      {props.onMarkEvent && !props.compact ? (
        <div className="row">
          <select
            className="grow"
            value={markAs}
            onChange={(e) => setMarkAs(e.target.value)}
            aria-label="要修正的事件"
            style={{ flex: 1 }}
          >
            {Object.entries(props.eventLabels)
              .filter(([k]) => k !== 'stance')
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
          </select>
          <button
            className="btn btn-secondary"
            onClick={() => props.onMarkEvent!(markAs, times[idx]!)}
          >
            設為目前畫面
          </button>
        </div>
      ) : null}
    </div>
  );
}
