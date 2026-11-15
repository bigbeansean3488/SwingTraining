// Suggested runner movements for a plate-appearance result. The scorer can
// change any of them before saving; the engine only uses what is saved.
import { defaultBatterTo, type LiveState } from './engine';
import type { Move, PAResult } from './types';

const occupied = (s: LiveState, b: 1 | 2 | 3) => !!s.bases[b - 1];

/** Runners forced to advance when the batter takes first base. */
function forcedAdvances(s: LiveState): Move[] {
  const moves: Move[] = [];
  if (occupied(s, 1)) {
    if (occupied(s, 2)) {
      if (occupied(s, 3)) moves.push({ from: 3, to: 'H' });
      moves.push({ from: 2, to: 3 });
    }
    moves.push({ from: 1, to: 2 });
  }
  return moves;
}

function advanceAll(s: LiveState, n: number): Move[] {
  const moves: Move[] = [];
  for (const b of [3, 2, 1] as const) {
    if (!occupied(s, b)) continue;
    const to = b + n;
    moves.push({ from: b, to: to >= 4 ? 'H' : (to as 1 | 2 | 3) });
  }
  return moves;
}

export function suggestMoves(s: LiveState, result: PAResult): Move[] {
  const batter: Move = { from: 'B', to: defaultBatterTo(result) };
  switch (result) {
    case 'HR':
    case '3B':
      return [...advanceAll(s, 4), batter];
    case '2B':
      return [...advanceAll(s, 2), batter];
    case '1B':
    case 'E':
      return [...advanceAll(s, 1), batter];
    case 'BB':
    case 'IBB':
    case 'HBP':
    case 'CI':
    case 'K_REACH':
      return [...forcedAdvances(s), batter];
    case 'SH':
      return [...advanceAll(s, 1), batter];
    case 'SF':
      return [...(occupied(s, 3) ? [{ from: 3 as const, to: 'H' as const }] : []), batter];
    case 'FC': {
      // Lead forced runner is out; the rest are forced along.
      const f = forcedAdvances(s);
      if (!f.length) return [batter];
      const lead = f[f.length - 1]!; // runner from first, forced to second
      return [...f.slice(0, -1), { from: lead.from, to: 'out' }, batter];
    }
    case 'DP':
      return [...(occupied(s, 1) ? [{ from: 1 as const, to: 'out' as const }] : []), batter];
    case 'TP':
      return [
        ...(occupied(s, 1) ? [{ from: 1 as const, to: 'out' as const }] : []),
        ...(occupied(s, 2) ? [{ from: 2 as const, to: 'out' as const }] : []),
        batter,
      ];
    default:
      return [batter];
  }
}

/** Default RBI for the moves the scorer settled on (no RBI on errors or double plays). */
export function suggestRbi(result: PAResult, moves: Move[]): number {
  if (result === 'E' || result === 'DP' || result === 'TP') return 0;
  return moves.filter((m) => m.to === 'H').length;
}
