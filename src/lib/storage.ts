// Keyframe images in Supabase Storage (private bucket 'keyframes').
import { getSupabase } from './supabase';

export const KEYFRAME_BUCKET = 'keyframes';

const cache = new Map<string, string>();

/** Signed URL for a keyframe stored in Supabase; null in local mode or on error. */
export async function keyframeUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(KEYFRAME_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return null;
  cache.set(path, data.signedUrl);
  return data.signedUrl;
}
