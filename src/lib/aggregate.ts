// Pure aggregations for reports (no DOM): weekly training volume, per-game
// stat series, CSV encoding.
import type { ReplayResult } from '../scoring/engine';
import { battingLines, pitchingLines } from '../scoring/stats';
import type { TrainingLog } from './types';

/** Monday (local) of the week containing an ISO date string (YYYY-MM-DD). */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d.toLocaleDateString('sv-SE');
}

export interface WeekVolume {
  week: string;
  swings: number;
  pitches: number;
  sessions: number;
}

export function weeklyVolume(logs: Pick<TrainingLog, 'date' | 'kind' | 'data'>[]): WeekVolume[] {
  const m = new Map<string, WeekVolume>();
  for (const l of logs) {
    const w = weekStart(l.date);
    const v = m.get(w) ?? { week: w, swings: 0, pitches: 0, sessions: 0 };
    v.sessions++;
    if (l.kind === 'batting') v.swings += l.data.swings ?? 0;
    if (l.kind === 'bullpen')
      v.pitches += Object.values(l.data.pitches ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
    m.set(w, v);
  }
  return [...m.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export interface GamePoint {
  date: string;
  opponent: string;
  PA: number;
  AB: number;
  H: number;
  HR: number;
  BB: number;
  SO: number;
  /** Pitching */
  outs: number;
  pitches: number;
  ER: number;
}

/** One point per game in which the player batted or pitched. */
export function perGameSeries(
  games: { date: string; opponent: string; result: ReplayResult }[],
  playerId: string,
): GamePoint[] {
  const out: GamePoint[] = [];
  for (const g of games) {
    const b = [...battingLines([g.result]).values()].find((l) => l.player.id === playerId);
    const p = [...pitchingLines([g.result]).values()].find((l) => l.player.id === playerId);
    if (!b && !p) continue;
    out.push({
      date: g.date,
      opponent: g.opponent,
      PA: b?.PA ?? 0,
      AB: b?.AB ?? 0,
      H: b?.H ?? 0,
      HR: b?.HR ?? 0,
      BB: b?.BB ?? 0,
      SO: b?.SO ?? 0,
      outs: p?.outs ?? 0,
      pitches: p?.pitches ?? 0,
      ER: p?.ER ?? 0,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Running batting average after each game (cumulative H / AB). */
export function cumulativeAvg(points: GamePoint[]): { date: string; value: number }[] {
  let h = 0;
  let ab = 0;
  const out: { date: string; value: number }[] = [];
  for (const p of points) {
    h += p.H;
    ab += p.AB;
    if (ab > 0) out.push({ date: p.date, value: h / ab });
  }
  return out;
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const BOM = String.fromCharCode(0xfeff);

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens Chinese text correctly. */
export function toCsv(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[],
): string {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c.key])).join(','));
  return BOM + `${lines.join('\r\n')}\r\n`;
}
