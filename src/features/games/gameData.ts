// Assemble a game's setup and events from the local database and replay them.
import { useMemo } from 'react';
import { useRows } from '../../lib/hooks';
import type { Game, GameEventRow, Lineup, Profile } from '../../lib/types';
import { replay, type ReplayResult } from '../../scoring/engine';
import type {
  GameEventPayload,
  GameSetup,
  PlayerRef,
  ScoredEvent,
  Slot,
} from '../../scoring/types';

export function toSetup(game: Game, lineups: Lineup[]): GameSetup {
  const side = (s: 'us' | 'opp') =>
    lineups.filter((l) => l.side === s).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const toSlots = (l: Lineup | undefined): Slot[] =>
    (l?.slots ?? [])
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ player: { id: s.player_id, name: s.name }, position: s.position }));
  const u = side('us');
  const o = side('opp');
  return {
    homeAway: game.home_away,
    innings: game.innings,
    lineups: { us: toSlots(u), opp: toSlots(o) },
    pitchers: {
      us: { id: u?.pitcher_id ?? null, name: u?.pitcher_name ?? '我隊投手' },
      opp: { id: null, name: o?.pitcher_name ?? '對手投手' },
    },
  };
}

export function toScored(rows: GameEventRow[]): ScoredEvent[] {
  return rows
    .filter((r) => !r.deleted_at)
    .sort((a, b) => a.seq - b.seq)
    .map((r) => ({
      id: r.id,
      seq: r.seq,
      payload: { ...(r.payload as object), type: r.type } as GameEventPayload,
    }));
}

/** Split a payload into the row's type and payload columns. */
export function fromPayload(p: GameEventPayload): {
  type: string;
  payload: Record<string, unknown>;
} {
  const { type, ...rest } = p;
  return { type, payload: rest as Record<string, unknown> };
}

export interface GameView {
  game: Game;
  setup: GameSetup;
  events: ScoredEvent[];
  rows: GameEventRow[];
  result: ReplayResult;
}

/** Live replay of one game; recomputes whenever its events or lineups change. */
export function useGame(gameId: string): GameView | null | undefined {
  const games = useRows('games', (g) => g.id === gameId, [gameId]);
  const lineups = useRows('lineups', (l) => l.game_id === gameId, [gameId]);
  const rows = useRows('game_events', (e) => e.game_id === gameId, [gameId]);
  return useMemo(() => {
    if (games === null || lineups === null || rows === null) return undefined;
    const game = games[0];
    if (!game) return null;
    const setup = toSetup(game, lineups);
    const events = toScored(rows);
    return { game, setup, events, rows, result: replay(setup, events) };
  }, [games, lineups, rows]);
}

/** Replays of every game of a team (for season statistics). */
export function useTeamReplays(
  teamId: string | null,
  seasonId?: string | null,
): { game: Game; result: ReplayResult }[] | null {
  const games = useRows(
    'games',
    (g) => g.team_id === teamId && (!seasonId || g.season_id === seasonId),
    [teamId, seasonId],
  );
  const lineups = useRows('lineups', (l) => l.team_id === teamId, [teamId]);
  const rows = useRows('game_events', (e) => e.team_id === teamId, [teamId]);
  return useMemo(() => {
    if (!games || !lineups || !rows) return null;
    return games.map((game) => ({
      game,
      result: replay(
        toSetup(
          game,
          lineups.filter((l) => l.game_id === game.id),
        ),
        toScored(rows.filter((r) => r.game_id === game.id)),
      ),
    }));
  }, [games, lineups, rows]);
}

export function nameOf(p: PlayerRef, profiles: Profile[] | null): string {
  if (p.id) return profiles?.find((x) => x.id === p.id)?.display_name ?? p.name;
  return p.name;
}
