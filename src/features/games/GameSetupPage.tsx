import { useEffect, useState } from 'react';
import { useAccess } from '../../lib/access';
import { getRow, saveRow } from '../../lib/db';
import { useRows } from '../../lib/hooks';
import { navigate } from '../../lib/router';
import type { Game, GameMode, Lineup, LineupSlot } from '../../lib/types';
import { Button, Card, Field, Notice, Page } from '../../ui/components';
import { POSITIONS } from './gameInfo';

const DEFAULT_POS = ['CF', 'SS', '2B', '1B', '3B', 'LF', 'RF', 'C', 'DH'];

function blankSlots(prefix: string | null): LineupSlot[] {
  return DEFAULT_POS.map((position, i) => ({
    order: i,
    player_id: null,
    name: prefix ? `${prefix}${i + 1}` : '',
    position,
  }));
}

export function GameSetupPage({ id, eventId }: { id?: string; eventId?: string | null }) {
  const access = useAccess();
  const members = useRows('team_members', (m) => m.active && m.team_id === access.teamId, [
    access.teamId,
  ]);
  const profiles = useRows('profiles');
  const seasons = useRows('seasons', (s) => s.team_id === access.teamId, [access.teamId]);
  const [game, setGame] = useState<Game | null>(null);
  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [homeAway, setHomeAway] = useState<'home' | 'away'>('home');
  const [innings, setInnings] = useState(9);
  const [mode, setMode] = useState<GameMode>('simple');
  const [season, setSeason] = useState('');
  const [usSlots, setUsSlots] = useState<LineupSlot[]>(blankSlots(null));
  const [oppSlots, setOppSlots] = useState<LineupSlot[]>(blankSlots('對手'));
  const [usPitcher, setUsPitcher] = useState('');
  const [oppPitcher, setOppPitcher] = useState('對手投手');
  const [lineupRows, setLineupRows] = useState<Lineup[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (id) {
        const g = await getRow('games', id);
        if (!g) return;
        setGame(g);
        setOpponent(g.opponent);
        setDate(g.game_date);
        setHomeAway(g.home_away);
        setInnings(g.innings);
        setMode(g.mode);
        setSeason(g.season_id ?? '');
      } else if (eventId) {
        const ev = await getRow('events', eventId);
        if (ev) {
          setOpponent(ev.title.replace(/^vs\.?\s*/i, ''));
          setDate(new Date(ev.starts_at).toLocaleDateString('sv-SE'));
          setSeason(ev.season_id ?? '');
        }
      }
    })();
  }, [id, eventId]);

  const existingLineups = useRows('lineups', (l) => !!id && l.game_id === id, [id]);
  useEffect(() => {
    if (!existingLineups?.length) return;
    setLineupRows(existingLineups);
    const u = existingLineups.find((l) => l.side === 'us');
    const o = existingLineups.find((l) => l.side === 'opp');
    if (u) {
      setUsSlots(u.slots);
      setUsPitcher(u.pitcher_id ?? '');
    }
    if (o) {
      setOppSlots(o.slots);
      setOppPitcher(o.pitcher_name ?? '對手投手');
    }
  }, [existingLineups]);

  const roster = (members ?? []).map((m) => ({
    id: m.profile_id,
    name: profiles?.find((p) => p.id === m.profile_id)?.display_name ?? '—',
    no: m.jersey_number,
  }));
  const nameOf = (pid: string) => roster.find((r) => r.id === pid)?.name ?? '';

  async function save() {
    setErr(null);
    if (!access.teamId) return;
    if (!opponent.trim()) return setErr('請填寫對手。');
    const us = usSlots.filter((s) => s.player_id);
    if (us.length < 1) return setErr('請至少排一位我方打者。');
    if (new Set(us.map((s) => s.player_id)).size !== us.length)
      return setErr('同一位球員排了兩次。');
    const g = await saveRow('games', {
      ...(game ?? {}),
      id: game?.id,
      team_id: access.teamId,
      season_id: season || null,
      event_id: game?.event_id ?? eventId ?? null,
      opponent: opponent.trim(),
      game_date: date,
      home_away: homeAway,
      innings,
      mode,
      status: game?.status ?? 'live',
      notes: game?.notes ?? null,
      created_by: game?.created_by ?? null,
    });
    const usRow = lineupRows.find((l) => l.side === 'us');
    const oppRow = lineupRows.find((l) => l.side === 'opp');
    await saveRow('lineups', {
      ...(usRow ?? {}),
      id: usRow?.id,
      game_id: g.id,
      team_id: access.teamId,
      side: 'us',
      slots: us.map((s, i) => ({ ...s, order: i, name: nameOf(s.player_id!) })),
      pitcher_id: usPitcher || null,
      pitcher_name: usPitcher ? nameOf(usPitcher) : '我隊投手',
    });
    await saveRow('lineups', {
      ...(oppRow ?? {}),
      id: oppRow?.id,
      game_id: g.id,
      team_id: access.teamId,
      side: 'opp',
      slots: oppSlots
        .filter((s) => s.name.trim())
        .map((s, i) => ({ ...s, order: i, player_id: null })),
      pitcher_id: null,
      pitcher_name: oppPitcher.trim() || '對手投手',
    });
    navigate(`/games/${g.id}`, { replace: true });
  }

  if (!access.isStaff)
    return (
      <Page title="比賽設定" back="/games">
        <Notice>只有教練與管理員可以建立比賽。</Notice>
      </Page>
    );

  return (
    <Page title={game ? '比賽設定' : '新增比賽'} back={game ? `/games/${game.id}` : '/games'}>
      <Card>
        <div className="stack">
          <Field label="對手">
            <input value={opponent} onChange={(e) => setOpponent(e.target.value)} />
          </Field>
          <div className="grid-2">
            <Field label="日期">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="局數">
              <select value={innings} onChange={(e) => setInnings(Number(e.target.value))}>
                {[5, 6, 7, 9].map((n) => (
                  <option key={n} value={n}>
                    {n} 局
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="我隊">
            <div className="grid-2">
              <button
                className={`btn btn-secondary ${homeAway === 'away' ? 'selected' : ''}`}
                onClick={() => setHomeAway('away')}
              >
                先攻（客隊）
              </button>
              <button
                className={`btn btn-secondary ${homeAway === 'home' ? 'selected' : ''}`}
                onClick={() => setHomeAway('home')}
              >
                後攻（主隊）
              </button>
            </div>
          </Field>
          <Field
            label="記錄模式"
            hint="簡化：每個打席記一次結果。逐球：每一球都記（球數、球種），比較花時間。"
          >
            <div className="grid-2">
              <button
                className={`btn btn-secondary ${mode === 'simple' ? 'selected' : ''}`}
                onClick={() => setMode('simple')}
              >
                簡化
              </button>
              <button
                className={`btn btn-secondary ${mode === 'pitch' ? 'selected' : ''}`}
                onClick={() => setMode('pitch')}
              >
                逐球
              </button>
            </div>
          </Field>
          {(seasons ?? []).length ? (
            <Field label="球季">
              <select value={season} onChange={(e) => setSeason(e.target.value)}>
                <option value="">—</option>
                {(seasons ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
      </Card>

      <Card title="我隊先發">
        <div className="stack">
          {usSlots.map((s, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <span className="mono" style={{ width: 20 }}>
                {i + 1}
              </span>
              <select
                value={s.player_id ?? ''}
                onChange={(e) =>
                  setUsSlots(
                    usSlots.map((x, j) =>
                      j === i ? { ...x, player_id: e.target.value || null } : x,
                    ),
                  )
                }
                style={{ flex: 2 }}
                aria-label={`第 ${i + 1} 棒`}
              >
                <option value="">—</option>
                {roster.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.no ? `#${r.no} ` : ''}
                    {r.name}
                  </option>
                ))}
              </select>
              <select
                value={s.position}
                onChange={(e) =>
                  setUsSlots(
                    usSlots.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)),
                  )
                }
                style={{ flex: 1 }}
                aria-label={`第 ${i + 1} 棒守備位置`}
              >
                {POSITIONS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          ))}
          <Field label="我隊先發投手">
            <select value={usPitcher} onChange={(e) => setUsPitcher(e.target.value)}>
              <option value="">—</option>
              {roster.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          {!roster.length ? (
            <Notice kind="warn">球隊名單是空的，請先到「更多 → 球隊」加入球員。</Notice>
          ) : null}
        </div>
      </Card>

      <Card title="對手打序">
        <div className="stack">
          {oppSlots.map((s, i) => (
            <div key={i} className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <span className="mono" style={{ width: 20 }}>
                {i + 1}
              </span>
              <input
                value={s.name}
                onChange={(e) =>
                  setOppSlots(
                    oppSlots.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
                style={{ flex: 2 }}
                aria-label={`對手第 ${i + 1} 棒`}
              />
              <select
                value={s.position}
                onChange={(e) =>
                  setOppSlots(
                    oppSlots.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)),
                  )
                }
                style={{ flex: 1 }}
                aria-label={`對手第 ${i + 1} 棒守備位置`}
              >
                {POSITIONS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          ))}
          <Field label="對手先發投手">
            <input value={oppPitcher} onChange={(e) => setOppPitcher(e.target.value)} />
          </Field>
        </div>
      </Card>
      {err ? <Notice kind="error">{err}</Notice> : null}
      <Button onClick={save}>{game ? '儲存' : '開始記錄'}</Button>
    </Page>
  );
}
