import { useMemo, useState } from 'react';
import { useAccess } from '../../lib/access';
import { deleteRow, saveRow, updateRow } from '../../lib/db';
import { useRows } from '../../lib/hooks';
import { currentBatter, replay, type LiveState } from '../../scoring/engine';
import { suggestMoves, suggestRbi } from '../../scoring/suggest';
import type {
  GameEventPayload,
  PAResult,
  PitchCall,
  PlayerRef,
  ScoredEvent,
} from '../../scoring/types';
import { Badge, Button, Card, Empty, LinkButton, Notice, Page } from '../../ui/components';
import { PITCH_TYPES } from '../training/trainingInfo';
import { PAEditor, ResultButtons, RunnerEditor, SubEditor } from './Editors';
import { Diamond } from './Field';
import { fromPayload, nameOf, useGame } from './gameData';
import {
  PITCH_LABEL,
  RESULT_LABEL,
  RUNNER_KIND_LABEL,
  SUB_KIND_LABEL,
  baseLabel,
} from './gameInfo';

type Editing =
  | { kind: 'pa'; payload: Extract<GameEventPayload, { type: 'pa' }>; eventId?: string }
  | { kind: 'runner'; payload?: Extract<GameEventPayload, { type: 'runner' }>; eventId?: string }
  | { kind: 'sub'; payload?: Extract<GameEventPayload, { type: 'sub' }>; eventId?: string };

const PITCH_CALLS: PitchCall[] = ['B', 'CS', 'SS', 'F', 'FT', 'BIP', 'HBP'];

export function GameScorePage({ id }: { id: string }) {
  const view = useGame(id);
  const access = useAccess();
  const profiles = useRows('profiles');
  const members = useRows('team_members', (m) => m.active && m.team_id === view?.game.team_id, [
    view?.game.team_id,
  ]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pitchType, setPitchType] = useState<string | undefined>(undefined);
  const [awaitingResult, setAwaitingResult] = useState(false);
  const name = (p: PlayerRef) => nameOf(p, profiles);

  const roster: PlayerRef[] = useMemo(
    () =>
      (members ?? []).map((m) => ({
        id: m.profile_id,
        name: profiles?.find((p) => p.id === m.profile_id)?.display_name ?? '—',
      })),
    [members, profiles],
  );

  // State at the point being edited (before that event) or the live state.
  const editState: LiveState | null = useMemo(() => {
    if (!view) return null;
    if (!editing?.eventId) return view.result.state;
    const target = view.events.find((e) => e.id === editing.eventId);
    return replay(
      view.setup,
      view.events.filter((e) => target && e.seq < target.seq),
    ).state;
  }, [view, editing]);

  if (view === undefined)
    return (
      <Page title="比賽" back="/games">
        <Empty>載入中…</Empty>
      </Page>
    );
  if (view === null)
    return (
      <Page title="比賽" back="/games">
        <Empty>找不到這場比賽。</Empty>
      </Page>
    );
  const { game, result } = view;
  const s = result.state;
  const canScore = access.isStaff;
  const simple = game.mode === 'simple';

  async function save(payload: GameEventPayload, eventId?: string) {
    const { type, payload: body } = fromPayload(payload);
    if (eventId) await updateRow('game_events', eventId, { type, payload: body });
    else {
      const seq = Math.max(0, ...view!.rows.filter((r) => !r.deleted_at).map((r) => r.seq)) + 1;
      await saveRow('game_events', {
        game_id: game.id,
        team_id: game.team_id,
        seq,
        type,
        payload: body,
        created_by: null,
      });
    }
    setEditing(null);
    setAwaitingResult(false);
  }

  const startPA = (result: PAResult) => {
    const moves = suggestMoves(s, result);
    setEditing({
      kind: 'pa',
      payload: { type: 'pa', result, moves, rbi: suggestRbi(result, moves) },
    });
  };

  async function pitch(call: PitchCall) {
    await save({ type: 'pitch', call, pitchType });
    if (call === 'BIP') setAwaitingResult(true);
    if (call === 'HBP') startPA('HBP');
  }

  const balls = s.count.balls;
  const strikes = s.count.strikes;
  const lastEvent = view.events[view.events.length - 1];

  return (
    <Page
      title={`${game.home_away === 'home' ? 'vs' : '@'} ${game.opponent}`}
      back="/games"
      actions={
        <LinkButton to={`/games/${game.id}/stats`} variant="secondary">
          數據
        </LinkButton>
      }
    >
      <Card>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="metric-value">
              我隊 {s.score.us}：{s.score.opp} 對手
            </div>
            <div>
              {s.inning} 局{s.half === 'top' ? '上' : '下'}・
              {s.battingSide === 'us' ? '我隊進攻' : '我隊守備'}
            </div>
            {!simple ? (
              <div className="mono">
                {balls} 壞 {strikes} 好
              </div>
            ) : null}
            <div className="small muted">
              打者：{name(currentBatter(s))}
              <br />
              投手：{name(s.pitchers[s.fieldingSide])}
            </div>
          </div>
          <Diamond bases={s.bases.map(Boolean)} outs={s.outs} />
        </div>
        <LineScore result={result} innings={game.innings} homeAway={game.home_away} />
        {game.status === 'final' ? <Badge>比賽結束</Badge> : null}
      </Card>

      {result.problems.length ? (
        <Notice kind="warn">
          有 {result.problems.length} 筆事件和壘包狀態對不上（例如從空的壘包推進），請檢查下方紀錄。
        </Notice>
      ) : null}

      {canScore && game.status !== 'final' && !editing ? (
        <Card title={simple || awaitingResult ? '打席結果' : '這一球'}>
          {!simple && !awaitingResult ? (
            <div className="stack">
              <div className="chips">
                {PITCH_TYPES.map((t) => (
                  <button
                    key={t.key}
                    className={`btn btn-secondary btn-sm ${pitchType === t.key ? 'selected' : ''}`}
                    onClick={() => setPitchType(pitchType === t.key ? undefined : t.key)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="grid-2">
                {PITCH_CALLS.map((c) => (
                  <button
                    key={c}
                    className={`btn ${c === 'BIP' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => pitch(c)}
                  >
                    {PITCH_LABEL[c]}
                  </button>
                ))}
              </div>
              {balls >= 4 ? <Button onClick={() => startPA('BB')}>四壞球：記錄保送</Button> : null}
              {strikes >= 3 ? (
                <div className="grid-2">
                  <Button onClick={() => startPA(lastPitchCall(view.events) === 'CS' ? 'KL' : 'K')}>
                    三振出局
                  </Button>
                  <Button variant="secondary" onClick={() => startPA('K_REACH')}>
                    不死三振上壘
                  </Button>
                </div>
              ) : null}
              <details>
                <summary className="small">直接記錄打席結果</summary>
                <ResultButtons onPick={startPA} />
              </details>
            </div>
          ) : (
            <ResultButtons onPick={startPA} />
          )}
          <div className="grid-2" style={{ marginTop: 12 }}>
            <Button
              variant="secondary"
              onClick={() => setEditing({ kind: 'runner' })}
              disabled={!s.bases.some(Boolean)}
            >
              跑壘
            </Button>
            <Button variant="secondary" onClick={() => setEditing({ kind: 'sub' })}>
              換人
            </Button>
          </div>
        </Card>
      ) : null}

      {editing && editState ? (
        editing.kind === 'pa' ? (
          <PAEditor
            state={editState}
            initial={editing.payload}
            simpleMode={simple}
            runnerName={name}
            onCancel={() => setEditing(null)}
            onSave={(p) => save(p, editing.eventId)}
          />
        ) : editing.kind === 'runner' ? (
          <RunnerEditor
            state={editState}
            initial={editing.payload}
            runnerName={name}
            onCancel={() => setEditing(null)}
            onSave={(p) => save(p, editing.eventId)}
          />
        ) : (
          <SubEditor
            state={editState}
            roster={roster}
            initial={editing.payload}
            runnerName={name}
            onCancel={() => setEditing(null)}
            onSave={(p) => save(p, editing.eventId)}
          />
        )
      ) : null}

      <Card title={`逐球／逐打席紀錄（${view.events.length}）`}>
        {canScore && lastEvent ? (
          <Button
            variant="ghost"
            className="btn-sm"
            onClick={() => confirm('刪除最後一筆紀錄？') && deleteRow('game_events', lastEvent.id)}
          >
            復原最後一筆
          </Button>
        ) : null}
        {!view.events.length ? <Empty>還沒有紀錄。</Empty> : null}
        <div className="stack small">
          {[...view.events].reverse().map((ev) => {
            const tl = result.timeline.find((t) => t.eventId === ev.id);
            const problem = result.problems.find((p) => p.eventId === ev.id);
            return (
              <div
                key={ev.id}
                className="row"
                style={{
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--line)',
                  paddingBottom: 6,
                }}
              >
                <div style={{ flex: 1 }}>
                  <span className="muted mono">
                    {tl ? `${tl.inning}${tl.half === 'top' ? '上' : '下'} ${tl.outs}出 ` : ''}
                  </span>
                  {describe(ev, name, view.result.pas.find((p) => p.eventId === ev.id)?.batter)}
                  {problem ? (
                    <span style={{ color: 'var(--error)' }}>（⚠ {problem.message}）</span>
                  ) : null}
                </div>
                {canScore && ev.payload.type !== 'pitch' ? (
                  <span className="row" style={{ gap: 4 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setEditing({
                          kind: ev.payload.type,
                          payload: ev.payload,
                          eventId: ev.id,
                        } as Editing)
                      }
                    >
                      改
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        confirm('刪除這筆紀錄？數據會重新計算。') && deleteRow('game_events', ev.id)
                      }
                    >
                      刪
                    </button>
                  </span>
                ) : canScore ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => deleteRow('game_events', ev.id)}
                  >
                    刪
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      {canScore ? (
        <div className="grid-2">
          <LinkButton to={`/games/${game.id}/setup`} variant="secondary">
            陣容與設定
          </LinkButton>
          <Button
            variant="secondary"
            onClick={() =>
              updateRow('games', game.id, { status: game.status === 'final' ? 'live' : 'final' })
            }
          >
            {game.status === 'final' ? '重新開啟記錄' : '比賽結束'}
          </Button>
        </div>
      ) : null}
    </Page>
  );
}

function lastPitchCall(events: ScoredEvent[]): PitchCall | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const p = events[i]!.payload;
    if (p.type === 'pitch') return p.call;
    if (p.type === 'pa') return undefined;
  }
  return undefined;
}

function describe(ev: ScoredEvent, name: (p: PlayerRef) => string, batter?: PlayerRef): string {
  const p = ev.payload;
  const moves = (ms: { from: 1 | 2 | 3 | 'B'; to: string | number }[]) =>
    ms
      .filter((m) => m.from !== 'B')
      .map((m) => `${baseLabel(m.from)}→${baseLabel(m.to as never)}`)
      .join('、');
  switch (p.type) {
    case 'pitch':
      return `${PITCH_LABEL[p.call]}${p.pitchType ? `（${PITCH_TYPES.find((t) => t.key === p.pitchType)?.label ?? p.pitchType}）` : ''}`;
    case 'pa': {
      const m = moves(p.moves);
      return `${batter ? name(batter) : ''}：${RESULT_LABEL[p.result]}${p.fielders ? `（${p.fielders}）` : ''}${p.rbi ? `，${p.rbi} 分打點` : ''}${m ? `；${m}` : ''}`;
    }
    case 'runner':
      return `${RUNNER_KIND_LABEL[p.kind]}：${moves(p.moves)}`;
    case 'sub':
      return `${p.side === 'us' ? '我隊' : '對手'}${SUB_KIND_LABEL[p.kind]}：${name(p.player)}${p.position ? `（${p.position}）` : ''}`;
  }
}

export function LineScore({
  result,
  innings,
  homeAway,
}: {
  result: ReturnType<typeof replay>;
  innings: number;
  homeAway: 'home' | 'away';
}) {
  const n = Math.max(innings, result.lineScore.us.length, result.lineScore.opp.length);
  const hits = (side: 'us' | 'opp') =>
    result.pas.filter((p) => p.side === side && ['1B', '2B', '3B', 'HR'].includes(p.result)).length;
  const errors = (side: 'us' | 'opp') =>
    result.fielding.filter((f) => f.side === side).reduce((a, f) => a + f.e, 0);
  const rows: ('us' | 'opp')[] = homeAway === 'away' ? ['us', 'opp'] : ['opp', 'us'];
  return (
    <div className="table-scroll" style={{ marginTop: 8 }}>
      <table className="data" style={{ fontSize: 13 }}>
        <thead>
          <tr>
            <th></th>
            {Array.from({ length: n }, (_, i) => (
              <th key={i}>{i + 1}</th>
            ))}
            <th>R</th>
            <th>H</th>
            <th>E</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((side) => (
            <tr key={side}>
              <td>{side === 'us' ? '我隊' : '對手'}</td>
              {Array.from({ length: n }, (_, i) => (
                <td key={i}>{result.lineScore[side][i] ?? ''}</td>
              ))}
              <td>
                <strong>{result.state.score[side]}</strong>
              </td>
              <td>{hits(side)}</td>
              <td>{errors(side)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
