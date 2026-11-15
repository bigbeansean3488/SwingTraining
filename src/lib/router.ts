// Minimal hash router: '#/players/abc?tab=x' -> path ['players','abc'], query {tab:'x'}.
// Hash routing works on any static host and inside an installed PWA without rewrites.
import { useEffect, useState } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
  raw: string;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [p = '/', q = ''] = raw.split('?');
  return {
    path: p.split('/').filter(Boolean).map(decodeURIComponent),
    query: new URLSearchParams(q),
    raw,
  };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const hash = to.startsWith('#') ? to : `#${to}`;
  if (opts.replace) window.location.replace(hash);
  else window.location.hash = hash;
}

export function href(to: string): string {
  return to.startsWith('#') ? to : `#${to}`;
}
