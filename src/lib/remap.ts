// Move local data from one profile id to another (after sign-in links the local
// "me" profile to an existing account, or after claiming a roster entry).
import { listRows, saveRow } from './db';
import type { TableName } from './types';

const DIRECT: [TableName, string][] = [
  ['team_members', 'profile_id'],
  ['attendance', 'player_id'],
  ['training_logs', 'player_id'],
  ['motion_analyses', 'player_id'],
  ['lineups', 'pitcher_id'],
  ['reference_motions', 'player_id'],
];

/** Replace every reference to `from` with `to` in a JSON value (ids are unique UUIDs). */
export function replaceId<T>(value: T, from: string, to: string): T {
  if (value === from) return to as T;
  if (Array.isArray(value)) return value.map((v) => replaceId(v, from, to)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceId(v, from, to)]),
    ) as T;
  }
  return value;
}

export async function remapProfile(from: string, to: string): Promise<number> {
  if (from === to) return 0;
  let n = 0;
  for (const [table, col] of DIRECT) {
    for (const row of await listRows(table, true)) {
      if ((row as unknown as Record<string, unknown>)[col] === from) {
        await saveRow(table, { ...row, [col]: to } as never);
        n++;
      }
    }
  }
  for (const row of await listRows('lineups', true)) {
    const slots = replaceId(row.slots, from, to);
    if (JSON.stringify(slots) !== JSON.stringify(row.slots)) {
      await saveRow('lineups', { ...row, slots });
      n++;
    }
  }
  for (const row of await listRows('game_events', true)) {
    const payload = replaceId(row.payload, from, to);
    if (JSON.stringify(payload) !== JSON.stringify(row.payload)) {
      await saveRow('game_events', { ...row, payload });
      n++;
    }
  }
  return n;
}
