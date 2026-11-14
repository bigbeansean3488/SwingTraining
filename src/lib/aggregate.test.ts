import { describe, expect, it } from 'vitest';
import { replay } from '../scoring/engine';
import type { GameSetup } from '../scoring/types';
import { cumulativeAvg, perGameSeries, toCsv, weekStart, weeklyVolume } from './aggregate';

describe('report aggregations', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-11-14')).toBe('2026-11-09'); // Saturday -> Monday
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sunday belongs to the same week
  });

  it('sums swings and pitches per week', () => {
    const v = weeklyVolume([
      { date: '2026-11-10', kind: 'batting', data: { swings: 100 } },
      { date: '2026-11-12', kind: 'bullpen', data: { pitches: { FB: 20, SL: 5 } } },
      { date: '2026-11-17', kind: 'batting', data: { swings: 50 } },
      { date: '2026-11-17', kind: 'fitness', data: { item: '60m', value: 7.5, unit: '秒' } },
    ]);
    expect(v).toEqual([
      { week: '2026-11-09', swings: 100, pitches: 25, sessions: 2 },
      { week: '2026-11-16', swings: 50, pitches: 0, sessions: 2 },
    ]);
  });

  it('per-game series and cumulative average come from game events', () => {
    const setup: GameSetup = {
      homeAway: 'away',
      innings: 9,
      lineups: {
        us: [{ player: { id: 'p1', name: 'A' }, position: 'CF' }],
        opp: [{ player: { id: null, name: 'X' }, position: 'CF' }],
      },
      pitchers: { us: { id: 'p9', name: 'P' }, opp: { id: null, name: 'Q' } },
    };
    const g1 = replay(setup, [
      { id: '1', seq: 1, payload: { type: 'pa', result: '1B', moves: [{ from: 'B', to: 1 }] } },
      { id: '2', seq: 2, payload: { type: 'pa', result: 'K', moves: [{ from: 'B', to: 'out' }] } },
    ]);
    const g2 = replay(setup, [
      { id: '3', seq: 1, payload: { type: 'pa', result: 'GO', moves: [{ from: 'B', to: 'out' }] } },
    ]);
    const pts = perGameSeries(
      [
        { date: '2026-11-20', opponent: 'B', result: g2 },
        { date: '2026-11-13', opponent: 'A', result: g1 },
      ],
      'p1',
    );
    expect(pts.map((p) => [p.date, p.AB, p.H])).toEqual([
      ['2026-11-13', 2, 1],
      ['2026-11-20', 1, 0],
    ]);
    expect(cumulativeAvg(pts).map((x) => +x.value.toFixed(3))).toEqual([0.5, 0.333]);
  });

  it('CSV escapes commas, quotes and newlines and starts with a BOM', () => {
    const csv = toCsv(
      [{ a: 'x,y', b: 'say "hi"', c: 'line\nbreak', d: 3 }],
      [
        { key: 'a', label: '欄A' },
        { key: 'b', label: 'B' },
        { key: 'c', label: 'C' },
        { key: 'd', label: 'D' },
      ],
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('欄A,B,C,D\r\n"x,y","say ""hi""","line\nbreak",3\r\n');
  });
});
