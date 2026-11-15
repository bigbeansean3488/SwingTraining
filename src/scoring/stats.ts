// Batting, pitching and fielding statistics derived from replayed events.
import { isHit, playerKey, type ReplayResult } from './engine';
import type { PAResult, PlayerRef, Side } from './types';

export interface BattingLine {
  player: PlayerRef;
  G: number;
  PA: number;
  AB: number;
  H: number;
  '1B': number;
  '2B': number;
  '3B': number;
  HR: number;
  R: number;
  RBI: number;
  BB: number;
  HBP: number;
  SO: number;
  SF: number;
  SH: number;
  SB: number;
  CS: number;
  GIDP: number;
  TB: number;
}

export interface PitchingLine {
  player: PlayerRef;
  G: number;
  outs: number;
  BF: number;
  H: number;
  R: number;
  ER: number;
  BB: number;
  SO: number;
  HBP: number;
  HR: number;
  pitches: number;
  strikes: number;
  balls: number;
  byType: Record<string, number>;
}

export interface FieldingLine {
  player: PlayerRef;
  PO: number;
  A: number;
  E: number;
}

const NOT_AB: PAResult[] = ['BB', 'IBB', 'HBP', 'SF', 'SH', 'CI'];
const SO: PAResult[] = ['K', 'KL', 'K_REACH'];
const BASES: Partial<Record<PAResult, number>> = { '1B': 1, '2B': 2, '3B': 3, HR: 4 };

function emptyBatting(player: PlayerRef): BattingLine {
  return {
    player,
    G: 0,
    PA: 0,
    AB: 0,
    H: 0,
    '1B': 0,
    '2B': 0,
    '3B': 0,
    HR: 0,
    R: 0,
    RBI: 0,
    BB: 0,
    HBP: 0,
    SO: 0,
    SF: 0,
    SH: 0,
    SB: 0,
    CS: 0,
    GIDP: 0,
    TB: 0,
  };
}
function emptyPitching(player: PlayerRef): PitchingLine {
  return {
    player,
    G: 0,
    outs: 0,
    BF: 0,
    H: 0,
    R: 0,
    ER: 0,
    BB: 0,
    SO: 0,
    HBP: 0,
    HR: 0,
    pitches: 0,
    strikes: 0,
    balls: 0,
    byType: {},
  };
}

/** Batting lines for one side across one or more games. */
export function battingLines(games: ReplayResult[], side: Side = 'us'): Map<string, BattingLine> {
  const m = new Map<string, BattingLine>();
  const get = (p: PlayerRef) => {
    const k = playerKey(p);
    let l = m.get(k);
    if (!l) m.set(k, (l = emptyBatting(p)));
    return l;
  };
  for (const g of games) {
    const appeared = new Set<string>();
    for (const pa of g.pas) {
      if (pa.side !== side) continue;
      const l = get(pa.batter);
      appeared.add(playerKey(pa.batter));
      l.PA++;
      if (!NOT_AB.includes(pa.result)) l.AB++;
      if (isHit(pa.result)) {
        l.H++;
        l[pa.result as '1B' | '2B' | '3B' | 'HR']++;
        l.TB += BASES[pa.result] ?? 0;
      }
      if (pa.result === 'BB' || pa.result === 'IBB') l.BB++;
      if (pa.result === 'HBP') l.HBP++;
      if (SO.includes(pa.result)) l.SO++;
      if (pa.result === 'SF') l.SF++;
      if (pa.result === 'SH') l.SH++;
      if (pa.result === 'DP') l.GIDP++;
      l.RBI += pa.rbi;
    }
    for (const r of g.runs) if (r.side === side) get(r.runner).R++;
    for (const st of g.steals) if (st.side === side) get(st.runner)[st.kind]++;
    for (const k of appeared) m.get(k)!.G++;
  }
  return m;
}

export function pitchingLines(games: ReplayResult[], side: Side = 'us'): Map<string, PitchingLine> {
  const m = new Map<string, PitchingLine>();
  const get = (p: PlayerRef) => {
    const k = playerKey(p);
    let l = m.get(k);
    if (!l) m.set(k, (l = emptyPitching(p)));
    return l;
  };
  for (const g of games) {
    const fieldingSide = side;
    const appeared = new Set<string>();
    for (const pa of g.pas) {
      if (pa.side === fieldingSide) continue; // our batters
      const l = get(pa.pitcher);
      appeared.add(playerKey(pa.pitcher));
      l.BF++;
      if (isHit(pa.result)) l.H++;
      if (pa.result === 'HR') l.HR++;
      if (pa.result === 'BB' || pa.result === 'IBB') l.BB++;
      if (pa.result === 'HBP') l.HBP++;
      if (SO.includes(pa.result)) l.SO++;
      // Simple mode: pitch counts come from the plate appearance.
      if (!g.pitches.length) l.pitches += pa.pitches;
    }
    for (const o of g.outs) if (o.side === fieldingSide) get(o.pitcher).outs += o.n;
    for (const r of g.runs) {
      if (r.side === fieldingSide) continue;
      const l = get(r.pitcher);
      l.R++;
      if (r.earned) l.ER++;
    }
    for (const p of g.pitches) {
      if (p.side !== fieldingSide) continue;
      const l = get(p.pitcher);
      appeared.add(playerKey(p.pitcher));
      l.pitches++;
      if (p.call === 'B' || p.call === 'IB' || p.call === 'HBP') l.balls++;
      else l.strikes++;
      if (p.pitchType) l.byType[p.pitchType] = (l.byType[p.pitchType] ?? 0) + 1;
    }
    for (const k of appeared) m.get(k)!.G++;
  }
  return m;
}

export function fieldingLines(games: ReplayResult[], side: Side = 'us'): Map<string, FieldingLine> {
  const m = new Map<string, FieldingLine>();
  for (const g of games) {
    for (const f of g.fielding) {
      if (f.side !== side) continue;
      const k = playerKey(f.player);
      const l = m.get(k) ?? { player: f.player, PO: 0, A: 0, E: 0 };
      l.PO += f.po;
      l.A += f.a;
      l.E += f.e;
      m.set(k, l);
    }
  }
  return m;
}

// ----- Rates and formatting ---------------------------------------------------

export const avg = (l: BattingLine) => (l.AB ? l.H / l.AB : NaN);
export const obp = (l: BattingLine) => {
  const d = l.AB + l.BB + l.HBP + l.SF;
  return d ? (l.H + l.BB + l.HBP) / d : NaN;
};
export const slg = (l: BattingLine) => (l.AB ? l.TB / l.AB : NaN);
export const ops = (l: BattingLine) => obp(l) + slg(l);

/** ERA per `innings` (9 by default; set 7 for 7-inning leagues). */
export const era = (l: PitchingLine, innings = 9) => (l.outs ? (l.ER * innings * 3) / l.outs : NaN);
export const whip = (l: PitchingLine) => (l.outs ? ((l.BB + l.H) * 3) / l.outs : NaN);

/** ".333" style; "—" when undefined. */
export function rate3(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const s = v.toFixed(3);
  return v < 1 ? s.replace(/^0/, '') : s;
}

/** Innings pitched as "5.2" (5 innings and 2 outs). */
export function ip(outs: number): string {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

export function rate2(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : '—';
}
