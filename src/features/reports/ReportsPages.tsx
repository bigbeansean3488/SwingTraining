import { useMemo, useState } from 'react';
import { compareWithHistory } from '../../analysis/feedback';
import type { MotionKind } from '../../analysis/types';
import { mean } from '../../analysis/signal';
import { useAccess } from '../../lib/access';
import { toCsv, weekStart } from '../../lib/aggregate';
import { downloadText } from '../../lib/download';
import { useRows } from '../../lib/hooks';
import { avg, battingLines, era, ip, obp, pitchingLines, slg } from '../../scoring/stats';
import { Badge, Button, Card, Empty, ListLink, Notice, Page, Tabs } from '../../ui/components';
import { EVENT_KIND_LABEL } from '../team/teamInfo';
import {
  formatMetric,
  KIND_LABEL,
  METRIC_INFO,
  METRIC_ORDER,
  trendText,
} from '../analyze/metricInfo';
import { nameOf, useTeamReplays } from '../games/gameData';
import { LOG_KIND_LABEL, logSummary, pitchTotal } from '../training/trainingInfo';

function useTeamPlayers() {
  const access = useAccess();
  const members = useRows('team_members', (m) => m.active && m.team_id === access.teamId, [
    access.teamId,
  ]);
  const profiles = useRows('profiles');
  return useMemo(() => {
    const ids = new Set((members ?? []).map((m) => m.profile_id));
    if (access.meId) ids.add(access.meId);
    return (profiles ?? [])
      .filter((p) => ids.has(p.id))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'zh-Hant'));
  }, [members, profiles, access.meId]);
}

export function ReportsHome() {
  const access = useAccess();
  const players = useTeamPlayers();
  const visible = access.isStaff ? players : players.filter((p) => p.id === access.meId);
  return (
    <Page title="報表" back="/more">
      {access.isStaff ? (
        <ListLink to="/more/reports/team" title="教練總覽" subtitle="全隊各指標的分布與個人變化" />
      ) : null}
      <Card title="球員時間軸">
        {visible.length ? (
          <div className="list">
            {visible.map((p) => (
              <ListLink
                key={p.id}
                to={`/more/reports/player/${p.id}`}
                title={p.display_name}
                subtitle="訓練量、動作指標、比賽數據"
              />
            ))}
          </div>
        ) : (
          <Empty>沒有球員。</Empty>
        )}
      </Card>
      <CsvExports />
    </Page>
  );
}

/** Strip plot: one row per player, every value as a dot, latest emphasized. */
function StripPlot({
  rows,
  format,
}: {
  rows: { name: string; values: number[] }[];
  format: (v: number) => string;
}) {
  const all = rows.flatMap((r) => r.values);
  if (!all.length) return <Empty>沒有資料。</Empty>;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const W = 340;
  const L = 78;
  const rowH = 28;
  const H = rows.length * rowH + 24;
  const sx = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="全隊分布">
      {rows.map((r, i) => {
        const y = i * rowH + 16;
        return (
          <g key={r.name}>
            <text x={0} y={y + 4}>
              {r.name.length > 6 ? `${r.name.slice(0, 6)}…` : r.name}
            </text>
            <line x1={L} x2={W - 12} y1={y} y2={y} className="axis" opacity={0.5} />
            {r.values.map((v, j) => {
              const latest = j === r.values.length - 1;
              return (
                <circle
                  key={j}
                  cx={sx(v)}
                  cy={y}
                  r={latest ? 6 : 4}
                  fill="var(--series-1)"
                  opacity={latest ? 1 : 0.35}
                  stroke={latest ? 'var(--surface)' : 'none'}
                  strokeWidth={2}
                >
                  <title>{`${r.name}：${format(v)}${latest ? '（最新）' : ''}`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
      <text x={L} y={H - 4}>
        {format(lo)}
      </text>
      <text x={W - 12} y={H - 4} textAnchor="end">
        {format(hi)}
      </text>
    </svg>
  );
}

export function CoachOverview() {
  const access = useAccess();
  const players = useTeamPlayers();
  const analyses = useRows('motion_analyses', (a) => a.quality.ok);
  const logs = useRows('training_logs');
  const [kind, setKind] = useState<MotionKind>('batting');
  const [metric, setMetric] = useState('');
  const ofKind = (analyses ?? []).filter((a) => a.kind === kind);
  const keys = METRIC_ORDER[kind].filter((k) => ofKind.some((a) => a.metrics[k]));
  const key = keys.includes(metric)
    ? metric
    : (keys.find((k) => k === 'stride_length') ?? keys[0] ?? '');
  const unit = ofKind.find((a) => a.metrics[key])?.metrics[key]?.unit ?? '';
  const fmt = (v: number) => formatMetric({ value: v, unit });

  const rows = players
    .map((p) => {
      const mine = ofKind
        .filter((a) => a.player_id === p.id && a.metrics[key])
        .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
      const values = mine.map((a) => a.metrics[key]!.value);
      const fb = mine.length
        ? compareWithHistory(
            mine[mine.length - 1]!.metrics,
            mine.slice(0, -1).map((a) => a.metrics),
          )
        : null;
      return {
        id: p.id,
        name: p.display_name,
        values,
        trend: fb?.metrics.find((m) => m.key === key)?.trend,
      };
    })
    .filter((r) => r.values.length);

  const [fourWeeksAgo] = useState(() =>
    weekStart(new Date(Date.now() - 21 * 86400000).toLocaleDateString('sv-SE')),
  );
  const recent = (logs ?? []).filter((l) => l.date >= fourWeeksAgo);

  if (!access.isStaff)
    return (
      <Page title="教練總覽" back="/more/reports">
        <Notice>只有教練與管理員可以查看全隊總覽。</Notice>
      </Page>
    );

  return (
    <Page title="教練總覽" back="/more/reports">
      <Card title="動作指標分布">
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
            <select value={key} onChange={(e) => setMetric(e.target.value)} aria-label="指標">
              {keys.map((k) => (
                <option key={k} value={k}>
                  {METRIC_INFO[k]?.label ?? k}
                </option>
              ))}
            </select>
          ) : null}
          <StripPlot rows={rows} format={fmt} />
          <p className="small muted" style={{ margin: 0 }}>
            每一列是一位球員，淡色點是過去的分析，實心點是最新一次。球員之間的拍攝距離與角度不同，跨球員比較只能參考；個人變化以自己的平均為準。
          </p>
          {rows.length ? (
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>球員</th>
                    <th>次數</th>
                    <th>最新</th>
                    <th>平均</th>
                    <th>個人變化</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td>{r.values.length}</td>
                      <td>{fmt(r.values[r.values.length - 1]!)}</td>
                      <td>{fmt(mean(r.values))}</td>
                      <td>
                        {r.trend ? (
                          <Badge>{trendText(METRIC_INFO[key], r.trend)}</Badge>
                        ) : (
                          <span className="muted">資料不足</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </Card>
      <Card title="近四週訓練量">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>球員</th>
                <th>揮棒</th>
                <th>投球</th>
                <th>紀錄筆數</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => {
                const mine = recent.filter((l) => l.player_id === p.id);
                return (
                  <tr key={p.id}>
                    <td>{p.display_name}</td>
                    <td>
                      {mine
                        .filter((l) => l.kind === 'batting')
                        .reduce((a, l) => a + (l.data.swings ?? 0), 0)}
                    </td>
                    <td>
                      {mine
                        .filter((l) => l.kind === 'bullpen')
                        .reduce((a, l) => a + pitchTotal(l), 0)}
                    </td>
                    <td>{mine.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}

function CsvExports() {
  const access = useAccess();
  const profiles = useRows('profiles');
  const logs = useRows('training_logs');
  const analyses = useRows('motion_analyses');
  const attendance = useRows('attendance');
  const events = useRows('events');
  const replays = useTeamReplays(access.teamId);
  const name = (id: string) => profiles?.find((p) => p.id === id)?.display_name ?? id;
  const stamp = new Date().toLocaleDateString('sv-SE');
  const save = (file: string, csv: string) => downloadText(`${file}-${stamp}.csv`, csv, 'text/csv');

  const exportLogs = () =>
    save(
      'training-logs',
      toCsv(
        (logs ?? []).map((l) => ({
          date: l.date,
          player: name(l.player_id),
          kind: LOG_KIND_LABEL[l.kind],
          summary: logSummary(l),
          swings: l.data.swings,
          pitches: l.kind === 'bullpen' ? pitchTotal(l) : '',
          item: l.data.item,
          value: l.data.value,
          unit: l.data.unit,
          note: l.note,
        })),
        [
          { key: 'date', label: '日期' },
          { key: 'player', label: '球員' },
          { key: 'kind', label: '類型' },
          { key: 'summary', label: '內容' },
          { key: 'swings', label: '揮棒次數' },
          { key: 'pitches', label: '投球數' },
          { key: 'item', label: '項目' },
          { key: 'value', label: '數值' },
          { key: 'unit', label: '單位' },
          { key: 'note', label: '備註' },
        ],
      ),
    );

  const exportAnalyses = () => {
    const keys = [...new Set((analyses ?? []).flatMap((a) => Object.keys(a.metrics)))];
    save(
      'motion-analyses',
      toCsv(
        (analyses ?? []).map((a) => ({
          date: a.recorded_at,
          player: name(a.player_id),
          kind: KIND_LABEL[a.kind],
          ok: a.quality.ok ? '是' : '否',
          fps: a.fps,
          engine: a.engine_version,
          model: a.model_version,
          ...Object.fromEntries(keys.map((k) => [k, a.metrics[k]?.value])),
        })),
        [
          { key: 'date', label: '分析時間' },
          { key: 'player', label: '球員' },
          { key: 'kind', label: '類型' },
          { key: 'ok', label: '通過品質檢查' },
          { key: 'fps', label: '幀率' },
          { key: 'engine', label: '分析引擎版本' },
          { key: 'model', label: '模型版本' },
          ...keys.map((k) => ({
            key: k,
            label: `${METRIC_INFO[k]?.label ?? k}（${analyses?.find((a) => a.metrics[k])?.metrics[k]?.unit ?? ''}）`,
          })),
        ],
      ),
    );
  };

  const exportBatting = () => {
    const games = (replays ?? []).map((r) => r.result);
    const lines = [...battingLines(games).values()];
    save(
      'batting',
      toCsv(
        lines.map((l) => ({
          ...l,
          name: nameOf(l.player, profiles),
          AVG: avg(l),
          OBP: obp(l),
          SLG: slg(l),
        })),
        [
          'name',
          'G',
          'PA',
          'AB',
          'H',
          '1B',
          '2B',
          '3B',
          'HR',
          'R',
          'RBI',
          'BB',
          'HBP',
          'SO',
          'SF',
          'SH',
          'SB',
          'CS',
          'GIDP',
          'TB',
          'AVG',
          'OBP',
          'SLG',
        ].map((k) => ({ key: k, label: k === 'name' ? '球員' : k })),
      ),
    );
  };

  const exportPitching = () => {
    const games = (replays ?? []).map((r) => r.result);
    const lines = [...pitchingLines(games).values()].filter((l) => l.BF || l.outs);
    save(
      'pitching',
      toCsv(
        lines.map((l) => ({ ...l, name: nameOf(l.player, profiles), IP: ip(l.outs), ERA: era(l) })),
        [
          'name',
          'G',
          'IP',
          'BF',
          'H',
          'R',
          'ER',
          'BB',
          'SO',
          'HBP',
          'HR',
          'pitches',
          'strikes',
          'ERA',
        ].map((k) => ({
          key: k,
          label:
            k === 'name' ? '投手' : k === 'pitches' ? '用球數' : k === 'strikes' ? '好球數' : k,
        })),
      ),
    );
  };

  const exportAttendance = () =>
    save(
      'attendance',
      toCsv(
        (attendance ?? []).map((a) => {
          const ev = events?.find((e) => e.id === a.event_id);
          return {
            date: ev?.starts_at.slice(0, 10),
            title: ev?.title,
            kind: ev ? EVENT_KIND_LABEL[ev.kind] : '',
            player: name(a.player_id),
            status: { yes: '會到', no: '請假', maybe: '未定' }[a.status],
            note: a.note,
          };
        }),
        [
          { key: 'date', label: '日期' },
          { key: 'title', label: '行程' },
          { key: 'kind', label: '類型' },
          { key: 'player', label: '球員' },
          { key: 'status', label: '回覆' },
          { key: 'note', label: '備註' },
        ],
      ),
    );

  return (
    <Card title="匯出 CSV">
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          匯出這支手機上看得到的資料（球員只會匯出自己的）。用 Excel 或 Google 試算表開啟。
        </p>
        <Button variant="secondary" onClick={exportLogs}>
          訓練紀錄
        </Button>
        <Button variant="secondary" onClick={exportAnalyses}>
          動作分析指標
        </Button>
        <Button variant="secondary" onClick={exportBatting} disabled={!replays}>
          比賽打擊數據
        </Button>
        <Button variant="secondary" onClick={exportPitching} disabled={!replays}>
          比賽投球數據
        </Button>
        <Button variant="secondary" onClick={exportAttendance}>
          出席紀錄
        </Button>
      </div>
    </Card>
  );
}
