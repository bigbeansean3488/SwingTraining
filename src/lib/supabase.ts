// Supabase client. Configured from build-time env (Cloudflare Pages variables)
// or, as a fallback, from values pasted in 設定 (stored on this device only).
// Only the publishable/anon key is ever used in the browser; RLS protects data.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const LS_KEY = 'supabase_config';

export interface SupabaseConfig {
  url: string;
  key: string;
  source: 'env' | 'device';
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
  if (url && key) return { url, key, source: 'env' };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const c = JSON.parse(raw) as { url: string; key: string };
      if (c.url && c.key) return { ...c, source: 'device' };
    }
  } catch {
    // storage unavailable
  }
  return null;
}

export function saveDeviceConfig(cfg: { url: string; key: string } | null): void {
  try {
    if (cfg) localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
  client = undefined;
}

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const cfg = supabaseConfig();
  client = cfg
    ? createClient(cfg.url, cfg.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      })
    : null;
  return client;
}
