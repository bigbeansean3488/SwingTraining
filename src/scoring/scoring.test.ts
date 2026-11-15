import { describe, expect, it } from 'vitest';
import { currentBatter, replay, type LiveState } from './engine';
import { avg, battingLines, era, fieldingLines, ip, obp, pitchingLines, rate3, slg } from './stats';
import { suggestMoves, suggestRbi } from './suggest';
import type { GameEventPayload, GameSetup, PAResult, PlayerRef, ScoredEvent, Slot } from './types';

const POS = ['CF', 'SS', 'LF', '1B', 'C', '3B', 'RF', '2B', 'P'];
const us = (i: number): PlayerRef => ({ id: `u${i}`, name: `我隊${i}` });
const opp = (i: number): PlayerRef => ({ id: null, name: `對手${i}` });
const lineup = (f: (i: number) => PlayerRef): Slot[] =>
  POS.map((p, i) => ({ player: f(i + 1), position: p }));

/** We bat first (away). */
function setup(homeAway: 'home' | 'away' = 'away'): GameSetup {
  return {
    homeAway,
    innings: 9,
    lineups: { us: lineup(us), opp: lineup(opp) },
    pitchers: { us: us(9), opp: opp(9) },
  };
}

/** Event builder that uses the engine's own suggestions, like the scorer UI does. */
class Game {
  events: ScoredEvent[] = [];
  constructor(public cfg: GameSetup = setup()) {}
  get state(): LiveState {
    return replay(this.cfg, this.events).state;
  }
  push(payload: GameEventPayload) {
    this.events.push({ id: `e${this.events.length + 1}`, seq: this.events.length + 1, payload });
    return this;
  }
  pa(result: PAResult, extra: Partial<Extract<GameEventPayload, { type: 'pa' }>> = {}) {
    const moves = extra.moves ?? suggestMoves(this.state, result);
    return this.push({
      type: 'pa',
      result,
      moves,
      rbi: extra.rbi ?? suggestRbi(result, moves),
      ...extra,
    });
  }
  result() {
    return replay(this.cfg, this.events);
  }
}

describe('game replay', () => {
  it('tracks outs, bases, score and switches halves', () => {
    const g = new Game().pa('1B').pa('2B').pa('SF').pa('K').pa('GO', { fielders: '6-3' });
    const r = g.result();
    // 1B, 2B (runner 1st->3rd), SF scores one, K, GO -> 3 outs.
    expect(r.state.score).toEqual({ us: 1, opp: 0 });
    expect(r.state.half).toBe('bottom');
    expect(r.state.battingSide).toBe('opp');
    expect(r.state.outs).toBe(0);
    expect(r.lineScore.us).toEqual([1]);
    expect(r.leftOnBase.us).toBe(1); // runner on 2nd stranded
    const sf = r.pas.find((p) => p.result === 'SF')!;
    expect(sf.rbi).toBe(1);
  });

  it('home team bats in the bottom half', () => {
    const g = new Game(setup('home'));
    expect(g.state.battingSide).toBe('opp');
    g.pa('K').pa('K').pa('K');
    expect(g.state.battingSide).toBe('us');
    expect(currentBatter(g.state)).toEqual(us(1));
  });

  it('a three-run homer: three runs, three RBI, all earned to the pitcher', () => {
    const r = new Game().pa('BB').pa('1B').pa('HR').result();
    expect(r.state.score.us).toBe(3);
    expect(r.pas[2]!.rbi).toBe(3);
    const p = pitchingLines([r], 'opp').get('opp:對手9')!;
    expect(p.R).toBe(3);
    expect(p.ER).toBe(3);
  });

  it('runs do not count when the third out is made before the batter reaches first', () => {
    const g = new Game().pa('1B').pa('1B').pa('1B').pa('K').pa('K');
    // Bases loaded, two outs. Ground out with the runner from third crossing.
    g.pa('GO', {
      moves: [
        { from: 3, to: 'H' },
        { from: 'B', to: 'out' },
      ],
      rbi: 0,
      fielders: '6-3',
    });
    const r = g.result();
    expect(r.state.score.us).toBe(0);
    expect(r.state.half).toBe('bottom');
  });

  it('a run by a runner who reached on an error is unearned', () => {
    const r = new Game().pa('E', { fielders: 'E6' }).pa('HR').result();
    expect(r.state.score.us).toBe(2);
    const p = pitchingLines([r], 'opp').get('opp:對手9')!;
    expect(p.R).toBe(2);
    expect(p.ER).toBe(1);
    expect(r.pas[0]!.rbi).toBe(0);
    // The error is charged to the opponent shortstop.
    const f = fieldingLines([r], 'opp').get('opp:對手2')!;
    expect(f.E).toBe(1);
  });

  it('inherited runners are charged to the pitcher who put them on base', () => {
    const g = new Game(setup('home'));
    g.pa('BB'); // opponent batter walks against our starter us9
    g.push({ type: 'sub', side: 'us', kind: 'P', player: us(10) });
    g.pa('2B'); // suggestion: runner from first to third, batter to second
    g.pa('1B'); // runner from third scores (charged to u9); runner from second to third
    const r = g.result();
    const lines = pitchingLines([r], 'us');
    expect(lines.get('u9')!.R).toBe(1);
    expect(lines.get('u10')!.R).toBe(0);
    expect(r.state.bases[2]!.pitcher).toEqual(us(10)); // the reliever's own runner
    expect(lines.get('u9')!.BF).toBe(1);
    expect(lines.get('u10')!.BF).toBe(2);
  });

  it('counts pitches, balls and strikes per pitcher in pitch-by-pitch mode', () => {
    const g = new Game(setup('home'));
    for (const c of ['B', 'CS', 'F', 'F', 'SS'] as const)
      g.push({ type: 'pitch', call: c, pitchType: 'FB' });
    expect(g.state.count).toEqual({ balls: 1, strikes: 3 });
    g.pa('K');
    for (const c of ['B', 'B', 'B', 'B'] as const)
      g.push({ type: 'pitch', call: c, pitchType: 'SL' });
    g.pa('BB');
    const r = g.result();
    const p = pitchingLines([r], 'us').get('u9')!;
    expect(p.pitches).toBe(9);
    expect(p.strikes).toBe(4);
    expect(p.balls).toBe(5);
    expect(p.byType).toEqual({ FB: 5, SL: 4 });
    expect(r.pas[0]!.pitches).toBe(5);
    expect(r.state.count).toEqual({ balls: 0, strikes: 0 });
  });

  it('batting order wraps and pinch hitters take the slot', () => {
    const g = new Game();
    for (let i = 0; i < 3; i++) g.pa('K');
    for (let i = 0; i < 3; i++) g.pa('K'); // opponent
    g.push({ type: 'sub', side: 'us', kind: 'PH', slot: 3, player: us(20) });
    const st = g.state;
    expect(currentBatter(st)).toEqual(us(20));
    expect(st.lineups.us[3]!.position).toBe('PH');
  });

  it('pinch runner replaces the runner on base', () => {
    const g = new Game().pa('1B');
    g.push({ type: 'sub', side: 'us', kind: 'PR', slot: 0, player: us(21) });
    g.pa('HR');
    const r = g.result();
    const runners = r.runs.map((x) => x.runner.id);
    expect(runners).toContain('u21');
    expect(runners).not.toContain('u1');
  });

  it('steals, caught stealing, wild pitch (earned) and passed ball (unearned)', () => {
    const g = new Game().pa('1B');
    g.push({ type: 'runner', kind: 'SB', moves: [{ from: 1, to: 2 }] });
    g.push({ type: 'runner', kind: 'WP', moves: [{ from: 2, to: 3 }] });
    g.push({ type: 'runner', kind: 'PB', moves: [{ from: 3, to: 'H' }] });
    g.pa('1B');
    g.push({ type: 'runner', kind: 'CS', moves: [{ from: 1, to: 'out' }], fielders: '2-6' });
    const r = g.result();
    const b = battingLines([r]);
    expect(b.get('u1')!.SB).toBe(1);
    expect(b.get('u2')!.CS).toBe(1);
    expect(r.state.outs).toBe(1);
    const p = pitchingLines([r], 'opp').get('opp:對手9')!;
    expect(p.R).toBe(1);
    expect(p.ER).toBe(0);
    const f = fieldingLines([r], 'opp');
    expect(f.get('opp:對手5')!.A).toBe(1); // catcher assist
    expect(f.get('opp:對手2')!.PO).toBe(1); // shortstop putout
  });

  it('double play credits fielders and records GIDP', () => {
    const g = new Game().pa('1B').pa('DP', { fielders: '6-4-3' });
    const r = g.result();
    expect(r.state.outs).toBe(2);
    expect(r.state.bases).toEqual([null, null, null]);
    const f = fieldingLines([r], 'opp');
    expect(f.get('opp:對手2')).toMatchObject({ A: 1, PO: 0 }); // SS
    expect(f.get('opp:對手8')).toMatchObject({ A: 1, PO: 1 }); // 2B
    expect(f.get('opp:對手4')).toMatchObject({ PO: 1 }); // 1B
    expect(battingLines([r]).get('u2')!.GIDP).toBe(1);
  });

  it('strikeouts credit the catcher with a putout', () => {
    const r = new Game().pa('K').result();
    expect(fieldingLines([r], 'opp').get('opp:對手5')!.PO).toBe(1);
  });

  it("fielder's choice: lead runner out, batter safe", () => {
    const g = new Game().pa('1B').pa('FC', { fielders: '6-4' });
    const st = g.state;
    expect(st.outs).toBe(1);
    expect(st.bases[0]!.player).toEqual(us(2));
    expect(st.bases[1]).toBeNull();
  });

  it('reports inconsistent events instead of crashing', () => {
    const r = new Game().push({ type: 'runner', kind: 'SB', moves: [{ from: 2, to: 3 }] }).result();
    expect(r.problems.length).toBe(1);
  });

  it('editing or deleting an event recomputes everything', () => {
    const g = new Game().pa('1B').pa('HR');
    expect(g.result().state.score.us).toBe(2);
    g.events.splice(0, 1);
    expect(g.result().state.score.us).toBe(1);
    g.events[0] = {
      ...g.events[0]!,
      payload: { type: 'pa', result: 'K', moves: [{ from: 'B', to: 'out' }] },
    };
    expect(g.result().state.score.us).toBe(0);
  });
});

describe('statistics', () => {
  it('AVG / OBP / SLG follow the official definitions', () => {
    // Batter 1 over several trips: 1B, BB, HR, K, SF.
    const cfg = setup();
    cfg.lineups.us = [{ player: us(1), position: 'CF' }];
    const g = new Game(cfg);
    const trip = (r: PAResult) => {
      g.pa(r);
    };
    trip('1B');
    trip('BB');
    trip('HR'); // three runners in: 1st, 2nd... (station-to-station suggestions)
    trip('K');
    const line = battingLines([g.result()]).get('u1')!;
    expect(line.PA).toBe(4);
    expect(line.AB).toBe(3); // BB is not an at-bat
    expect(line.H).toBe(2);
    expect(rate3(avg(line))).toBe('.667');
    expect(obp(line)).toBeCloseTo(3 / 4, 6);
    expect(slg(line)).toBeCloseTo(5 / 3, 6);
    expect(line.G).toBe(1);
  });

  it('innings pitched and ERA', () => {
    expect(ip(17)).toBe('5.2');
    const l = { outs: 27, ER: 3 } as Parameters<typeof era>[0];
    expect(era(l)).toBeCloseTo(3, 6);
    expect(era(l, 7)).toBeCloseTo(7 / 3, 6);
  });

  it('aggregates across games and counts games played', () => {
    const a = new Game().pa('1B').result();
    const b = new Game().pa('2B').result();
    const line = battingLines([a, b]).get('u1')!;
    expect(line.G).toBe(2);
    expect(line.H).toBe(2);
    expect(line.TB).toBe(3);
  });
});

describe('suggested runner movements', () => {
  const st = (bases: [boolean, boolean, boolean]): LiveState => {
    const s = replay(setup(), []).state;
    s.bases = bases.map((b, i) =>
      b ? { player: us(i + 1), pitcher: opp(9), unearned: false } : null,
    ) as LiveState['bases'];
    return s;
  };
  it('walk with runners on first and third forces only the runner on first', () => {
    expect(suggestMoves(st([true, false, true]), 'BB')).toEqual([
      { from: 1, to: 2 },
      { from: 'B', to: 1 },
    ]);
  });
  it('walk with the bases loaded forces in a run', () => {
    const m = suggestMoves(st([true, true, true]), 'BB');
    expect(m).toContainEqual({ from: 3, to: 'H' });
    expect(suggestRbi('BB', m)).toBe(1);
  });
  it('no RBI on an error', () => {
    expect(suggestRbi('E', suggestMoves(st([false, false, true]), 'E'))).toBe(0);
  });
});
