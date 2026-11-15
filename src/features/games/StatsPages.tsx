import { useState } from 'react';
import { useAccess } from '../../lib/access';
import { useRows } from '../../lib/hooks';
import { playerKey } from '../../scoring/engine';
import type { PlayerRef } from '../../scoring/types';
import { Card, Empty, Page } from '../../ui/components';
import { useGame, useTeamReplays } from './gameData';
import { LineScore } from './GameScorePage';
import { BattingTable, FieldingTable, PitchingTable, SprayChart } from './StatsTables';

export function GameStatsPage({ id }: { id: string }) {
  const view = useGame(id);
  const profiles = useRows('profiles');
  if (!view)
    return (
      <Page title="比賽數據" back={`/games/${id}`}>
        <Empty>載入中…</Empty>
      </Page>
    );
  const games = [view.result];
  const players = view.setup.lineups.us.map((s) => s.player);
  return (
    <Page title={`數據・${view.game.opponent}`} back={`/games/${id}`}>
      <Card title="比分">
        <LineScore
          result={view.result}
          innings={view.game.innings}
          homeAway={view.game.home_away}
        />
      </Card>
      <Card title="我隊打擊">
        <BattingTable games={games} profiles={profiles} />
      </Card>
      <Card title="我隊投球">
        <PitchingTable games={games} profiles={profiles} eraInnings={view.game.innings} />
      </Card>
      <Card title="我隊守備">
        <FieldingTable games={games} profiles={profiles} />
      </Card>
      <Card title="擊球落點">
        <SprayChart games={games} profiles={profiles} players={players} />
      </Card>
    </Page>
  );
}

export function SeasonStatsPage() {
  const access = useAccess();
  const seasons = useRows('seasons', (s) => s.team_id === access.teamId, [access.teamId]);
  const [season, setSeason] = useState('');
  const replays = useTeamReplays(access.teamId, season || null);
  const profiles = useRows('profiles');
  if (!replays)
    return (
      <Page title="球季數據" back="/games">
        <Empty>載入中…</Empty>
      </Page>
    );
  const games = replays.map((r) => r.result);
  const players = new Map<string, PlayerRef>();
  for (const g of games)
    for (const p of g.pas) if (p.side === 'us') players.set(playerKey(p.batter), p.batter);
  return (
    <Page title="球季數據" back="/games">
      {(seasons ?? []).length ? (
        <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="球季">
          <option value="">全部比賽</option>
          {(seasons ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>
        共 {games.length} 場。所有數據都由逐球／逐打席紀錄即時計算。
      </p>
      <Card title="打擊">
        <BattingTable games={games} profiles={profiles} />
      </Card>
      <Card title="投球">
        <PitchingTable games={games} profiles={profiles} />
      </Card>
      <Card title="守備">
        <FieldingTable games={games} profiles={profiles} />
      </Card>
      <Card title="擊球落點">
        <SprayChart games={games} profiles={profiles} players={[...players.values()]} />
      </Card>
    </Page>
  );
}
