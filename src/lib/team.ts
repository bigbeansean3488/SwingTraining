// Current team selection (stored per device).
import { useEffect, useState } from 'react';
import { getMeta, getRow, listRows, setMeta, subscribe } from './db';
import type { Team } from './types';

export const CURRENT_TEAM_KEY = 'current_team_id';

export async function getCurrentTeam(): Promise<Team | null> {
  const id = await getMeta<string>(CURRENT_TEAM_KEY);
  if (id) {
    const t = await getRow('teams', id);
    if (t) return t;
  }
  const teams = await listRows('teams');
  return teams[0] ?? null;
}

export async function setCurrentTeam(id: string): Promise<void> {
  await setMeta(CURRENT_TEAM_KEY, id);
}

export function useCurrentTeam(): Team | null {
  const [team, setTeam] = useState<Team | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getCurrentTeam().then((t) => {
        if (alive) setTeam(t);
      });
    load();
    const off = subscribe((t) => {
      if (t === 'teams' || t === 'meta') load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return team;
}
