// Google sign-in through Supabase Auth (docs/DECISIONS.md D13) and linking the
// local "me" profile to the account.
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import {
  applyRemoteRows,
  clearAllLocal,
  getMeta,
  getRaw,
  purgeLocal,
  saveRow,
  setMeta,
} from './db';
import { ensureMe, ME_KEY } from './identity';
import { remapProfile } from './remap';
import { getSupabase } from './supabase';
import { requestSync, resetCursors, startSync, supabaseRemote } from './sync';
import type { Profile } from './types';

let currentSession: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();

export function useSession(): Session | null {
  const [s, setS] = useState<Session | null>(currentSession);
  useEffect(() => {
    listeners.add(setS);
    setS(currentSession);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

function publish(s: Session | null) {
  currentSession = s;
  for (const fn of listeners) fn(s);
}

/** Call once at startup. Works without Supabase (local mode). */
export async function initAuth(): Promise<void> {
  const sb = getSupabase();
  startSync(async () => {
    if (!sb || !currentSession) return null;
    return supabaseRemote(sb, currentSession.user.id);
  });
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  if (data.session) await onSignedIn(data.session);
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session && session.user.id !== currentSession?.user.id) {
      void onSignedIn(session);
    } else if (event === 'SIGNED_OUT') {
      publish(null);
    } else if (session) {
      publish(session);
    }
  });
}

export async function signInWithGoogle(): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('尚未設定 Supabase');
  // Keep the invite (if any) across the OAuth round trip.
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}/${location.hash}` },
  });
  if (error) throw error;
}

export async function signOut(clearDevice: boolean): Promise<void> {
  const sb = getSupabase();
  await sb?.auth.signOut();
  publish(null);
  if (clearDevice) {
    await clearAllLocal();
    await ensureMe();
  }
}

/**
 * Link this device's "me" profile to the signed-in account. If the account
 * already has a profile on the server (another phone), local data is moved
 * onto that profile and the local stand-in is dropped.
 */
async function onSignedIn(session: Session): Promise<void> {
  const sb = getSupabase()!;
  const uid = session.user.id;
  const prevUser = await getMeta<string>('sync_user');
  if (prevUser && prevUser !== uid) await resetCursors();
  await setMeta('sync_user', uid);

  const me = await ensureMe();
  const { data, error } = await sb
    .from('profiles')
    .select('*')
    .eq('user_id', uid)
    .is('deleted_at', null)
    .limit(1);
  const fullName = (session.user.user_metadata?.full_name ?? session.user.user_metadata?.name) as
    string | undefined;
  if (!error && data && data.length) {
    const server = data[0] as Profile;
    if (server.id !== me.id) {
      await applyRemoteRows('profiles', [server]);
      await remapProfile(me.id, server.id);
      const local = await getRaw('profiles', me.id);
      if (local && !local.user_id) await purgeLocal('profiles', me.id);
      await setMeta(ME_KEY, server.id);
    }
  } else if (!error) {
    await saveRow('profiles', {
      ...me,
      user_id: uid,
      created_by: uid,
      display_name: me.display_name === '我' && fullName ? fullName : me.display_name,
    });
  }
  publish(session);
  await requestSync();
}

/** Accept an invite token; merges data if a roster entry was claimed. */
export async function acceptInvite(token: string): Promise<{ teamId: string }> {
  const sb = getSupabase();
  if (!sb || !currentSession) throw new Error('請先登入');
  await requestSync();
  const { data, error } = await sb.rpc('accept_invite', { invite_token: token });
  if (error) throw new Error(error.message);
  const r = data as { profile_id: string; merged_from: string | null; team_id: string };
  const meId = await getMeta<string>(ME_KEY);
  if (r.merged_from || (meId && meId !== r.profile_id)) {
    const from = r.merged_from ?? meId!;
    await remapProfile(from, r.profile_id);
    await purgeLocal('profiles', from);
  }
  await setMeta(ME_KEY, r.profile_id);
  await setMeta('current_team_id', r.team_id);
  await requestSync();
  return { teamId: r.team_id };
}
