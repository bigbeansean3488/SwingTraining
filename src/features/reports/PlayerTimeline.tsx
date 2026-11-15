import { useMemo, useState } from 'react';
import type { MotionKind } from '../../analysis/types';
import { useAccess } from '../../lib/access';
import { cumulativeAvg, perGameSeries, weeklyVolume } from '../../lib/aggregate';
import { useRow, useRows } from '../../lib/hooks';
import { BarChart } from '../../ui/BarChart';
import { Card, Empty, Page, Tabs } from '../../ui/components';
import { LineChart } from '../../ui/LineChart';
import { formatMetric, METRIC_INFO, METRIC_ORDER } from '../analyze/metricInfo';
import { useTeamReplays } from '../games/gameData';
import { rate3 } from '../../scoring/stats';

const day = (s: string) => Date.parse(s.length === 10 ? `${s}T00:00:00` : s);

/**
 * Training volume, motion metrics and game results on one shared time axis.
 * Three aligned charts (small multiples) instead of one chart with two y-axes.
 */
export function PlayerTimeline({ id }: { id: string }) {
  const player = useRow('profiles', id);
  const access = useAccess();
  const logs = useRows('training_logs', (l) => l.player_id === id, [id]);
  const analyses = useRows('motion_analyses', (a) => a.player_id === id && a.quality.ok, [id]);
  const replays = useTeamReplays(access.teamId);
  const [kind, setKind] = useState<MotionKind>('batting');
  const [metric, setMetric] = useState('');
  const [gameView, setGameView] = useState<'bat' | 'pitch'>('bat');

  const volume = useMemo(() => weeklyVolume(logs ?? []), [logs]);
  const games = useMemo(
    () =>
      perGameSeries(
        (replays ?? []).map((r) => ({
          date: r.game.game_date,
          opponent: r.game.opponent,
          result: r.result,
        })),
        id,
      ),
    [replays, id],
  );
  const ofKind = (analyses ?? []).filter((a) => a.kind === kind);
  const keys = METRIC_ORDER[kind].filter((k) => ofKind.some((a) => a.metrics[k]));
  const key = keys.includes(metric)
    ? metric
    : (keys.find((k) => k === 'stride_length') ?? keys[0] ?? '');
  const unit = ofKind.find((a) => a.metrics[key])?.metrics[key]?.unit ?? '';
  const metricPts = ofKind
    .filter((a) => a.metrics[key])
    .map((a) => ({ x: Date.parse(a.recorded_at), y: a.metrics[key]!.value }));

  const allX = [
    ...volume.map((v) => day(v.week)),
    ...volume.map((v) => day(v.week) + 7 * 86400000),
    ...metricPts.map((p) => p.x),
    ...games.map((g) => day(g.date)),
  ];
  const domain: [number, number] | undefined = allX.length
    ? [Math.min(...allX), Math.max(...allX)]
    : undefined;

  if (!player)
    return (
      <Page title="球員時間軸" back="/more/reports">
        <Empty>載入中…</Empty>
      </Page>
    );

  return (
    <Page title={`${player.display_name}・時間軸`} back="/more/reports">
      <p className="small muted" style={{ margin: 0 }}>
        三張圖使用同一條時間軸，可以上下對照訓練量、動作指標與比賽表現。動作指標是 2D
        估計值，只看自己的趨勢；對照不代表因果。
      </p>
      <Card title="每週訓練量">
        <BarChart
          label="每週訓練量"
          domain={domain}
          rows={volume.map((v) => ({ x: day(v.week), swings: v.swings, pitches: v.pitches }))}
          series={[
            { key: 'swings', label: '揮棒次數', color: 1 },
            { key: 'pitches', label: '投球數', color: 2 },
          ]}
        />
      </Card>
      <Card title="動作指標">
        <div className="stack">
          <Tabs<MotionKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'batting', label: '打擊' },
              { value: 'pitching', label: '投球' },
            ]}
          />
          {keys.length ? (
            <>
              <select value={key} onChange={(e) => setMetric(e.target.value)} aria-label="指標">
                {keys.map((k) => (
                  <option key={k} value={k}>
                    {METRIC_INFO[k]?.label ?? k}
                  </option>
                ))}
              </select>
              <LineChart
                label={METRIC_INFO[key]?.label ?? key}
                points={metricPts}
                domain={domain}
                format={(v) => formatMetric({ value: v, unit })}
              />
            </>
          ) : (
            <Empty>沒有通過品質檢查的分析。</Empty>
          )}
        </div>
      </Card>
      <Card title="比賽表現">
        <div className="stack">
          <Tabs<'bat' | 'pitch'>
            value={gameView}
            onChange={setGameView}
            options={[
              { value: 'bat', label: '累計打擊率' },
              { value: 'pitch', label: '每場用球數' },
            ]}
          />
          {gameView === 'bat' ? (
            <LineChart
              label="累計打擊率"
              points={cumulativeAvg(games).map((p) => ({ x: day(p.date), y: p.value }))}
              domain={domain}
              format={rate3}
              color={3}
            />
          ) : (
            <LineChart
              label="每場用球數"
              points={games
                .filter((g) => g.pitches || g.outs)
                .map((g) => ({ x: day(g.date), y: g.pitches, note: g.opponent }))}
              domain={domain}
              format={(v) => `${Math.round(v)}`}
              color={4}
            />
          )}
        </div>
      </Card>
    </Page>
  );
}
