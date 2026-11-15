// Replays game events into the live game state and per-play records.
// Pure; every statistic is derived from the records (src/scoring/stats.ts).
import type {
  BaseFrom,
  GameSetup,
  Half,
  Move,
  PAResult,
  PitchCall,
  PlayerRef,
  ScoredEvent,
  Side,
  Slot,
} from './types';

export interface RunnerOnBase {
  player: PlayerRef;
  /** Pitcher charged if this runner scores (inherited runners stay with their pitcher). */
  pitcher: PlayerRef;
  /** Reached on an error / interference: the run would be unearned. */
  unearned: boolean;
}

export interface LiveState {
  inning: number;
  half: Half;
  outs: number;
  bases: [RunnerOnBase | null, RunnerOnBase | null, RunnerOnBase | null];
  score: Record<Side, number>;
  battingSide: Side;
  fieldingSide: Side;
  orderIndex: Record<Side, number>;
  lineups: Record<Side, Slot[]>;
  pitchers: Record<Side, PlayerRef>;
  count: { balls: number; strikes: number };
  /** Pitches thrown in the current plate appearance (pitch mode). */
  paPitches: number;
}

export interface PARecord {
  eventId: string;
  inning: number;
  half: Half;
  side: Side;
  batter: PlayerRef;
  pitcher: PlayerRef;
  result: PAResult;
  rbi: number;
  runs: number;
  outsOnPlay: number;
  pitches: number;
  location?: { x: number; y: number };
  hitType?: string;
  fielders?: string;
}

export interface RunRecord {
  eventId: string;
  side: Side;
  inning: number;
  runner: PlayerRef;
  pitcher: PlayerRef;
  earned: boolean;
}

export interface PitchRecord {
  eventId: string;
  /** Side of the pitcher (fielding side). */
  side: Side;
  pitcher: PlayerRef;
  batter: PlayerRef;
  call: PitchCall;
  pitchType?: string;
}

export interface OutRecord {
  side: Side;
  pitcher: PlayerRef;
  n: number;
}

export interface FieldingRecord {
  side: Side;
  player: PlayerRef;
  po: number;
  a: number;
  e: number;
}

export interface StealRecord {
  side: Side;
  runner: PlayerRef;
  kind: 'SB' | 'CS';
}

export interface ReplayResult {
  state: LiveState;
  pas: PARecord[];
  runs: RunRecord[];
  pitches: PitchRecord[];
  outs: OutRecord[];
  fielding: FieldingRecord[];
  steals: StealRecord[];
  lineScore: Record<Side, number[]>;
  leftOnBase: Record<Side, number>;
  problems: { eventId: string; message: string }[];
  /** Situation before each event (for the play-by-play). */
  timeline: { eventId: string; inning: number; half: Half; outs: number; battingSide: Side }[];
}

export const playerKey = (p: PlayerRef) => p.id ?? `opp:${p.name}`;
const same = (a: PlayerRef, b: PlayerRef) => playerKey(a) === playerKey(b);

const HIT: PAResult[] = ['1B', '2B', '3B', 'HR'];
/** Results where the batter is out before reaching first: runs on a third-out play do not count. */
const BATTER_OUT_EARLY: PAResult[] = ['K', 'KL', 'GO', 'FO', 'LO', 'PO', 'SH', 'DP', 'TP', 'FC'];

/** Where the batter ends up when the scorer did not say otherwise. */
export function defaultBatterTo(result: PAResult): Move['to'] {
  switch (result) {
    case '1B':
    case 'BB':
    case 'IBB':
    case 'HBP':
    case 'CI':
    case 'FC':
    case 'E':
    case 'K_REACH':
      return 1;
    case '2B':
      return 2;
    case '3B':
      return 3;
    case 'HR':
      return 'H';
    default:
      return 'out';
  }
}

/** Position number (1–9) of a lineup position label. */
export const POSITION_NUMBER: Record<string, number> = {
  P: 1,
  C: 2,
  '1B': 3,
  '2B': 4,
  '3B': 5,
  SS: 6,
  LF: 7,
  CF: 8,
  RF: 9,
};

export function battingSideOf(half: Half, homeAway: 'home' | 'away'): Side {
  // The away team bats in the top half.
  return (half === 'top') === (homeAway === 'away') ? 'us' : 'opp';
}

export function initialState(setup: GameSetup): LiveState {
  const battingSide = battingSideOf('top', setup.homeAway);
  return {
    inning: 1,
    half: 'top',
    outs: 0,
    bases: [null, null, null],
    score: { us: 0, opp: 0 },
    battingSide,
    fieldingSide: battingSide === 'us' ? 'opp' : 'us',
    orderIndex: { us: 0, opp: 0 },
    lineups: {
      us: setup.lineups.us.map((s) => ({ ...s })),
      opp: setup.lineups.opp.map((s) => ({ ...s })),
    },
    pitchers: { ...setup.pitchers },
    count: { balls: 0, strikes: 0 },
    paPitches: 0,
  };
}

export function currentBatter(s: LiveState): PlayerRef {
  const lu = s.lineups[s.battingSide];
  return lu.length
    ? lu[s.orderIndex[s.battingSide] % lu.length]!.player
    : { id: null, name: '打者' };
}

export function replay(setup: GameSetup, events: ScoredEvent[]): ReplayResult {
  const s = initialState(setup);
  const out: ReplayResult = {
    state: s,
    pas: [],
    runs: [],
    pitches: [],
    outs: [],
    fielding: [],
    steals: [],
    lineScore: { us: [], opp: [] },
    leftOnBase: { us: 0, opp: 0 },
    problems: [],
    timeline: [],
  };
  const addRunsToLine = (side: Side, n: number) => {
    const arr = out.lineScore[side];
    while (arr.length < s.inning) arr.push(0);
    arr[s.inning - 1]! += n;
  };
  /** Pad the line score: the away team has batted in every inning so far, home only after the top half. */
  const ensureLine = () => {
    const away = battingSideOf('top', setup.homeAway);
    const home: Side = away === 'us' ? 'opp' : 'us';
    const pad = (side: Side, n: number) => {
      while (out.lineScore[side].length < n) out.lineScore[side].push(0);
    };
    pad(away, s.inning);
    pad(home, s.half === 'bottom' ? s.inning : s.inning - 1);
  };
  const fielderAt = (pos: number): PlayerRef | null => {
    if (pos === 1) return s.pitchers[s.fieldingSide];
    const slot = s.lineups[s.fieldingSide].find((x) => POSITION_NUMBER[x.position] === pos);
    return slot?.player ?? null;
  };
  const credit = (pos: number, k: 'po' | 'a' | 'e') => {
    const p = fielderAt(pos);
    if (!p) return;
    out.fielding.push({
      side: s.fieldingSide,
      player: p,
      po: k === 'po' ? 1 : 0,
      a: k === 'a' ? 1 : 0,
      e: k === 'e' ? 1 : 0,
    });
  };
  const creditFielders = (fielders: string | undefined, outsOnPlay: number, strikeout: boolean) => {
    const f = (fielders ?? '').toUpperCase();
    const errs = [...f.matchAll(/E(\d)/g)].map((m) => Number(m[1]));
    for (const e of errs) credit(e, 'e');
    if (strikeout && !f.replace(/E\d/g, '').match(/\d/)) {
      if (outsOnPlay > 0) credit(2, 'po');
      return;
    }
    if (outsOnPlay <= 0) return;
    const seq = [...f.replace(/E\d/g, '').matchAll(/\d/g)].map((m) => Number(m[0]));
    if (!seq.length) return;
    const last = seq[seq.length - 1]!;
    credit(last, 'po');
    if (outsOnPlay >= 2 && seq.length >= 3) credit(seq[seq.length - 2]!, 'po');
    const assisters = new Set(seq.slice(0, -1));
    for (const a of assisters) credit(a, 'a');
  };
  const endHalfIfNeeded = () => {
    if (s.outs < 3) return;
    out.leftOnBase[s.battingSide] += s.bases.filter(Boolean).length;
    ensureLine();
    s.bases = [null, null, null];
    s.outs = 0;
    s.count = { balls: 0, strikes: 0 };
    s.paPitches = 0;
    if (s.half === 'top') s.half = 'bottom';
    else {
      s.half = 'top';
      s.inning++;
    }
    s.battingSide = battingSideOf(s.half, setup.homeAway);
    s.fieldingSide = s.battingSide === 'us' ? 'opp' : 'us';
    ensureLine();
  };

  /**
   * Apply runner moves. Returns runners who crossed home and outs made.
   * Moves are applied lead runner first so bases never collide.
   */
  const applyMoves = (eventId: string, moves: Move[], batter: RunnerOnBase | null) => {
    const order = (f: BaseFrom) => (f === 'B' ? 0 : f);
    const sorted = [...moves].sort((a, b) => order(b.from) - order(a.from));
    const scored: { runner: RunnerOnBase; move: Move }[] = [];
    let outsMade = 0;
    for (const mv of sorted) {
      let r: RunnerOnBase | null;
      if (mv.from === 'B') r = batter;
      else {
        r = s.bases[mv.from - 1];
        s.bases[mv.from - 1] = null;
      }
      if (!r) {
        out.problems.push({ eventId, message: `no runner on ${mv.from}` });
        continue;
      }
      if (mv.to === 'H') scored.push({ runner: r, move: mv });
      else if (mv.to === 'out') outsMade++;
      else {
        if (s.bases[mv.to - 1])
          out.problems.push({ eventId, message: `base ${mv.to} already occupied` });
        s.bases[mv.to - 1] = r;
      }
    }
    return { scored, outsMade };
  };

  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    const p = ev.payload;
    ensureLine();
    out.timeline.push({
      eventId: ev.id,
      inning: s.inning,
      half: s.half,
      outs: s.outs,
      battingSide: s.battingSide,
    });
    if (p.type === 'pitch') {
      const pitcher = s.pitchers[s.fieldingSide];
      out.pitches.push({
        eventId: ev.id,
        side: s.fieldingSide,
        pitcher,
        batter: currentBatter(s),
        call: p.call,
        pitchType: p.pitchType,
      });
      s.paPitches++;
      if (p.call === 'B' || p.call === 'IB') s.count.balls = Math.min(4, s.count.balls + 1);
      else if (p.call === 'CS' || p.call === 'SS' || p.call === 'FT')
        s.count.strikes = Math.min(3, s.count.strikes + 1);
      else if (p.call === 'F' && s.count.strikes < 2) s.count.strikes++;
      continue;
    }

    if (p.type === 'sub') {
      const lu = s.lineups[p.side];
      if (p.kind === 'P') {
        s.pitchers[p.side] = p.player;
        const slot = lu.find((x) => x.position === 'P');
        if (slot) slot.player = p.player;
        continue;
      }
      if (p.slot === undefined || !lu[p.slot]) {
        out.problems.push({ eventId: ev.id, message: 'substitution slot missing' });
        continue;
      }
      const old = lu[p.slot]!.player;
      if (p.kind === 'PR') {
        for (const b of s.bases) if (b && same(b.player, old)) b.player = p.player;
      }
      lu[p.slot] = {
        player: p.player,
        position: p.position ?? (p.kind === 'DEF' ? lu[p.slot]!.position : p.kind),
      };
      if (p.position === 'P') s.pitchers[p.side] = p.player;
      continue;
    }

    if (p.type === 'runner') {
      const pitcher = s.pitchers[s.fieldingSide];
      const before = s.bases.map((b) => b);
      const { scored, outsMade } = applyMoves(ev.id, p.moves, null);
      if (p.kind === 'SB' || p.kind === 'CS') {
        for (const mv of p.moves) {
          if (mv.from === 'B') continue;
          const r = before[mv.from - 1];
          if (r)
            out.steals.push({
              side: s.battingSide,
              runner: r.player,
              kind: mv.to === 'out' ? 'CS' : 'SB',
            });
        }
      }
      creditFielders(p.fielders, outsMade, false);
      const unearnedPlay = p.kind === 'PB' || p.kind === 'E';
      for (const { runner, move } of scored) {
        const earned = move.earned ?? (!runner.unearned && !unearnedPlay);
        out.runs.push({
          eventId: ev.id,
          side: s.battingSide,
          inning: s.inning,
          runner: runner.player,
          pitcher: runner.pitcher,
          earned,
        });
      }
      s.score[s.battingSide] += scored.length;
      addRunsToLine(s.battingSide, scored.length);
      if (outsMade) out.outs.push({ side: s.fieldingSide, pitcher, n: outsMade });
      s.outs += outsMade;
      endHalfIfNeeded();
      continue;
    }

    // Plate appearance
    const side = s.battingSide;
    const pitcher = s.pitchers[s.fieldingSide];
    const batterRef = p.batter ?? currentBatter(s);
    const batter: RunnerOnBase = {
      player: batterRef,
      pitcher,
      unearned: p.result === 'E' || p.result === 'CI',
    };
    const moves = p.moves.some((m) => m.from === 'B')
      ? p.moves
      : [...p.moves, { from: 'B' as const, to: defaultBatterTo(p.result) }];
    const outsBefore = s.outs;
    const { scored, outsMade } = applyMoves(ev.id, moves, batter);
    const third = outsBefore + outsMade >= 3;
    const runsCount = third && BATTER_OUT_EARLY.includes(p.result) ? [] : scored;
    for (const { runner, move } of runsCount) {
      const earned = move.earned ?? (!runner.unearned && p.result !== 'E');
      out.runs.push({
        eventId: ev.id,
        side,
        inning: s.inning,
        runner: runner.player,
        pitcher: runner.pitcher,
        earned,
      });
    }
    s.score[side] += runsCount.length;
    addRunsToLine(side, runsCount.length);
    const defaultRbi =
      p.result === 'E' || p.result === 'DP' || p.result === 'TP' ? 0 : runsCount.length;
    out.pas.push({
      eventId: ev.id,
      inning: s.inning,
      half: s.half,
      side,
      batter: batterRef,
      pitcher,
      result: p.result,
      rbi: p.rbi ?? defaultRbi,
      runs: runsCount.length,
      outsOnPlay: outsMade,
      pitches: s.paPitches || p.pitchCount || 0,
      location: p.location,
      hitType: p.hitType,
      fielders: p.fielders,
    });
    creditFielders(p.fielders, outsMade, p.result === 'K' || p.result === 'KL');
    if (outsMade) out.outs.push({ side: s.fieldingSide, pitcher, n: outsMade });
    s.outs += outsMade;
    const lu = s.lineups[side];
    if (lu.length) s.orderIndex[side] = (s.orderIndex[side] + 1) % lu.length;
    s.count = { balls: 0, strikes: 0 };
    s.paPitches = 0;
    endHalfIfNeeded();
  }
  ensureLine();
  return out;
}

export function isHit(r: PAResult): boolean {
  return HIT.includes(r);
}
