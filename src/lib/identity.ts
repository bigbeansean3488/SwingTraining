// Who is using this device. In local mode a "me" profile is created on first
// launch; after sign-in it is linked to the Supabase user (see src/lib/auth.ts).
import { useEffect, useState } from 'react';
import { getMeta, getRow, saveRow, setMeta, subscribe } from './db';
import type { Profile } from './types';

export const ME_KEY = 'me_profile_id';

let ensuring: Promise<Profile> | null = null;

export function ensureMe(): Promise<Profile> {
  ensuring ??= (async () => {
    const id = await getMeta<string>(ME_KEY);
    if (id) {
      const p = await getRow('profiles', id);
      if (p) return p;
    }
    const p = await saveRow('profiles', {
      user_id: null,
      display_name: '我',
      height_cm: null,
      bats: null,
      throws: null,
      birth_year: null,
      notes: null,
      created_by: null,
    });
    await setMeta(ME_KEY, p.id);
    return p;
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
}

export function useMe(): Profile | null {
  const [me, setMe] = useState<Profile | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      ensureMe().then((p) => {
        if (alive) setMe(p);
      });
    load();
    const off = subscribe((t) => {
      if (t === 'profiles' || t === 'meta') load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return me;
}
