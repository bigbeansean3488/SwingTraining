// What the current user may do, mirroring the server's RLS rules so the UI only
// offers allowed actions. The server remains the authority.
import { useSession } from './auth';
import { useRows } from './hooks';
import { useMe } from './identity';
import { useCurrentTeam } from './team';
import type { Role } from './types';

export interface Access {
  signedIn: boolean;
  /** Local mode (no Supabase or not signed in): everything is allowed on this device. */
  local: boolean;
  meId: string | null;
  teamId: string | null;
  role: Role | null;
  isStaff: boolean;
  isAdmin: boolean;
  canEditPlayer: (playerId: string) => boolean;
}

export function useAccess(): Access {
  const session = useSession();
  const me = useMe();
  const team = useCurrentTeam();
  const members = useRows('team_members', (m) => m.active, []);
  const mine = (members ?? []).filter((m) => m.team_id === team?.id && m.profile_id === me?.id);
  const role: Role | null = mine.some((m) => m.role === 'admin')
    ? 'admin'
    : mine.some((m) => m.role === 'coach')
      ? 'coach'
      : mine.length
        ? 'player'
        : null;
  const local = !session;
  const isStaff = local || role === 'admin' || role === 'coach';
  return {
    signedIn: !!session,
    local,
    meId: me?.id ?? null,
    teamId: team?.id ?? null,
    role,
    isStaff,
    isAdmin: local || role === 'admin',
    canEditPlayer: (pid) => local || pid === me?.id || isStaff,
  };
}
