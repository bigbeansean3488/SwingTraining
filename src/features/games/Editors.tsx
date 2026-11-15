import { useState } from 'react';
import type { LiveState } from '../../scoring/engine';
import { currentBatter } from '../../scoring/engine';
import { suggestMoves, suggestRbi } from '../../scoring/suggest';
import type {
  BaseTo,
  GameEventPayload,
  HitLocation,
  Move,
  PAResult,
  PlayerRef,
  Side,
} from '../../scoring/types';
import { Button, Field } from '../../ui/components';
import { FieldDiagram } from './Field';
import {
  HIT_TYPE_LABEL,
  POSITIONS,
  RESULT_GROUPS,
  RESULT_LABEL,
  RUNNER_KIND_LABEL,
  SHORT_RESULT,
  SUB_KIND_LABEL,
  baseLabel,
} from './gameInfo';

type PA = Extract<GameEventPayload, { type: 'pa' }>;
type RunnerEv = Extract<GameEventPayload, { type: 'runner' }>;
type SubEv = Extract<GameEventPayload, { type: 'sub' }>;

export function ResultButtons({
  onPick,
  only,
}: {
  onPick: (r: PAResult) => void;
  only?: PAResult[];
}) {
  return (
    <div className="stack">
      {RESULT_GROUPS.map((g) => {
        const rs = g.results.filter((r) => !only || only.includes(r));
        if (!rs.length) return null;
        return (
          <div key={g.label}>
            <div className="small muted">{g.label}</div>
            <div className="chips">
              {rs.map((r) => (
                <button
                  key={r}
                  className="btn btn-secondary"
                  onClick={() => onPick(r)}
                  title={RESULT_LABEL[r]}
                >
                  {SHORT_RESULT[r]}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Destination selector for every runner on base and the batter. */
function MovesEditor({
  state,
  moves,
  onChange,
  includeBatter,
  runnerName,
}: {
  state: LiveState;
  moves: Move[];
  onChange: (m: Move[]) => void;
  includeBatter: boolean;
  runnerName: (p: PlayerRef) => string;
}) {
  const froms: (1 | 2 | 3 | 'B')[] = [
    ...([3, 2, 1] as const).filter((b) => state.bases[b - 1]),
    ...(includeBatter ? (['B'] as const) : []),
  ];
  if (!froms.length) return null;
  const get = (f: 1 | 2 | 3 | 'B') => moves.find((m) => m.from === f);
  const set = (f: 1 | 2 | 3 | 'B', to: BaseTo | 'stay', earned?: boolean) => {
    const rest = moves.filter((m) => m.from !== f);
    onChange(
      to === 'stay'
        ? rest
        : [...rest, { from: f, to, ...(earned === false ? { earned: false } : {}) }],
    );
  };
  const options = (f: 1 | 2 | 3 | 'B'): (BaseTo | 'stay')[] => {
    const start = f === 'B' ? 0 : f;
    const ahead = ([1, 2, 3] as const).filter((b) => b > start);
    return [...(f === 'B' ? [] : (['stay'] as const)), ...ahead, 'H', 'out'];
  };
  return (
    <div className="stack">
      <div className="field-label">跑者去向</div>
      {froms.map((f) => {
        const m = get(f);
        const who =
          f === 'B' ? runnerName(currentBatter(state)) : runnerName(state.bases[f - 1]!.player);
        return (
          <div key={String(f)} className="stack" style={{ gap: 4 }}>
            <div className="small">
              {baseLabel(f)}：{who}
            </div>
            <div className="chips">
              {options(f).map((o) => (
                <button
                  key={String(o)}
                  className={`btn btn-secondary btn-sm ${(m ? m.to : 'stay') === o ? 'selected' : ''}`}
                  onClick={() => set(f, o, m?.earned)}
                >
                  {o === 'stay' ? '留在原壘' : baseLabel(o)}
                </button>
              ))}
            </div>
            {m?.to === 'H' ? (
              <label className="check small">
                <input
                  type="checkbox"
                  checked={m.earned !== false}
                  onChange={(e) => set(f, 'H', e.target.checked ? undefined : false)}
                />
                自責分（取消勾選＝非自責）
              </label>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function PAEditor({
  state,
  initial,
  simpleMode,
  onSave,
  onCancel,
  runnerName,
}: {
  state: LiveState;
  initial: PA;
  simpleMode: boolean;
  onSave: (p: PA) => void;
  onCancel: () => void;
  runnerName: (p: PlayerRef) => string;
}) {
  const [p, setP] = useState<PA>(initial);
  const [rbiTouched, setRbiTouched] = useState(
    initial.rbi !== undefined && initial.rbi !== suggestRbi(initial.result, initial.moves),
  );
  const setMoves = (moves: Move[]) =>
    setP((x) => ({ ...x, moves, rbi: rbiTouched ? x.rbi : suggestRbi(x.result, moves) }));
  const changeResult = (result: PAResult) => {
    const moves = suggestMoves(state, result);
    setP((x) => ({ ...x, result, moves, rbi: suggestRbi(result, moves) }));
    setRbiTouched(false);
  };
  const inPlay = !['BB', 'IBB', 'HBP', 'CI', 'K', 'KL', 'K_REACH'].includes(p.result);
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{RESULT_LABEL[p.result]}</strong>
        <span className="small muted">打者：{runnerName(p.batter ?? currentBatter(state))}</span>
      </div>
      <details>
        <summary className="small">改成其他結果</summary>
        <ResultButtons onPick={changeResult} />
      </details>
      <MovesEditor
        state={state}
        moves={p.moves}
        onChange={setMoves}
        includeBatter
        runnerName={runnerName}
      />
      <div className="grid-2">
        <Field label="打點">
          <input
            inputMode="numeric"
            value={p.rbi ?? 0}
            onChange={(e) => {
              setRbiTouched(true);
              setP({ ...p, rbi: Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) });
            }}
          />
        </Field>
        <Field label="守備代號" hint="例 6-3、F8、E6">
          <input
            value={p.fielders ?? ''}
            onChange={(e) => setP({ ...p, fielders: e.target.value.toUpperCase() || undefined })}
          />
        </Field>
      </div>
      {inPlay ? (
        <>
          <div className="chips">
            {(Object.keys(HIT_TYPE_LABEL) as (keyof typeof HIT_TYPE_LABEL)[]).map((k) => (
              <button
                key={k}
                className={`btn btn-secondary btn-sm ${p.hitType === k ? 'selected' : ''}`}
                onClick={() => setP({ ...p, hitType: p.hitType === k ? undefined : k })}
              >
                {HIT_TYPE_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="small muted">點選擊球落點（選填）</div>
          <FieldDiagram
            value={p.location ?? null}
            onPick={(location: HitLocation) => setP({ ...p, location })}
          />
        </>
      ) : null}
      {simpleMode ? (
        <Field label="這個打席的用球數（選填）">
          <input
            inputMode="numeric"
            value={p.pitchCount ?? ''}
            onChange={(e) =>
              setP({
                ...p,
                pitchCount: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined,
              })
            }
          />
        </Field>
      ) : null}
      <div className="grid-2">
        <Button onClick={() => onSave(p)}>儲存</Button>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

export function RunnerEditor({
  state,
  initial,
  onSave,
  onCancel,
  runnerName,
}: {
  state: LiveState;
  initial?: RunnerEv;
  onSave: (p: RunnerEv) => void;
  onCancel: () => void;
  runnerName: (p: PlayerRef) => string;
}) {
  const [p, setP] = useState<RunnerEv>(initial ?? { type: 'runner', kind: 'SB', moves: [] });
  return (
    <div className="card stack">
      <strong>跑壘</strong>
      <div className="chips">
        {(Object.keys(RUNNER_KIND_LABEL) as RunnerEv['kind'][]).map((k) => (
          <button
            key={k}
            className={`btn btn-secondary btn-sm ${p.kind === k ? 'selected' : ''}`}
            onClick={() => setP({ ...p, kind: k })}
          >
            {RUNNER_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {state.bases.some(Boolean) ? (
        <MovesEditor
          state={state}
          moves={p.moves}
          onChange={(moves) => setP({ ...p, moves })}
          includeBatter={false}
          runnerName={runnerName}
        />
      ) : (
        <p className="small muted">壘上沒有跑者。</p>
      )}
      <Field label="守備代號（選填）" hint="例 2-6（捕手傳二壘觸殺）">
        <input
          value={p.fielders ?? ''}
          onChange={(e) => setP({ ...p, fielders: e.target.value.toUpperCase() || undefined })}
        />
      </Field>
      <div className="grid-2">
        <Button onClick={() => onSave(p)} disabled={!p.moves.length}>
          儲存
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

export function SubEditor({
  state,
  roster,
  initial,
  onSave,
  onCancel,
  runnerName,
}: {
  state: LiveState;
  roster: PlayerRef[];
  initial?: SubEv;
  onSave: (p: SubEv) => void;
  onCancel: () => void;
  runnerName: (p: PlayerRef) => string;
}) {
  const [side, setSide] = useState<Side>(initial?.side ?? 'us');
  const [kind, setKind] = useState<SubEv['kind']>(initial?.kind ?? 'PH');
  const [slot, setSlot] = useState<number>(initial?.slot ?? state.orderIndex[side]);
  const [playerId, setPlayerId] = useState(initial?.player.id ?? '');
  const [oppName, setOppName] = useState(initial?.player.id ? '' : (initial?.player.name ?? ''));
  const [position, setPosition] = useState(initial?.position ?? 'P');
  const lineup = state.lineups[side];
  const player: PlayerRef | null =
    side === 'us'
      ? (roster.find((r) => r.id === playerId) ?? null)
      : oppName.trim()
        ? { id: null, name: oppName.trim() }
        : null;
  return (
    <div className="card stack">
      <strong>換人</strong>
      <div className="grid-2">
        {(['us', 'opp'] as Side[]).map((s) => (
          <button
            key={s}
            className={`btn btn-secondary btn-sm ${side === s ? 'selected' : ''}`}
            onClick={() => setSide(s)}
          >
            {s === 'us' ? '我隊' : '對手'}
          </button>
        ))}
      </div>
      <div className="chips">
        {(Object.keys(SUB_KIND_LABEL) as SubEv['kind'][]).map((k) => (
          <button
            key={k}
            className={`btn btn-secondary btn-sm ${kind === k ? 'selected' : ''}`}
            onClick={() => setKind(k)}
          >
            {SUB_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {kind !== 'P' ? (
        <Field label="換下誰（棒次）">
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {lineup.map((s, i) => (
              <option key={i} value={i}>
                {i + 1} 棒・{runnerName(s.player)}（{s.position}）
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="換上">
        {side === 'us' ? (
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            <option value="">—</option>
            {roster.map((r) => (
              <option key={r.id!} value={r.id!}>
                {r.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={oppName}
            onChange={(e) => setOppName(e.target.value)}
            placeholder="對手球員姓名或背號"
          />
        )}
      </Field>
      {kind === 'DEF' ? (
        <Field label="守備位置">
          <select value={position} onChange={(e) => setPosition(e.target.value)}>
            {POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="grid-2">
        <Button
          disabled={!player}
          onClick={() =>
            player &&
            onSave({
              type: 'sub',
              side,
              kind,
              slot: kind === 'P' ? undefined : slot,
              player,
              position: kind === 'DEF' ? position : undefined,
            })
          }
        >
          儲存
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
