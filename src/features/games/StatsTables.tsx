import { useState } from 'react';
import type { Profile } from '../../lib/types';
import { isHit, type ReplayResult } from '../../scoring/engine';
import {
  avg,
  battingLines,
  era,
  fieldingLines,
  ip,
  obp,
  ops,
  pitchingLines,
  rate2,
  rate3,
  slg,
  whip,
} from '../../scoring/stats';
import type { PAResult, PlayerRef } from '../../scoring/types';
import { Empty } from '../../ui/components';
import { FieldDiagram, type SprayDot } from './Field';
import { nameOf } from './gameData';
import { RESULT_LABEL } from './gameInfo';
import { PITCH_TYPES } from '../training/trainingInfo';

export function BattingTable({
  games,
  profiles,
  onlyPlayer,
}: {
  games: ReplayResult[];
  profiles: Profile[] | null;
  onlyPlayer?: string;
}) {
  const lines = [...battingLines(games).values()].filter(
    (l) => !onlyPlayer || l.player.id === onlyPlayer,
  );
  if (!lines.length) return <Empty>沒有打擊紀錄。</Empty>;
  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>球員</th>
            <th>G</th>
            <th>PA</th>
            <th>AB</th>
            <th>H</th>
            <th>2B</th>
            <th>3B</th>
            <th>HR</th>
            <th>R</th>
            <th>RBI</th>
            <th>BB</th>
            <th>SO</th>
            <th>SB</th>
            <th>AVG</th>
            <th>OBP</th>
            <th>SLG</th>
            <th>OPS</th>
          </tr>
        </thead>
        <tbody>
          {lines
            .sort((a, b) => b.PA - a.PA)
            .map((l) => (
              <tr key={l.player.id ?? l.player.name}>
                <td>{nameOf(l.player, profiles)}</td>
                <td>{l.G}</td>
                <td>{l.PA}</td>
                <td>{l.AB}</td>
                <td>{l.H}</td>
                <td>{l['2B']}</td>
                <td>{l['3B']}</td>
                <td>{l.HR}</td>
                <td>{l.R}</td>
                <td>{l.RBI}</td>
                <td>{l.BB}</td>
                <td>{l.SO}</td>
                <td>{l.SB}</td>
                <td>{rate3(avg(l))}</td>
                <td>{rate3(obp(l))}</td>
                <td>{rate3(slg(l))}</td>
                <td>{rate3(ops(l))}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function PitchingTable({
  games,
  profiles,
  eraInnings = 9,
  onlyPlayer,
}: {
  games: ReplayResult[];
  profiles: Profile[] | null;
  eraInnings?: number;
  onlyPlayer?: string;
}) {
  const lines = [...pitchingLines(games).values()].filter(
    (l) => (!onlyPlayer || l.player.id === onlyPlayer) && (l.BF || l.pitches || l.outs),
  );
  if (!lines.length) return <Empty>沒有投球紀錄。</Empty>;
  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>投手</th>
            <th>G</th>
            <th>IP</th>
            <th>BF</th>
            <th>H</th>
            <th>R</th>
            <th>ER</th>
            <th>BB</th>
            <th>SO</th>
            <th>HR</th>
            <th>球數</th>
            <th>好球</th>
            <th>ERA</th>
            <th>WHIP</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.player.id ?? l.player.name}>
              <td>{nameOf(l.player, profiles)}</td>
              <td>{l.G}</td>
              <td>{ip(l.outs)}</td>
              <td>{l.BF}</td>
              <td>{l.H}</td>
              <td>{l.R}</td>
              <td>{l.ER}</td>
              <td>{l.BB}</td>
              <td>{l.SO}</td>
              <td>{l.HR}</td>
              <td>{l.pitches || '—'}</td>
              <td>{l.strikes || '—'}</td>
              <td>{rate2(era(l, eraInnings))}</td>
              <td>{rate2(whip(l))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lines.some((l) => Object.keys(l.byType).length) ? (
        <div className="stack small" style={{ marginTop: 8 }}>
          {lines
            .filter((l) => Object.keys(l.byType).length)
            .map((l) => (
              <div key={l.player.id ?? l.player.name}>
                <strong>{nameOf(l.player, profiles)}</strong> 球種：
                {Object.entries(l.byType)
                  .map(([k, n]) => `${PITCH_TYPES.find((t) => t.key === k)?.label ?? k} ${n}`)
                  .join('、')}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

export function FieldingTable({
  games,
  profiles,
}: {
  games: ReplayResult[];
  profiles: Profile[] | null;
}) {
  const lines = [...fieldingLines(games).values()];
  if (!lines.length) return <Empty>沒有守備紀錄（需要在打席輸入守備代號）。</Empty>;
  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr>
            <th>球員</th>
            <th>刺殺 PO</th>
            <th>助殺 A</th>
            <th>失誤 E</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.player.id ?? l.player.name}>
              <td>{nameOf(l.player, profiles)}</td>
              <td>{l.PO}</td>
              <td>{l.A}</td>
              <td>{l.E}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CATEGORY: { key: string; label: string; color: string; test: (r: PAResult) => boolean }[] = [
  { key: '1B', label: '一壘安打', color: 'var(--series-1)', test: (r) => r === '1B' },
  { key: 'XBH', label: '長打', color: 'var(--series-2)', test: (r) => r === '2B' || r === '3B' },
  { key: 'HR', label: '全壘打', color: 'var(--series-3)', test: (r) => r === 'HR' },
  { key: 'OUT', label: '出局／其他', color: 'var(--muted)', test: (r) => !isHit(r) },
];

/** Spray chart of our batters' balls in play. */
export function SprayChart({
  games,
  profiles,
  players,
}: {
  games: ReplayResult[];
  profiles: Profile[] | null;
  players: PlayerRef[];
}) {
  const [who, setWho] = useState<string>('');
  const pas = games
    .flatMap((g) => g.pas)
    .filter((p) => p.side === 'us' && p.location && (!who || p.batter.id === who));
  const dots: SprayDot[] = pas.map((p) => {
    const c = CATEGORY.find((x) => x.test(p.result))!;
    return {
      loc: p.location!,
      color: c.color,
      label: `${nameOf(p.batter, profiles)}：${RESULT_LABEL[p.result]}`,
    };
  });
  return (
    <div className="stack">
      <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="打者">
        <option value="">全部打者</option>
        {players.map((p) => (
          <option key={p.id ?? p.name} value={p.id ?? ''}>
            {nameOf(p, profiles)}
          </option>
        ))}
      </select>
      <FieldDiagram dots={dots} />
      <div className="legend">
        {CATEGORY.map((c) => (
          <span key={c.key} style={{ ['--dot' as string]: c.color }}>
            {c.label}（{pas.filter((p) => c.test(p.result)).length}）
          </span>
        ))}
      </div>
      {!pas.length ? (
        <p className="small muted">在打席結果點選擊球落點後，這裡會出現落點圖。</p>
      ) : null}
    </div>
  );
}
